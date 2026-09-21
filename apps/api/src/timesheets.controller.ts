import { Body, Controller, Get, OnModuleInit, Param, Post, Query, Req } from '@nestjs/common';
import { and, desc, eq, getTableColumns, inArray, type SQL } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, directReportUserIds, isManagerOf, isOrgAdmin, isOrgMember, membershipManagerId } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { timesheet_periods, users, workflows } from './db/schema';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { WorkflowsService, REOPEN_TIMESHEET_WORKFLOW_NAME, APPROVE_TIMESHEET_WORKFLOW_NAME } from './workflows.service';
import { BalancesService } from './balances.service';

const STATUSES = ['open', 'submitted', 'approved', 'rejected'] as const;
type Status = (typeof STATUSES)[number];

/** First day of the month after `periodStart` (a 'YYYY-MM-01' string) — the period's exclusive end. */
export function nextMonthStart(periodStart: string): string {
  const [y, m] = periodStart.split('-').map(Number);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

@Controller()
export class TimesheetsController implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
    private readonly workflowsSvc: WorkflowsService,
    private readonly balances: BalancesService,
  ) {}

  /**
   * Timesheets own what "timesheet.*" workflow actions actually do, and how to resolve a
   * timesheet_periods row's organization — WorkflowsService only knows the names, not the behavior.
   */
  onModuleInit() {
    this.workflowsSvc.registerSourceOrgResolver('timesheet_periods', async (db, sourceTableUuid) => {
      const [period] = await db
        .select({ organization_id: timesheet_periods.organization_id })
        .from(timesheet_periods)
        .where(eq(timesheet_periods.id, sourceTableUuid));
      return period?.organization_id ?? null;
    });

    this.workflowsSvc.registerAction('timesheet.approve', async (db, ctx) => {
      const patch = { status: 'approved' as const, reviewed_by_user_id: ctx.actorUserId, reviewed_at: new Date().toISOString(), review_note: null };
      await db.update(timesheet_periods).set(patch).where(eq(timesheet_periods.id, ctx.sourceTableUuid));
      void this.versions.record('timesheet_periods', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
      await this.balances.applyTimesheetApproval(db, ctx.sourceTableUuid);
    });

    this.workflowsSvc.registerAction('timesheet.reject', async (db, ctx) => {
      const patch = { status: 'rejected' as const, reviewed_by_user_id: ctx.actorUserId, reviewed_at: new Date().toISOString(), review_note: ctx.decisionNote };
      await db.update(timesheet_periods).set(patch).where(eq(timesheet_periods.id, ctx.sourceTableUuid));
      void this.versions.record('timesheet_periods', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
    });

    this.workflowsSvc.registerAction('timesheet.reopen', async (db, ctx) => {
      const patch = { status: 'open' as const, reviewed_by_user_id: null, reviewed_at: null, review_note: null };
      await db.update(timesheet_periods).set(patch).where(eq(timesheet_periods.id, ctx.sourceTableUuid));
      void this.versions.record('timesheet_periods', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
      await this.balances.reverseTimesheetApproval(db, ctx.sourceTableUuid);
    });
  }

  @Get('organizations/:orgId/timesheet-periods')
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
    const conditions: SQL[] = [eq(timesheet_periods.organization_id, orgId)];
    if (userId) {
      // Someone else's periods: admins can view anyone's; everyone else only that person's own manager.
      if (userId !== callerId && !isAdmin && !(await isManagerOf(db, orgId, callerId, userId))) return [];
      conditions.push(eq(timesheet_periods.user_id, userId));
    } else if (!isAdmin) {
      // No target given: your own periods, plus your direct reports' (e.g. ?status=submitted for an approval queue).
      const reportIds = await directReportUserIds(db, orgId, callerId);
      conditions.push(inArray(timesheet_periods.user_id, [callerId, ...reportIds]));
    }
    if (status && (STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(timesheet_periods.status, status as Status));
    }

    return db
      .select({
        ...getTableColumns(timesheet_periods),
        user_display_name: users.display_name,
        user_email: users.email,
      })
      .from(timesheet_periods)
      .innerJoin(users, eq(users.id, timesheet_periods.user_id))
      .where(and(...conditions))
      .orderBy(desc(timesheet_periods.period_start));
  }

  @Post('organizations/:orgId/timesheet-periods/submit')
  async submit(
    @Param('orgId') orgId: string,
    @Body() body: { periodStart: string; note?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };

    const periodStart = (body.periodStart ?? '').trim();
    if (!/^\d{4}-\d{2}-01$/.test(periodStart)) return { ok: false, error: 'invalid-period-start' };
    const note = (body.note ?? '').trim();

    const [existing] = await db
      .select({ id: timesheet_periods.id, status: timesheet_periods.status })
      .from(timesheet_periods)
      .where(
        and(
          eq(timesheet_periods.organization_id, orgId),
          eq(timesheet_periods.user_id, callerId),
          eq(timesheet_periods.period_start, periodStart),
        ),
      );
    if (existing && (existing.status === 'submitted' || existing.status === 'approved')) {
      return { ok: false, error: 'already-submitted' };
    }

    const now = new Date().toISOString();
    // No manager on record ("top of the chain") — nobody to route the request to, so it's approved on submit.
    const managerUserId = await membershipManagerId(db, orgId, callerId);
    const autoApproved = !managerUserId;
    const reviewFields = autoApproved
      ? { status: 'approved' as const, reviewed_by_user_id: callerId, reviewed_at: now }
      : { status: 'submitted' as const, reviewed_by_user_id: null, reviewed_at: null };

    let periodId: string;
    if (existing) {
      const patch = { ...reviewFields, submitted_at: now, review_note: null };
      await db.update(timesheet_periods).set(patch).where(eq(timesheet_periods.id, existing.id));
      void this.versions.record('timesheet_periods', existing.id, 'update_delta', callerId, patch).catch(() => {});
      periodId = existing.id;
    } else {
      const values = {
        organization_id: orgId,
        user_id: callerId,
        period_start: periodStart,
        period_end: nextMonthStart(periodStart),
        ...reviewFields,
        submitted_at: now,
      };
      const [created] = await db.insert(timesheet_periods).values(values).returning({ id: timesheet_periods.id });
      void this.versions.record('timesheet_periods', created.id, 'insert', callerId, { id: created.id, ...values }).catch(() => {});
      periodId = created.id;
    }
    void this.audit
      .record(orgId, callerId, autoApproved ? 'timesheet.submit-auto-approved' : 'timesheet.submit', 'timesheet_period', periodId, { periodStart, note: note || undefined })
      .catch(() => {});

    // Route to the owner's manager as an "approve timesheet" workflow — the manager acts on it via /workflows.
    if (!autoApproved && managerUserId) {
      const definition = await this.workflowsSvc.ensureDefinition(db, orgId, APPROVE_TIMESHEET_WORKFLOW_NAME, "A submitted month awaiting the employee's manager to approve or reject it.", [
        {
          key: 'manager_review',
          label: 'Manager review',
          assignTo: 'manager',
          onApprove: { action: 'timesheet.approve' },
          onReject: { action: 'timesheet.reject' },
          source: 'Timesheet Period',
          source_name: 'getSourceTitle',
        },
      ]);
      await this.workflowsSvc.createWorkflow(db, {
        workflowDefId: definition.workflow_def_id,
        sourceTable: 'timesheet_periods',
        sourceTableUuid: periodId,
        step: 'manager_review',
        assignedToUserId: [managerUserId],
        // The employee's optional note to their manager lives right here, on the workflow row.
        workflowData: { note: note || null },
        actorUserId: callerId,
        notification: { title: 'New timesheet to review', body: note || undefined },
      });
    }

    return { ok: true, id: periodId, autoApproved };
  }

  @Post('timesheet-periods/:id/approve')
  async approve(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.reviewOrDelegate(id, req, 'approved');
  }

  @Post('timesheet-periods/:id/reject')
  async reject(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: AuthenticatedRequest) {
    return this.reviewOrDelegate(id, req, 'rejected', body?.note);
  }

  /**
   * Period-id-based approve/reject, kept as the stable API the frontend
   * calls — but the actual work now happens through WorkflowsService,
   * against that period's "approve timesheet" workflow (created by
   * `submit`). Falls back to the pre-workflow direct-mutation path only for
   * periods submitted before this existed, which have no workflow row.
   */
  private async reviewOrDelegate(id: string, req: AuthenticatedRequest, outcome: 'approved' | 'rejected', note?: string) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const pending = await this.workflowsSvc.findPending(db, 'timesheet_periods', id, APPROVE_TIMESHEET_WORKFLOW_NAME);
    if (pending) return this.workflowsSvc.resolve(db, pending.id, callerId, outcome, note);
    return this.legacyReview(db, id, callerId, outcome, note);
  }

  private async legacyReview(
    db: NonNullable<ReturnType<DbService['getDb']>>,
    id: string,
    callerId: string,
    newStatus: 'approved' | 'rejected',
    note?: string,
  ) {
    const [period] = await db
      .select({ organization_id: timesheet_periods.organization_id, status: timesheet_periods.status, user_id: timesheet_periods.user_id })
      .from(timesheet_periods)
      .where(eq(timesheet_periods.id, id));
    if (!period) return { ok: false, error: 'period-not-found' };
    // Only that person's own manager may review their period — an org admin may always override.
    const isAdmin = await isOrgAdmin(db, period.organization_id, callerId);
    if (!isAdmin && !(await isManagerOf(db, period.organization_id, callerId, period.user_id))) {
      return { ok: false, error: 'forbidden' };
    }
    if (period.status !== 'submitted') return { ok: false, error: 'not-submitted' };
    const patch = {
      status: newStatus,
      reviewed_by_user_id: callerId,
      reviewed_at: new Date().toISOString(),
      review_note: note?.trim() || null,
    };
    await db.update(timesheet_periods).set(patch).where(eq(timesheet_periods.id, id));
    void this.audit
      .record(period.organization_id, callerId, `timesheet.${newStatus === 'approved' ? 'approve' : 'reject'}`, 'timesheet_period', id, note ? { note } : undefined)
      .catch(() => {});
    void this.versions.record('timesheet_periods', id, 'update_delta', callerId, patch).catch(() => {});
    if (newStatus === 'approved') await this.balances.applyTimesheetApproval(db, id);
    return { ok: true };
  }

  /** Admin-only undo: an approved period can be reopened for correction. */
  @Post('timesheet-periods/:id/reopen')
  async reopen(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [period] = await db
      .select({ organization_id: timesheet_periods.organization_id, status: timesheet_periods.status })
      .from(timesheet_periods)
      .where(eq(timesheet_periods.id, id));
    if (!period) return { ok: false, error: 'period-not-found' };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(db, period.organization_id, callerId))) return { ok: false, error: 'forbidden' };
    if (period.status !== 'approved') return { ok: false, error: 'not-approved' };
    const patch = { status: 'open' as const, reviewed_by_user_id: null, reviewed_at: null, review_note: null };
    await db.update(timesheet_periods).set(patch).where(eq(timesheet_periods.id, id));
    void this.audit.record(period.organization_id, callerId, 'timesheet.reopen', 'timesheet_period', id).catch(() => {});
    void this.versions.record('timesheet_periods', id, 'update_delta', callerId, patch).catch(() => {});
    await this.balances.reverseTimesheetApproval(db, id);
    return { ok: true };
  }

  /**
   * Self-service: the period's own owner asks their manager to reopen an
   * already-approved month, with a reason. Creates one "reopen approved
   * timesheet" workflow row, assigned to that person's manager — see
   * WorkflowsController for how the manager actually approves/rejects it.
   */
  @Post('timesheet-periods/:id/request-reopen')
  async requestReopen(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [period] = await db
      .select({ organization_id: timesheet_periods.organization_id, status: timesheet_periods.status, user_id: timesheet_periods.user_id })
      .from(timesheet_periods)
      .where(eq(timesheet_periods.id, id));
    if (!period) return { ok: false, error: 'period-not-found' };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (period.user_id !== callerId) return { ok: false, error: 'forbidden' };
    if (period.status !== 'approved') return { ok: false, error: 'not-approved' };

    const reason = (body.reason ?? '').trim();
    if (!reason) return { ok: false, error: 'reason-required' };

    const managerUserId = await membershipManagerId(db, period.organization_id, callerId);
    if (!managerUserId) return { ok: false, error: 'no-manager-to-ask' };

    const existingPending = await this.workflowsSvc.findPending(db, 'timesheet_periods', id, REOPEN_TIMESHEET_WORKFLOW_NAME);
    if (existingPending) return { ok: false, error: 'already-requested' };

    const definition = await this.workflowsSvc.ensureDefinition(
      db,
      period.organization_id,
      REOPEN_TIMESHEET_WORKFLOW_NAME,
      "An employee's request to reopen a month their manager already approved, for correction.",
      [
        {
          key: 'manager_review',
          label: 'Manager review',
          assignTo: 'manager',
          onApprove: { action: 'timesheet.reopen' },
          onReject: { action: 'none' },
          source: 'Timesheet Period',
          source_name: 'getSourceTitle',
        },
      ],
    );
    const workflow = await this.workflowsSvc.createWorkflow(db, {
      workflowDefId: definition.workflow_def_id,
      sourceTable: 'timesheet_periods',
      sourceTableUuid: id,
      step: 'manager_review',
      assignedToUserId: [managerUserId],
      // The requester's text lives right here, on the workflow row.
      workflowData: { reason },
      actorUserId: callerId,
      notification: { title: 'Reopen request for an approved timesheet', body: reason },
    });
    void this.audit.record(period.organization_id, callerId, 'timesheet.request-reopen', 'timesheet_period', id, { reason }).catch(() => {});
    return { ok: true, workflowId: workflow.id };
  }

  /** The most recent reopen-request workflow for this period (any status), so the owner's UI can show where it stands. */
  @Get('timesheet-periods/:id/reopen-request')
  async reopenRequest(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const [period] = await db
      .select({ organization_id: timesheet_periods.organization_id, user_id: timesheet_periods.user_id })
      .from(timesheet_periods)
      .where(eq(timesheet_periods.id, id));
    if (!period) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return null;
    if (period.user_id !== callerId && !(await isOrgAdmin(db, period.organization_id, callerId))) return null;

    const [row] = await db
      .select({
        id: workflows.workflow_id,
        step_status: workflows.step_status,
        workflow_data: workflows.workflow_data,
        started: workflows.workflow_step_started,
        finished: workflows.workflow_step_finished,
      })
      .from(workflows)
      .where(and(eq(workflows.source_table, 'timesheet_periods'), eq(workflows.source_table_uuid, id)))
      .orderBy(desc(workflows.workflow_started))
      .limit(1);
    return row ?? null;
  }
}
