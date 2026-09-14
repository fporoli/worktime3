import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { workflows, workflow_definitions, timesheet_periods, users } from './db/schema';
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

    // Enrich timesheet_periods-sourced rows with the owner's name and which month it is —
    // generic-shaped rows otherwise, but this covers both workflow types today.
    const periodIds = rows.filter((r) => r.source_table === 'timesheet_periods').map((r) => r.source_table_uuid);
    if (periodIds.length === 0) return rows.map((r) => ({ ...r, timesheet_period: null }));
    const periodRows = await db
      .select({
        id: timesheet_periods.id,
        period_start: timesheet_periods.period_start,
        user_id: timesheet_periods.user_id,
        user_display_name: users.display_name,
        user_email: users.email,
      })
      .from(timesheet_periods)
      .innerJoin(users, eq(users.id, timesheet_periods.user_id))
      .where(inArray(timesheet_periods.id, periodIds));
    const periodById = new Map(periodRows.map((p) => [p.id, p]));
    return rows.map((r) => ({ ...r, timesheet_period: r.source_table === 'timesheet_periods' ? (periodById.get(r.source_table_uuid) ?? null) : null }));
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
