import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Db } from './db.service';
import { isOrgAdmin } from './access';
import { workflows, workflow_definitions, timesheet_periods } from './db/schema';
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
}

/**
 * Shared engine behind every workflow_definitions-driven approval in the
 * app: create a workflow, find the one pending for a record, and
 * approve/reject it (authorizing, recording the decision, and running
 * whatever side effect that workflow type calls for). Used both by
 * WorkflowsController's generic `/workflows/:id/approve` endpoint and by
 * TimesheetsController's period-id-based approve/reject, which now delegate
 * here instead of mutating timesheet_periods directly.
 */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
  ) {}

  /** Find-or-create a per-org workflow definition by name, so nobody has to set these up by hand. */
  async ensureDefinition(db: Db, organizationId: string, name: string, description: string, steps: WorkflowStepDefinition[]) {
    const [existing] = await db
      .select({ workflow_def_id: workflow_definitions.workflow_def_id })
      .from(workflow_definitions)
      .where(and(eq(workflow_definitions.organization_id, organizationId), eq(workflow_definitions.name, name)));
    if (existing) return existing;
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
        step_status: workflows.step_status,
        assigned_to_user_id: workflows.assigned_to_user_id,
        workflow_data: workflows.workflow_data,
        definition_name: workflow_definitions.name,
      })
      .from(workflows)
      .innerJoin(workflow_definitions, eq(workflow_definitions.workflow_def_id, workflows.workflow_def_id))
      .where(eq(workflows.workflow_id, workflowId));
    if (!workflow) return { ok: false, error: 'workflow-not-found' };

    // Only timesheet_periods is wired up so far — resolve its organization for the admin-override check.
    let organizationId: string | null = null;
    if (workflow.source_table === 'timesheet_periods') {
      const [period] = await db
        .select({ organization_id: timesheet_periods.organization_id })
        .from(timesheet_periods)
        .where(eq(timesheet_periods.id, workflow.source_table_uuid));
      organizationId = period?.organization_id ?? null;
    }
    const isAssignee = (workflow.assigned_to_user_id ?? []).includes(callerId);
    const isAdmin = organizationId ? await isOrgAdmin(db, organizationId, callerId) : false;
    if (!isAssignee && !isAdmin) return { ok: false, error: 'forbidden' };
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
   * What actually happens when a workflow's one step is resolved — keyed off
   * the workflow_definition's name and the outcome. Deliberately simple (an
   * if/else per known workflow type) rather than a generic action-
   * interpreter: there are only two kinds of workflow so far, and a rule
   * engine for them would be speculative. Extend this as more show up.
   */
  private async runAction(
    db: Db,
    workflow: { source_table: string; source_table_uuid: string; definition_name: string },
    outcome: 'approved' | 'rejected',
    actorUserId: string,
    decisionNote: string | null,
  ) {
    if (workflow.source_table !== 'timesheet_periods') return;

    if (workflow.definition_name === REOPEN_TIMESHEET_WORKFLOW_NAME) {
      if (outcome !== 'approved') return; // rejecting a reopen request leaves the timesheet exactly as it was.
      const patch = { status: 'open' as const, reviewed_by_user_id: null, reviewed_at: null, review_note: null };
      await db.update(timesheet_periods).set(patch).where(eq(timesheet_periods.id, workflow.source_table_uuid));
      void this.versions.record('timesheet_periods', workflow.source_table_uuid, 'update_delta', actorUserId, patch).catch(() => {});
      return;
    }

    if (workflow.definition_name === APPROVE_TIMESHEET_WORKFLOW_NAME) {
      const patch =
        outcome === 'approved'
          ? { status: 'approved' as const, reviewed_by_user_id: actorUserId, reviewed_at: new Date().toISOString(), review_note: null }
          : { status: 'rejected' as const, reviewed_by_user_id: actorUserId, reviewed_at: new Date().toISOString(), review_note: decisionNote };
      await db.update(timesheet_periods).set(patch).where(eq(timesheet_periods.id, workflow.source_table_uuid));
      void this.versions.record('timesheet_periods', workflow.source_table_uuid, 'update_delta', actorUserId, patch).catch(() => {});
    }
  }
}
