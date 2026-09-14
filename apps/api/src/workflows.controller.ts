import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
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

  /** Workflows with a step assigned to the caller — their action-item queue. Defaults to just the pending ones. */
  @Get('assigned-to-me')
  async assignedToMe(@Req() req: AuthenticatedRequest, @Query('status') status?: string) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return [];
    const conditions = [sql`${workflows.assigned_to_user_id} @> ARRAY[${callerId}]::uuid[]`, eq(workflows.step_status, status ?? 'pending')];
    const rows = await db
      .select({
        id: workflows.workflow_id,
        source_table: workflows.source_table,
        source_table_uuid: workflows.source_table_uuid,
        step: workflows.step,
        step_status: workflows.step_status,
        workflow_data: workflows.workflow_data,
        started: workflows.workflow_step_started,
        definition_name: workflow_definitions.name,
      })
      .from(workflows)
      .innerJoin(workflow_definitions, eq(workflow_definitions.workflow_def_id, workflows.workflow_def_id))
      .where(and(...conditions))
      .orderBy(desc(workflows.workflow_step_started));

    // Enrich timesheet_periods-sourced rows with the owner's name and which month it is —
    // generic-shaped rows otherwise, but this covers both workflow types today.
    const periodIds = rows.filter((r) => r.source_table === 'timesheet_periods').map((r) => r.source_table_uuid);
    if (periodIds.length === 0) return rows;
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
