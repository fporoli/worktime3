import { Body, Controller, Get, OnModuleInit, Param, Post, Query, Req } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { callerUserId, canSeeUserData, isOrgMember, reachesAll } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { project_time_periods, projects, users, workflows } from './db/schema';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { WorkflowsService, APPROVE_PROJECT_TIMESHEET_WORKFLOW_NAME } from './workflows.service';
import { nextMonth } from '@worktime3/shared/worktime';

const OBJECT = 'nav.projectTimesheet';

export interface ProjectMonthTotal {
  project_id: string | null;
  project_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  minutes: number;
  entries: number;
}

/**
 * How a project month is routed on submit: to the project's owner, or approved right away when
 * there is nobody else to approve it (no owner, or the person owns the project themselves).
 */
export function projectApprover(ownerUserId: string | null, submitterId: string): string | null {
  return ownerUserId && ownerUserId !== submitterId ? ownerUserId : null;
}

/**
 * Project timesheet: an employee submits a month's project time, and each project's hours go to
 * that project's owner for approval (Approvals page). Separate from the working-time timesheet
 * (timesheets.controller.ts), which the line manager approves and which feeds the balances. A
 * submitted or approved project month locks that person's project time on that project
 * (`isProjectPeriodLocked`); a rejected or reopened one can be corrected and submitted again.
 */
@Controller()
export class ProjectTimesheetsController implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
    private readonly workflowsSvc: WorkflowsService,
  ) {}

  onModuleInit() {
    this.workflowsSvc.registerSourceOrgResolver('project_time_periods', async (db, id) => {
      const [row] = await db.select({ organization_id: project_time_periods.organization_id }).from(project_time_periods).where(eq(project_time_periods.id, id));
      return row?.organization_id ?? null;
    });
    this.workflowsSvc.registerAction('project-timesheet.approve', async (db, ctx) => {
      const patch = { status: 'approved' as const, reviewed_by_user_id: ctx.actorUserId, reviewed_at: new Date().toISOString(), review_note: null };
      await db.update(project_time_periods).set(patch).where(eq(project_time_periods.id, ctx.sourceTableUuid));
      void this.versions.record('project_time_periods', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
    });
    this.workflowsSvc.registerAction('project-timesheet.reject', async (db, ctx) => {
      const patch = { status: 'rejected' as const, reviewed_by_user_id: ctx.actorUserId, reviewed_at: new Date().toISOString(), review_note: ctx.decisionNote };
      await db.update(project_time_periods).set(patch).where(eq(project_time_periods.id, ctx.sourceTableUuid));
      void this.versions.record('project_time_periods', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
    });
  }

  /** A person's project time in a month (`YYYY-MM`) per project, with each project month's status. */
  @Get('organizations/:orgId/project-timesheets')
  async month(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('month') month?: string, @Query('userId') userId?: string) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, projects: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', projects: [] };
    const target = userId || callerId;
    if (target !== callerId && !(await canSeeUserData(db, orgId, callerId, OBJECT, target))) return { ok: false, error: 'forbidden', projects: [] };
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')) return { ok: false, error: 'invalid-month', projects: [] };
    const periodStart = `${month}-01`;

    const [totals, periods] = await Promise.all([
      this.monthTotals(db, orgId, target, periodStart),
      db
        .select({
          id: project_time_periods.id,
          project_id: project_time_periods.project_id,
          status: project_time_periods.status,
          submitted_at: project_time_periods.submitted_at,
          reviewed_at: project_time_periods.reviewed_at,
          review_note: project_time_periods.review_note,
          reviewer_name: users.display_name,
        })
        .from(project_time_periods)
        .leftJoin(users, eq(users.id, project_time_periods.reviewed_by_user_id))
        .where(and(eq(project_time_periods.organization_id, orgId), eq(project_time_periods.user_id, target), eq(project_time_periods.period_start, periodStart))),
    ]);
    const periodByProject = new Map(periods.map((p) => [p.project_id, p]));
    const rows = totals.filter((t) => t.project_id).map((t) => ({ ...t, period: periodByProject.get(t.project_id as string) ?? null }));
    // A submitted month whose entries were since moved elsewhere still shows, with no hours.
    for (const p of periods) {
      if (!rows.some((r) => r.project_id === p.project_id)) {
        const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, p.project_id));
        rows.push({ project_id: p.project_id, project_name: project?.name ?? null, owner_user_id: null, owner_name: null, minutes: 0, entries: 0, period: p });
      }
    }
    const unassigned = totals.find((t) => !t.project_id);
    return { ok: true, month: periodStart, projects: rows, unassigned: unassigned ? { minutes: unassigned.minutes, entries: unassigned.entries } : { minutes: 0, entries: 0 } };
  }

  /** The caller's locked project months (submitted or approved), for the project-time page. */
  @Get('organizations/:orgId/project-timesheets/locks')
  async locks(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return [];
    const rows = await db
      .select({ project_id: project_time_periods.project_id, period_start: project_time_periods.period_start, status: project_time_periods.status })
      .from(project_time_periods)
      .where(and(eq(project_time_periods.organization_id, orgId), eq(project_time_periods.user_id, callerId)));
    return rows.filter((r) => r.status === 'submitted' || r.status === 'approved');
  }

  /** Submits every project of the month that isn't submitted or approved yet, each to its owner. */
  @Post('organizations/:orgId/project-timesheets/submit')
  async submit(@Param('orgId') orgId: string, @Body() body: { periodStart?: string; note?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const periodStart = (body.periodStart ?? '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(periodStart)) return { ok: false, error: 'invalid-period-start' };
    const note = (body.note ?? '').trim() || null;

    const totals = await this.monthTotals(db, orgId, callerId, periodStart);
    const unassigned = totals.find((t) => !t.project_id);
    // Hours without a project have nobody to approve them: book them to a project first.
    if (unassigned && unassigned.entries > 0) return { ok: false, error: 'unassigned-entries', entries: unassigned.entries };

    const existing = await db
      .select({ id: project_time_periods.id, project_id: project_time_periods.project_id, status: project_time_periods.status })
      .from(project_time_periods)
      .where(and(eq(project_time_periods.organization_id, orgId), eq(project_time_periods.user_id, callerId), eq(project_time_periods.period_start, periodStart)));
    const byProject = new Map(existing.map((p) => [p.project_id, p]));
    const toSubmit = totals.filter((t) => t.project_id && !['submitted', 'approved'].includes(byProject.get(t.project_id)?.status ?? 'open'));
    if (toSubmit.length === 0) return { ok: false, error: 'nothing-to-submit' };

    const now = new Date().toISOString();
    const definition = await this.workflowsSvc.ensureDefinition(db, orgId, APPROVE_PROJECT_TIMESHEET_WORKFLOW_NAME, "A month of an employee's project time awaiting the project owner's approval.", [
      {
        key: 'project_owner_review',
        label: 'Project owner review',
        assignTo: 'project_owner',
        onApprove: { action: 'project-timesheet.approve' },
        onReject: { action: 'project-timesheet.reject' },
        source: 'Project time',
        source_name: 'getProjectTimesheetTitle',
      },
    ]);

    const results: { projectId: string; projectName: string | null; status: 'submitted' | 'approved' }[] = [];
    for (const t of toSubmit) {
      const projectId = t.project_id as string;
      const approver = projectApprover(t.owner_user_id, callerId);
      const review = approver
        ? { status: 'submitted' as const, reviewed_by_user_id: null, reviewed_at: null }
        : { status: 'approved' as const, reviewed_by_user_id: callerId, reviewed_at: now };
      const prior = byProject.get(projectId);
      let periodId: string;
      if (prior) {
        const patch = { ...review, submitted_at: now, review_note: null };
        await db.update(project_time_periods).set(patch).where(eq(project_time_periods.id, prior.id));
        void this.versions.record('project_time_periods', prior.id, 'update_delta', callerId, patch).catch(() => {});
        periodId = prior.id;
      } else {
        const values = { organization_id: orgId, user_id: callerId, project_id: projectId, period_start: periodStart, period_end: nextMonth(periodStart), ...review, submitted_at: now };
        const [created] = await db.insert(project_time_periods).values(values).returning({ id: project_time_periods.id });
        void this.versions.record('project_time_periods', created.id, 'insert', callerId, { id: created.id, ...values }).catch(() => {});
        periodId = created.id;
      }
      if (approver) {
        await this.workflowsSvc.createWorkflow(db, {
          workflowDefId: definition.workflow_def_id,
          sourceTable: 'project_time_periods',
          sourceTableUuid: periodId,
          step: 'project_owner_review',
          assignedToUserId: [approver],
          workflowData: { note },
          actorUserId: callerId,
          notification: { title: `Project time to review: ${t.project_name ?? ''}`.trim(), body: note ?? undefined },
        });
      }
      void this.audit
        .record(orgId, callerId, approver ? 'project-timesheet.submit' : 'project-timesheet.submit-auto-approved', 'project_time_period', periodId, { periodStart, projectId })
        .catch(() => {});
      results.push({ projectId, projectName: t.project_name, status: review.status });
    }
    return { ok: true, projects: results };
  }

  /** The entries behind one project month, for the person, the project's owner or an approvals override. */
  @Get('project-timesheets/:id/entries')
  async entries(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, entries: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated', entries: [] };
    const period = await this.findPeriod(db, id);
    if (!period) return { ok: false, error: 'not-found', entries: [] };
    if (!(await this.mayReview(db, period, callerId)) && !(period.user_id === callerId || (await canSeeUserData(db, period.organization_id, callerId, OBJECT, period.user_id)))) {
      return { ok: false, error: 'forbidden', entries: [] };
    }
    const result = await db.execute(sql`
      SELECT pt.id, pt.start_time, pt.end_time, pt.comment, sp.name AS subproject_name,
             EXTRACT(EPOCH FROM (pt.end_time - pt.start_time)) / 60 AS minutes
      FROM project_times pt
      LEFT JOIN subprojects sp ON sp.id = pt.subproject_id
      WHERE pt.organization_id = ${period.organization_id} AND pt.user_id = ${period.user_id} AND pt.project_id = ${period.project_id}
        AND pt.start_time::date >= ${period.period_start}::date AND pt.start_time::date < ${period.period_end}::date
      ORDER BY pt.start_time`);
    return {
      ok: true,
      period,
      entries: (result.rows as { minutes: string | number }[]).map((r) => ({ ...r, minutes: Math.round(Number(r.minutes)) })),
    };
  }

  /** The project's owner (or an approvals override) reopens an approved month so it can be corrected. */
  @Post('project-timesheets/:id/reopen')
  async reopen(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const period = await this.findPeriod(db, id);
    if (!period) return { ok: false, error: 'not-found' };
    if (!(await this.mayReview(db, period, callerId))) return { ok: false, error: 'forbidden' };
    if (period.status !== 'approved') return { ok: false, error: 'not-approved' };
    const patch = { status: 'open' as const, reviewed_by_user_id: null, reviewed_at: null, review_note: null };
    await db.update(project_time_periods).set(patch).where(eq(project_time_periods.id, id));
    void this.versions.record('project_time_periods', id, 'update_delta', callerId, patch).catch(() => {});
    void this.audit.record(period.organization_id, callerId, 'project-timesheet.reopen', 'project_time_period', id, {}).catch(() => {});
    return { ok: true };
  }

  /** The person withdraws a submitted month (before it's decided), to correct it. */
  @Post('project-timesheets/:id/withdraw')
  async withdraw(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const period = await this.findPeriod(db, id);
    if (!period) return { ok: false, error: 'not-found' };
    if (period.user_id !== callerId) return { ok: false, error: 'forbidden' };
    if (period.status !== 'submitted') return { ok: false, error: 'not-submitted' };
    const pending = await this.workflowsSvc.findPending(db, 'project_time_periods', id);
    if (pending) await db.update(workflows).set({ step_status: 'cancelled', workflow_finished: new Date().toISOString() }).where(eq(workflows.workflow_id, pending.id));
    const patch = { status: 'open' as const, submitted_at: null };
    await db.update(project_time_periods).set(patch).where(eq(project_time_periods.id, id));
    void this.versions.record('project_time_periods', id, 'update_delta', callerId, patch).catch(() => {});
    return { ok: true };
  }

  /** Minutes and entries per project (null = no project) of a person's month, with each project's owner. */
  private async monthTotals(db: Db, orgId: string, userId: string, periodStart: string): Promise<ProjectMonthTotal[]> {
    const result = await db.execute(sql`
      SELECT pt.project_id, p.name AS project_name, p.owner_user_id, u.display_name AS owner_name,
             SUM(EXTRACT(EPOCH FROM (pt.end_time - pt.start_time))) / 60 AS minutes, COUNT(*) AS entries
      FROM project_times pt
      LEFT JOIN projects p ON p.id = pt.project_id
      LEFT JOIN users u ON u.id = p.owner_user_id
      WHERE pt.organization_id = ${orgId} AND pt.user_id = ${userId}
        AND pt.start_time::date >= ${periodStart}::date AND pt.start_time::date < ${nextMonth(periodStart)}::date
      GROUP BY pt.project_id, p.name, p.owner_user_id, u.display_name
      ORDER BY p.name NULLS LAST`);
    return (result.rows as Record<string, unknown>[]).map((r) => ({
      project_id: (r.project_id as string | null) ?? null,
      project_name: (r.project_name as string | null) ?? null,
      owner_user_id: (r.owner_user_id as string | null) ?? null,
      owner_name: (r.owner_name as string | null) ?? null,
      minutes: Math.round(Number(r.minutes)),
      entries: Number(r.entries),
    }));
  }

  private async findPeriod(db: Db, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [row] = await db
      .select({
        id: project_time_periods.id,
        organization_id: project_time_periods.organization_id,
        user_id: project_time_periods.user_id,
        project_id: project_time_periods.project_id,
        project_name: projects.name,
        owner_user_id: projects.owner_user_id,
        period_start: project_time_periods.period_start,
        period_end: project_time_periods.period_end,
        status: project_time_periods.status,
      })
      .from(project_time_periods)
      .innerJoin(projects, eq(projects.id, project_time_periods.project_id))
      .where(eq(project_time_periods.id, id));
    return row ?? null;
  }

  /** The project's owner, or someone whose approvals grant reaches everyone (admin by default). */
  private async mayReview(db: Db, period: { organization_id: string; owner_user_id: string | null }, callerId: string): Promise<boolean> {
    if (period.owner_user_id === callerId) return true;
    return reachesAll(db, period.organization_id, callerId, 'nav.approvals', 'edit');
  }
}

