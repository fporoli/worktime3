import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { workflows, workflow_definitions, project_timesheets, expense_reports, absences, users } from './db/schema';
import { WorkflowsService } from './workflows.service';

/**
 * Generic surface over any workflow_definitions-driven approval: a manager's
 * (or whoever's) action-item queue, and approve/reject for whichever
 * workflow it is — see WorkflowsService for the actual engine. The frontend
 * "Approvals" screen is entirely driven by `assigned-to-me`, regardless of
 * workflow type.
 */
@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly db: DbService,
    private readonly workflowsSvc: WorkflowsService,
  ) {}

  /**
   * Workflows with a step assigned to the caller, directly or through any team they belong to —
   * their action-item queue. Defaults to just the pending ones.
   */
  @Get('assigned-to-me')
  async assignedToMe(@Req() req: AuthenticatedRequest, @Query('status') status?: string) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return [];
    const teamIds = await this.workflowsSvc.callerTeamIds(db, callerId);
    const assignedToCaller = sql`${workflows.assigned_to_user_id} @> ARRAY[${callerId}]::uuid[]`;
    const assignment = teamIds.length > 0 ? or(assignedToCaller, inArray(workflows.assigned_to_team_id, teamIds)) : assignedToCaller;
    const conditions = [assignment, eq(workflows.step_status, status ?? 'pending')];
    const rawRows = await db
      .select({
        id: workflows.workflow_id,
        source_table: workflows.source_table,
        source_table_uuid: workflows.source_table_uuid,
        step: workflows.step,
        step_status: workflows.step_status,
        workflow_data: workflows.workflow_data,
        started: workflows.workflow_step_started,
        definition_name: workflow_definitions.name,
        steps: workflow_definitions.steps,
      })
      .from(workflows)
      .innerJoin(workflow_definitions, eq(workflow_definitions.workflow_def_id, workflows.workflow_def_id))
      .where(and(...conditions))
      .orderBy(desc(workflows.workflow_step_started));

    // The "corresponding object" label/formatter for this row's step come from its workflow_definitions'
    // steps config (`source` / `source_name`) rather than being hardcoded per workflow type here.
    const rows = rawRows.map(({ steps, ...r }) => {
      const stepDefs = Array.isArray(steps) ? (steps as Array<{ key?: string; source?: string; source_name?: string }>) : [];
      const stepDef = stepDefs.find((s) => s.key === r.step);
      return { ...r, source: stepDef?.source ?? null, source_name: stepDef?.source_name ?? null };
    });

    // Enrich project_timesheets-/expense_reports-sourced rows with the owner's name and what the
    // record is — generic-shaped rows otherwise, but this covers every workflow type today.
    const periodIds = rows.filter((r) => r.source_table === 'project_timesheets').map((r) => r.source_table_uuid);
    const reportIds = rows.filter((r) => r.source_table === 'expense_reports').map((r) => r.source_table_uuid);
    const absenceIds = rows.filter((r) => r.source_table === 'absences').map((r) => r.source_table_uuid);

    const periodRows = periodIds.length
      ? await db
          .select({
            id: project_timesheets.id,
            period_start: project_timesheets.period_start,
            user_id: project_timesheets.user_id,
            user_display_name: users.display_name,
            user_email: users.email,
          })
          .from(project_timesheets)
          .innerJoin(users, eq(users.id, project_timesheets.user_id))
          .where(inArray(project_timesheets.id, periodIds))
      : [];
    const reportRows = reportIds.length
      ? await db
          .select({
            id: expense_reports.id,
            status: expense_reports.status,
            date_submitted: expense_reports.date_submitted,
            user_id: expense_reports.user_id,
            user_display_name: users.display_name,
            user_email: users.email,
          })
          .from(expense_reports)
          .innerJoin(users, eq(users.id, expense_reports.user_id))
          .where(inArray(expense_reports.id, reportIds))
      : [];
    const absenceRows = absenceIds.length
      ? await db
          .select({
            id: absences.id,
            date_start: absences.date_start,
            date_end: absences.date_end,
            absence_type: absences.absence_type,
            half_day: absences.half_day,
            document_id: absences.document_id,
            user_id: absences.user_id,
            user_display_name: users.display_name,
            user_email: users.email,
          })
          .from(absences)
          .innerJoin(users, eq(users.id, absences.user_id))
          .where(inArray(absences.id, absenceIds))
      : [];
    const periodById = new Map(periodRows.map((p) => [p.id, p]));
    const reportById = new Map(reportRows.map((r) => [r.id, r]));
    const absenceById = new Map(absenceRows.map((a) => [a.id, a]));
    return rows.map((r) => ({
      ...r,
      project_timesheet: r.source_table === 'project_timesheets' ? (periodById.get(r.source_table_uuid) ?? null) : null,
      expense_report: r.source_table === 'expense_reports' ? (reportById.get(r.source_table_uuid) ?? null) : null,
      absence: r.source_table === 'absences' ? (absenceById.get(r.source_table_uuid) ?? null) : null,
    }));
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    return this.workflowsSvc.resolve(db, id, callerId, 'approved', body?.note);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    return this.workflowsSvc.resolve(db, id, callerId, 'rejected', body?.note);
  }
}
