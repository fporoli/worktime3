import { Body, Controller, Delete, Get, OnModuleInit, Param, Post, Query, Req } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import { DbService } from './db.service';
import {
  callerUserId,
  directReportUserIds,
  isManagerOf,
  isOrgAdmin,
  isOrgBillingAdmin,
  isOrgMember,
  membershipManagerId,
} from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { expense_report_items, expense_reports, expenses, projects, subprojects, users } from './db/schema';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { WorkflowsService, APPROVE_EXPENSE_REPORT_WORKFLOW_NAME } from './workflows.service';

const STATUSES = [
  'in_preparation', 'submitted', 'approved', 'rejected',
  'submitted_processing', 'processing_finished', 'request_payment', 'finished',
] as const;
type Status = (typeof STATUSES)[number];

/** The forward-only finance pipeline once a report is approved — no per-stage decision, just progress. */
export const PIPELINE: readonly Status[] = ['approved', 'submitted_processing', 'processing_finished', 'request_payment', 'finished'];

/** The pipeline stage after `status`, or null if `status` isn't advanceable (not in the pipeline, or already the last stage). */
export function nextPipelineStage(status: string): Status | null {
  const idx = PIPELINE.indexOf(status as Status);
  if (idx === -1 || idx === PIPELINE.length - 1) return null;
  return PIPELINE[idx + 1];
}

@Controller()
export class ExpenseReportsController implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
    private readonly workflowsSvc: WorkflowsService,
  ) {}

  /**
   * Expense reports own what "expense.*" workflow actions actually do, and how to resolve an
   * expense_reports row's organization — WorkflowsService only knows the names, not the behavior.
   */
  onModuleInit() {
    this.workflowsSvc.registerSourceOrgResolver('expense_reports', async (db, sourceTableUuid) => {
      const [report] = await db
        .select({ organization_id: expense_reports.organization_id })
        .from(expense_reports)
        .where(eq(expense_reports.id, sourceTableUuid));
      return report?.organization_id ?? null;
    });

    this.workflowsSvc.registerAction('expense.approve', async (db, ctx) => {
      const patch = { status: 'approved' as const, reviewed_by_user_id: ctx.actorUserId, reviewed_at: new Date().toISOString(), review_note: null };
      await db.update(expense_reports).set(patch).where(eq(expense_reports.id, ctx.sourceTableUuid));
      void this.versions.record('expense_reports', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
    });

    this.workflowsSvc.registerAction('expense.reject', async (db, ctx) => {
      const patch = { status: 'rejected' as const, reviewed_by_user_id: ctx.actorUserId, reviewed_at: new Date().toISOString(), review_note: ctx.decisionNote };
      await db.update(expense_reports).set(patch).where(eq(expense_reports.id, ctx.sourceTableUuid));
      void this.versions.record('expense_reports', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
    });
  }

  @Get('organizations/:orgId/expense-reports')
  async list(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];

    const isAdmin = await isOrgAdmin(db, orgId, callerId);
    const isBillingAdmin = await isOrgBillingAdmin(db, orgId, callerId);
    const statusIsFinanceStage = !!status && (STATUSES as readonly string[]).includes(status) && PIPELINE.includes(status as Status) && status !== 'approved';
    const conditions: SQL[] = [eq(expense_reports.organization_id, orgId)];
    if (userId) {
      // Someone else's reports: admins can view anyone's; everyone else only that person's own manager.
      if (userId !== callerId && !isAdmin && !(await isManagerOf(db, orgId, callerId, userId))) return [];
      conditions.push(eq(expense_reports.user_id, userId));
    } else if (isBillingAdmin && statusIsFinanceStage) {
      // The finance queue: a billing_admin (or admin) may list org-wide by finance-stage status,
      // without needing a manager relationship to every submitter.
    } else if (!isAdmin) {
      // No target given, not a finance-queue lookup: your own reports, plus your direct reports'.
      const reportIds = await directReportUserIds(db, orgId, callerId);
      conditions.push(inArray(expense_reports.user_id, [callerId, ...reportIds]));
    }
    if (status && (STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(expense_reports.status, status as Status));
    }

    return db
      .select({
        ...getTableColumns(expense_reports),
        user_display_name: users.display_name,
        user_email: users.email,
      })
      .from(expense_reports)
      .innerJoin(users, eq(users.id, expense_reports.user_id))
      .where(and(...conditions))
      .orderBy(desc(expense_reports.date_submitted));
  }

  @Post('organizations/:orgId/expense-reports')
  async create(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const values = { organization_id: orgId, user_id: callerId, status: 'in_preparation' as const };
    const [row] = await db.insert(expense_reports).values(values).returning({ id: expense_reports.id });
    void this.versions.record('expense_reports', row.id, 'insert', callerId, { id: row.id, ...values }).catch(() => {});
    return { ok: true, id: row.id };
  }

  @Get('expense-reports/:id')
  async get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return null;
    const [report] = await db.select().from(expense_reports).where(eq(expense_reports.id, id));
    if (!report) return null;
    if (!(await this.mayView(db, report, callerId))) return null;
    return report;
  }

  @Get('expense-reports/:id/items')
  async items(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return [];
    const [report] = await db
      .select({ organization_id: expense_reports.organization_id, user_id: expense_reports.user_id })
      .from(expense_reports)
      .where(eq(expense_reports.id, id));
    if (!report || !(await this.mayView(db, report, callerId))) return [];
    return db
      .select({
        ...getTableColumns(expenses),
        project_name: projects.name,
        subproject_name: subprojects.name,
      })
      .from(expense_report_items)
      .innerJoin(expenses, eq(expenses.id, expense_report_items.expense_id))
      .leftJoin(projects, eq(projects.id, expenses.project_id))
      .leftJoin(subprojects, eq(subprojects.id, expenses.subproject_id))
      .where(eq(expense_report_items.expense_report_id, id))
      .orderBy(asc(expenses.expense_date));
  }

  @Post('expense-reports/:id/items')
  async attach(@Param('id') id: string, @Body() body: { expenseId: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const [report] = await db
      .select({ organization_id: expense_reports.organization_id, user_id: expense_reports.user_id, status: expense_reports.status })
      .from(expense_reports)
      .where(eq(expense_reports.id, id));
    if (!report) return { ok: false, error: 'report-not-found' };
    if (report.user_id !== callerId) return { ok: false, error: 'forbidden' };
    if (report.status !== 'in_preparation' && report.status !== 'rejected') return { ok: false, error: 'report-not-editable' };
    const [expense] = await db
      .select({ organization_id: expenses.organization_id, user_id: expenses.user_id })
      .from(expenses)
      .where(eq(expenses.id, body.expenseId));
    if (!expense || expense.organization_id !== report.organization_id || expense.user_id !== callerId) {
      return { ok: false, error: 'expense-not-found' };
    }
    try {
      await db.insert(expense_report_items).values({
        expense_report_id: id,
        expense_id: body.expenseId,
        organization_id: report.organization_id,
      });
    } catch {
      // Most likely uq_expense_report_items_expense — the expense is already on another report.
      return { ok: false, error: 'expense-already-mapped' };
    }
    void this.versions.record('expense_report_items', body.expenseId, 'insert', callerId, { expense_report_id: id, expense_id: body.expenseId }).catch(() => {});
    return { ok: true };
  }

  @Delete('expense-reports/:id/items/:expenseId')
  async detach(@Param('id') id: string, @Param('expenseId') expenseId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const [report] = await db
      .select({ user_id: expense_reports.user_id, status: expense_reports.status })
      .from(expense_reports)
      .where(eq(expense_reports.id, id));
    if (!report) return { ok: false, error: 'report-not-found' };
    if (report.user_id !== callerId) return { ok: false, error: 'forbidden' };
    if (report.status !== 'in_preparation' && report.status !== 'rejected') return { ok: false, error: 'report-not-editable' };
    await db.delete(expense_report_items).where(and(eq(expense_report_items.expense_report_id, id), eq(expense_report_items.expense_id, expenseId)));
    void this.versions.record('expense_report_items', expenseId, 'delete', callerId, { expense_report_id: id, expense_id: expenseId }).catch(() => {});
    return { ok: true };
  }

  @Post('expense-reports/:id/submit')
  async submit(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const [report] = await db
      .select({ organization_id: expense_reports.organization_id, user_id: expense_reports.user_id, status: expense_reports.status })
      .from(expense_reports)
      .where(eq(expense_reports.id, id));
    if (!report) return { ok: false, error: 'report-not-found' };
    if (report.user_id !== callerId) return { ok: false, error: 'forbidden' };
    if (report.status !== 'in_preparation' && report.status !== 'rejected') return { ok: false, error: 'already-submitted' };

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(expense_report_items)
      .where(eq(expense_report_items.expense_report_id, id));
    if (count === 0) return { ok: false, error: 'no-items' };

    const note = (body.note ?? '').trim();
    const now = new Date().toISOString();
    // No manager on record ("top of the chain") — nobody to route the request to, so it's approved on submit.
    const managerUserId = await membershipManagerId(db, report.organization_id, callerId);
    const autoApproved = !managerUserId;
    const patch = autoApproved
      ? { status: 'approved' as const, date_submitted: now, reviewed_by_user_id: callerId, reviewed_at: now, review_note: null }
      : { status: 'submitted' as const, date_submitted: now, reviewed_by_user_id: null, reviewed_at: null, review_note: null };
    await db.update(expense_reports).set(patch).where(eq(expense_reports.id, id));
    void this.versions.record('expense_reports', id, 'update_delta', callerId, patch).catch(() => {});
    void this.audit
      .record(report.organization_id, callerId, autoApproved ? 'expense.submit-auto-approved' : 'expense.submit', 'expense_report', id, { note: note || undefined })
      .catch(() => {});

    // Route to the owner's manager as an "approve expense report" workflow — the manager acts on it via /workflows.
    if (!autoApproved && managerUserId) {
      const definition = await this.workflowsSvc.ensureDefinition(db, report.organization_id, APPROVE_EXPENSE_REPORT_WORKFLOW_NAME, "A submitted expense report awaiting the employee's manager to approve or reject it.", [
        {
          key: 'manager_review',
          label: 'Manager review',
          assignTo: 'manager',
          onApprove: { action: 'expense.approve' },
          onReject: { action: 'expense.reject' },
          source: 'Expense Report',
          source_name: 'getExpenseReportTitle',
        },
      ]);
      await this.workflowsSvc.createWorkflow(db, {
        workflowDefId: definition.workflow_def_id,
        sourceTable: 'expense_reports',
        sourceTableUuid: id,
        step: 'manager_review',
        assignedToUserId: [managerUserId],
        workflowData: { note: note || null },
        actorUserId: callerId,
        notification: { title: 'New expense report to review', body: note || undefined },
      });
    }

    return { ok: true, autoApproved };
  }

  @Post('expense-reports/:id/approve')
  async approve(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const pending = await this.workflowsSvc.findPending(db, 'expense_reports', id, APPROVE_EXPENSE_REPORT_WORKFLOW_NAME);
    if (!pending) return { ok: false, error: 'no-pending-workflow' };
    return this.workflowsSvc.resolve(db, pending.id, callerId, 'approved', body?.note);
  }

  @Post('expense-reports/:id/reject')
  async reject(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const pending = await this.workflowsSvc.findPending(db, 'expense_reports', id, APPROVE_EXPENSE_REPORT_WORKFLOW_NAME);
    if (!pending) return { ok: false, error: 'no-pending-workflow' };
    return this.workflowsSvc.resolve(db, pending.id, callerId, 'rejected', body?.note);
  }

  /**
   * Finance-pipeline forward march: `submitted_processing` -> `processing_finished` ->
   * `request_payment` -> `finished` (plus the `approved` -> `submitted_processing` first step).
   * Not workflow-engine-backed — there's no per-stage decision, just a billing_admin/admin
   * recording that the next stage is done.
   */
  @Post('expense-reports/:id/advance')
  async advance(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [report] = await db
      .select({ organization_id: expense_reports.organization_id, status: expense_reports.status, data: expense_reports.data })
      .from(expense_reports)
      .where(eq(expense_reports.id, id));
    if (!report) return { ok: false, error: 'report-not-found' };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgBillingAdmin(db, report.organization_id, callerId))) return { ok: false, error: 'forbidden' };
    const nextStatus = nextPipelineStage(report.status);
    if (!nextStatus) return { ok: false, error: 'not-advanceable' };

    const now = new Date().toISOString();
    const existingData = (report.data ?? {}) as { history?: unknown[] };
    const history = [...(existingData.history ?? []), { stage: nextStatus, note: body.note?.trim() || null, actorUserId: callerId, at: now }];
    const patch = { status: nextStatus, data: { ...existingData, history } };
    await db.update(expense_reports).set(patch).where(eq(expense_reports.id, id));
    void this.versions.record('expense_reports', id, 'update_delta', callerId, patch).catch(() => {});
    void this.audit.record(report.organization_id, callerId, 'expense.advance', 'expense_report', id, { toStatus: nextStatus }).catch(() => {});
    return { ok: true, status: nextStatus };
  }

  /** Self, that person's manager, or an org admin may view a report. */
  private async mayView(db: NonNullable<ReturnType<DbService['getDb']>>, report: { organization_id: string; user_id: string }, callerId: string): Promise<boolean> {
    if (report.user_id === callerId) return true;
    if (await isOrgAdmin(db, report.organization_id, callerId)) return true;
    return isManagerOf(db, report.organization_id, callerId, report.user_id);
  }
}
