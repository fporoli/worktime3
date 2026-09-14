import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Db } from './db.service';
import { isOrgAdmin } from './access';
import { workflows, workflow_definitions, team_members, organization_memberships } from './db/schema';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';

/** Employee asks their manager to reopen an already-approved month, with a reason. */
export const REOPEN_TIMESHEET_WORKFLOW_NAME = 'reopen approved timesheet';
/** A submitted month awaiting its owner's manager to approve or reject it. */
export const APPROVE_TIMESHEET_WORKFLOW_NAME = 'approve timesheet';

interface WorkflowStepDefinition {
  key: string;
  label: string;
  assignTo: string;
  onApprove: { action: string };
  onReject: { action: string };
  /** Human label for the kind of record this step's workflow concerns, e.g. "Timesheet Period". */
  source?: string;
  /** Name of the frontend formatter (see Timesheet.tsx's `getSourceTitle`) that renders that record's title. */
  source_name?: string;
}

/** What a registered action handler receives — everything it needs, nothing about workflows itself. */
export interface WorkflowActionContext {
  sourceTable: string;
  sourceTableUuid: string;
  actorUserId: string;
  decisionNote: string | null;
}
export type WorkflowActionHandler = (db: Db, ctx: WorkflowActionContext) => Promise<void>;
export type SourceOrgResolver = (db: Db, sourceTableUuid: string) => Promise<string | null>;

/**
 * Shared engine behind every workflow_definitions-driven approval in the
 * app: create a workflow, find the one pending for a record, and
 * approve/reject it (authorizing, recording the decision, and running
 * whatever side effect that workflow type calls for). Used both by
 * WorkflowsController's generic `/workflows/:id/approve` endpoint and by
 * TimesheetsController's period-id-based approve/reject, which now delegate
 * here instead of mutating timesheet_periods directly.
 *
 * This service knows nothing about timesheets or any other specific source
 * table — it only dispatches by name. A step's `onApprove`/`onReject.action`
 * (e.g. "timesheet.approve") is looked up in `actionHandlers`, and a source
 * table's owning organization is looked up in `sourceOrgResolvers`; both are
 * registered by whichever module owns that kind of record (e.g.
 * TimesheetsController registers the "timesheet.*" actions and the
 * `timesheet_periods` org resolver in its `onModuleInit`).
 */
@Injectable()
export class WorkflowsService {
  private readonly actionHandlers = new Map<string, WorkflowActionHandler>();
  private readonly sourceOrgResolvers = new Map<string, SourceOrgResolver>();

  constructor(
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
  ) {}

  /** Register what happens when a step's onApprove/onReject names this action. */
  registerAction(name: string, handler: WorkflowActionHandler): void {
    this.actionHandlers.set(name, handler);
  }

  /** Register how to resolve a source table's owning organization (for the admin-override check and audit log). */
  registerSourceOrgResolver(sourceTable: string, resolver: SourceOrgResolver): void {
    this.sourceOrgResolvers.set(sourceTable, resolver);
  }

  /** Every team this user belongs to, across whatever memberships they hold — used to resolve team-assigned workflows. */
  async callerTeamIds(db: Db, userId: string): Promise<string[]> {
    const rows = await db
      .select({ team_id: team_members.team_id })
      .from(team_members)
      .innerJoin(organization_memberships, eq(organization_memberships.id, team_members.membership_id))
      .where(eq(organization_memberships.user_id, userId));
    return rows.map((r) => r.team_id);
  }

  /**
   * Find-or-create a per-org workflow definition by name, so nobody has to set these up by hand.
   * The step config is entirely code-defined (there's no UI to edit it), so an existing row is kept
   * in sync with whatever the caller just passed in rather than left stale from when it was first created.
   */
  async ensureDefinition(db: Db, organizationId: string, name: string, description: string, steps: WorkflowStepDefinition[]) {
    const [existing] = await db
      .select({ workflow_def_id: workflow_definitions.workflow_def_id })
      .from(workflow_definitions)
      .where(and(eq(workflow_definitions.organization_id, organizationId), eq(workflow_definitions.name, name)));
    if (existing) {
      await db.update(workflow_definitions).set({ description, steps }).where(eq(workflow_definitions.workflow_def_id, existing.workflow_def_id));
      return existing;
    }
    const [created] = await db
      .insert(workflow_definitions)
      .values({ organization_id: organizationId, name, description, steps })
      .returning({ workflow_def_id: workflow_definitions.workflow_def_id });
    return created;
  }

  /** Create one workflow row with a single pending step, assigned to one or more users. The requester's text lives in `workflowData`. */
  async createWorkflow(
    db: Db,
    params: {
      workflowDefId: string;
      sourceTable: string;
      sourceTableUuid: string;
      step: string;
      assignedToUserId: string[];
      workflowData: Record<string, unknown>;
      actorUserId: string;
    },
  ) {
    const now = new Date().toISOString();
    const values = {
      workflow_def_id: params.workflowDefId,
      source_table: params.sourceTable,
      source_table_uuid: params.sourceTableUuid,
      workflow_data: params.workflowData,
      workflow_started: now,
      step: params.step,
      step_status: 'pending',
      workflow_step_started: now,
      assigned_to_user_id: params.assignedToUserId,
    };
    const [workflow] = await db.insert(workflows).values(values).returning({ id: workflows.workflow_id });
    void this.versions.record('workflows', workflow.id, 'insert', params.actorUserId, { id: workflow.id, ...values }).catch(() => {});
    return workflow;
  }

  /** The pending workflow (if any) for a record — lets a record-specific endpoint (e.g. timesheet-periods/:id/approve) delegate to it. */
  async findPending(db: Db, sourceTable: string, sourceTableUuid: string, definitionName?: string) {
    const conditions = [
      eq(workflows.source_table, sourceTable),
      eq(workflows.source_table_uuid, sourceTableUuid),
      eq(workflows.step_status, 'pending'),
    ];
    if (definitionName) conditions.push(eq(workflow_definitions.name, definitionName));
    const [row] = await db
      .select({ id: workflows.workflow_id })
      .from(workflows)
      .innerJoin(workflow_definitions, eq(workflow_definitions.workflow_def_id, workflows.workflow_def_id))
      .where(and(...conditions));
    return row ?? null;
  }

  /** Approve or reject a workflow's one pending step: authorizes, records the decision, and runs the side effect. */
  async resolve(
    db: Db,
    workflowId: string,
    callerId: string,
    outcome: 'approved' | 'rejected',
    note: string | undefined,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const [workflow] = await db
      .select({
        source_table: workflows.source_table,
        source_table_uuid: workflows.source_table_uuid,
        step: workflows.step,
        step_status: workflows.step_status,
        assigned_to_user_id: workflows.assigned_to_user_id,
        assigned_to_team_id: workflows.assigned_to_team_id,
        workflow_data: workflows.workflow_data,
        definition_name: workflow_definitions.name,
        steps: workflow_definitions.steps,
      })
      .from(workflows)
      .innerJoin(workflow_definitions, eq(workflow_definitions.workflow_def_id, workflows.workflow_def_id))
      .where(eq(workflows.workflow_id, workflowId));
    if (!workflow) return { ok: false, error: 'workflow-not-found' };

    const resolveOrg = this.sourceOrgResolvers.get(workflow.source_table);
    const organizationId = resolveOrg ? await resolveOrg(db, workflow.source_table_uuid) : null;
    const isDirectAssignee = (workflow.assigned_to_user_id ?? []).includes(callerId);
    const isTeamAssignee = workflow.assigned_to_team_id
      ? (await this.callerTeamIds(db, callerId)).includes(workflow.assigned_to_team_id)
      : false;
    const isAdmin = organizationId ? await isOrgAdmin(db, organizationId, callerId) : false;
    if (!isDirectAssignee && !isTeamAssignee && !isAdmin) return { ok: false, error: 'forbidden' };
    if (workflow.step_status !== 'pending') return { ok: false, error: 'not-pending' };

    const now = new Date().toISOString();
    const decisionNote = note?.trim() || null;
    const patch = {
      step_status: outcome,
      workflow_step_finished: now,
      workflow_finished: now,
      workflow_data: { ...(workflow.workflow_data as Record<string, unknown>), decisionNote },
    };
    await db.update(workflows).set(patch).where(eq(workflows.workflow_id, workflowId));
    void this.versions.record('workflows', workflowId, 'update_delta', callerId, patch).catch(() => {});

    await this.runAction(db, workflow, outcome, callerId, decisionNote);

    if (organizationId) {
      void this.audit.record(organizationId, callerId, `workflow.${outcome}`, 'workflow', workflowId, note ? { note } : undefined).catch(() => {});
    }
    return { ok: true };
  }

  /**
   * What actually happens when a workflow's one step is resolved — dispatched purely by the step
   * definition's `onApprove`/`onReject.action` name (e.g. "timesheet.approve") to whatever handler
   * was registered for it. Unknown/unregistered actions, and "none", are simply no-ops: this service
   * has no idea what any given action does, only who to ask.
   */
  private async runAction(
    db: Db,
    workflow: { source_table: string; source_table_uuid: string; step: string | null; steps: unknown },
    outcome: 'approved' | 'rejected',
    actorUserId: string,
    decisionNote: string | null,
  ) {
    const stepDefs = Array.isArray(workflow.steps) ? (workflow.steps as WorkflowStepDefinition[]) : [];
    const stepDef = stepDefs.find((s) => s.key === workflow.step);
    const actionName = outcome === 'approved' ? stepDef?.onApprove?.action : stepDef?.onReject?.action;
    if (!actionName || actionName === 'none') return;
    const handler = this.actionHandlers.get(actionName);
    if (!handler) return;
    await handler(db, { sourceTable: workflow.source_table, sourceTableUuid: workflow.source_table_uuid, actorUserId, decisionNote });
  }
}
