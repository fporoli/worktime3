import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './db.service';
import { reachesAll } from './access';
import { workflows, workflow_definitions, team_members, organization_memberships } from './db/schema';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { NotificationsService } from './notifications.service';

/** Employee asks their manager to reopen an already-approved month, with a reason. */
export const REOPEN_TIMESHEET_WORKFLOW_NAME = 'reopen approved timesheet';
/** A submitted month awaiting its owner's manager to approve or reject it. */
export const APPROVE_TIMESHEET_WORKFLOW_NAME = 'approve timesheet';
/** A submitted expense report awaiting its owner's manager to approve or reject it. */
export const APPROVE_EXPENSE_REPORT_WORKFLOW_NAME = 'approve expense report';
/** A vacation request awaiting its owner's manager to approve or reject it. */
export const APPROVE_ABSENCE_WORKFLOW_NAME = 'approve absence';
/** A person's month of project time on one project, awaiting that project's owner. */
export const APPROVE_PROJECT_TIMESHEET_WORKFLOW_NAME = 'approve project timesheet';

/** Workflows that go to the submitter's manager; they follow the manager when it changes. */
export const MANAGER_ROUTED_WORKFLOW_NAMES: readonly string[] = [
  REOPEN_TIMESHEET_WORKFLOW_NAME,
  APPROVE_TIMESHEET_WORKFLOW_NAME,
  APPROVE_EXPENSE_REPORT_WORKFLOW_NAME,
  APPROVE_ABSENCE_WORKFLOW_NAME,
];

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
    private readonly notifications: NotificationsService,
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

  /** Create one workflow row with a single pending step, assigned to one or more users and/or a team. The requester's text lives in `workflowData`. */
  async createWorkflow(
    db: Db,
    params: {
      workflowDefId: string;
      sourceTable: string;
      sourceTableUuid: string;
      step: string;
      assignedToUserId?: string[];
      assignedToTeamId?: string;
      workflowData: Record<string, unknown>;
      actorUserId: string;
      /** Human copy for the notification sent to every resolved assignee. */
      notification: { title: string; body?: string };
    },
  ) {
    const now = new Date().toISOString();
    const values = {
      workflow_def_id: params.workflowDefId,
      source_table: params.sourceTable,
      source_table_uuid: params.sourceTableUuid,
      // Captures who to notify back on resolve() — generically, for every workflow type,
      // without a per-source-table lookup.
      workflow_data: { ...params.workflowData, submittedByUserId: params.actorUserId },
      workflow_started: now,
      step: params.step,
      step_status: 'pending',
      workflow_step_started: now,
      assigned_to_user_id: params.assignedToUserId ?? null,
      assigned_to_team_id: params.assignedToTeamId ?? null,
    };
    const [workflow] = await db.insert(workflows).values(values).returning({ id: workflows.workflow_id });
    void this.versions.record('workflows', workflow.id, 'insert', params.actorUserId, { id: workflow.id, ...values }).catch(() => {});

    void this.notifyAssignees(db, {
      sourceTable: params.sourceTable,
      assignedToUserId: params.assignedToUserId,
      assignedToTeamId: params.assignedToTeamId,
      excludeUserId: params.actorUserId,
      type: 'workflow.assigned',
      title: params.notification.title,
      body: params.notification.body,
      sourceTableUuid: params.sourceTableUuid,
      workflowId: workflow.id,
    }).catch((err) => console.error('notify-assignees-failed', err));

    return workflow;
  }

  /** Resolve a workflow's assignees (direct users and/or a team's members) and notify each of them once. */
  private async notifyAssignees(
    db: Db,
    params: {
      sourceTable: string;
      assignedToUserId?: string[];
      assignedToTeamId?: string;
      excludeUserId: string;
      type: string;
      title: string;
      body?: string;
      sourceTableUuid: string;
      workflowId: string;
    },
  ) {
    const recipientIds = new Set(params.assignedToUserId ?? []);
    if (params.assignedToTeamId) {
      const rows = await db
        .select({ user_id: organization_memberships.user_id })
        .from(team_members)
        .innerJoin(organization_memberships, eq(organization_memberships.id, team_members.membership_id))
        .where(eq(team_members.team_id, params.assignedToTeamId));
      for (const row of rows) recipientIds.add(row.user_id);
    }
    recipientIds.delete(params.excludeUserId);
    if (recipientIds.size === 0) return;

    const resolveOrg = this.sourceOrgResolvers.get(params.sourceTable);
    const organizationId = resolveOrg ? await resolveOrg(db, params.sourceTableUuid) : null;
    if (!organizationId) return;

    await this.notifications.notifyMany({
      organizationId,
      recipientUserIds: [...recipientIds],
      type: params.type,
      title: params.title,
      body: params.body,
      sourceTable: params.sourceTable,
      sourceTableUuid: params.sourceTableUuid,
      workflowId: params.workflowId,
      data: { workflowId: params.workflowId, sourceTable: params.sourceTable, sourceTableUuid: params.sourceTableUuid },
    });
  }

  /**
   * Managers are dated (employee_assignments), so a pending request sent to someone's manager
   * moves to whoever is their manager today: after an assignment changes, and whenever a dated
   * change has come into force since. Only requests still with one of the person's managers
   * (current or past) move; a request already elsewhere, or a person without a manager now, stays.
   * The new manager is notified. Returns how many requests moved.
   */
  async rerouteToCurrentManagers(db: Db): Promise<number> {
    const names = sql.join(MANAGER_ROUTED_WORKFLOW_NAMES.map((n) => sql`${n}`), sql`, `);
    const result = await db.execute(sql`
      WITH pending AS (
        SELECT w.workflow_id, w.assigned_to_user_id[1] AS assignee,
               (w.workflow_data->>'submittedByUserId')::uuid AS subject,
               COALESCE(tp.organization_id, ab.organization_id, er.organization_id) AS organization_id
        FROM workflows w
        JOIN workflow_definitions d ON d.workflow_def_id = w.workflow_def_id
        LEFT JOIN timesheet_periods tp ON w.source_table = 'timesheet_periods' AND tp.id = w.source_table_uuid
        LEFT JOIN absences ab ON w.source_table = 'absences' AND ab.id = w.source_table_uuid
        LEFT JOIN expense_reports er ON w.source_table = 'expense_reports' AND er.id = w.source_table_uuid
        WHERE w.step_status = 'pending' AND d.name IN (${names})
          AND cardinality(w.assigned_to_user_id) = 1
          AND jsonb_exists(w.workflow_data, 'submittedByUserId')
      ), moved AS (
        SELECT p.*, (
          SELECT a.manager_user_id FROM employee_assignments a
          WHERE a.organization_id = p.organization_id AND a.user_id = p.subject AND a.valid_from <= CURRENT_DATE
          ORDER BY a.valid_from DESC LIMIT 1
        ) AS manager
        FROM pending p
        WHERE p.organization_id IS NOT NULL
      )
      UPDATE workflows w SET assigned_to_user_id = ARRAY[m.manager]
      FROM moved m
      WHERE w.workflow_id = m.workflow_id AND m.manager IS NOT NULL AND m.manager <> m.assignee
        AND EXISTS (
          SELECT 1 FROM employee_assignments ea
          WHERE ea.organization_id = m.organization_id AND ea.user_id = m.subject AND ea.manager_user_id = m.assignee
        )
      RETURNING w.workflow_id, w.source_table, w.source_table_uuid, m.organization_id, m.manager`);
    const rows = result.rows as { workflow_id: string; source_table: string; source_table_uuid: string; organization_id: string; manager: string }[];
    for (const r of rows) {
      void this.versions.record('workflows', r.workflow_id, 'update_delta', null, { assigned_to_user_id: [r.manager] }).catch(() => {});
      void this.notifications
        .notifyMany({
          organizationId: r.organization_id,
          recipientUserIds: [r.manager],
          type: 'workflow.assigned',
          title: 'A request was passed on to you as the new manager',
          sourceTable: r.source_table,
          sourceTableUuid: r.source_table_uuid,
          workflowId: r.workflow_id,
          data: { workflowId: r.workflow_id, sourceTable: r.source_table, sourceTableUuid: r.source_table_uuid },
        })
        .catch(() => {});
    }
    return rows.length;
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
    // A dated manager change may have come into force since the request was routed.
    await this.rerouteToCurrentManagers(db).catch(() => 0);
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
    // An approvals grant reaching everyone (admin by default) may resolve any workflow of the org.
    const isOverride = organizationId ? await reachesAll(db, organizationId, callerId, 'nav.approvals', 'edit') : false;
    if (!isDirectAssignee && !isTeamAssignee && !isOverride) return { ok: false, error: 'forbidden' };
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

      const submittedByUserId = (workflow.workflow_data as Record<string, unknown> | null)?.submittedByUserId as string | undefined;
      if (submittedByUserId && submittedByUserId !== callerId) {
        void this.notifications
          .notifyMany({
            organizationId,
            recipientUserIds: [submittedByUserId],
            type: outcome === 'approved' ? 'workflow.approved' : 'workflow.rejected',
            title: outcome === 'approved' ? 'Your submission was approved' : 'Your submission was rejected',
            body: decisionNote ?? undefined,
            sourceTable: workflow.source_table,
            sourceTableUuid: workflow.source_table_uuid,
            workflowId,
            data: { workflowId, sourceTable: workflow.source_table, sourceTableUuid: workflow.source_table_uuid },
          })
          .catch((err) => console.error('notify-submitter-failed', err));
      }
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
