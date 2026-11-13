import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DbService, type Db } from './db.service';
import { callerUserId, can, canSeeUserData, isOrgMember, membershipManagerId } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { WorkflowsService } from './workflows.service';
import { departments, employee_assignments, organization_memberships, users } from './db/schema';
import { isIsoDate } from '@worktime3/shared/worktime';

/** Permission object of a person's employment (start date, department, function, manager). */
export const EMPLOYMENT_OBJECT = 'section.people.employment';
const MAX_NAME = 120;

/** Trimmed text, null when empty; undefined when too long. */
export function cleanText(value: unknown, max = MAX_NAME): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  if (!t) return null;
  return t.length > max ? undefined : t;
}

interface AssignmentBody {
  validFrom?: string;
  departmentId?: string | null;
  jobFunction?: string | null;
  managerUserId?: string | null;
}

/**
 * Departments (Organization settings) and each person's employment: their start date and dated
 * assignments, each naming a department, a function and a manager from `valid_from` on.
 * A department's leader is only the default manager offered for new assignments; who manages a
 * person is always the manager of their assignment in force (`membershipManagerId`).
 */
@Controller()
export class EmploymentController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
    private readonly workflows: WorkflowsService,
  ) {}

  // ---------- departments ----------

  @Get('organizations/:orgId/departments')
  async listDepartments(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, departments: [], canEdit: false };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', departments: [], canEdit: false };
    const leader = alias(users, 'leader');
    const rows = await db
      .select({
        id: departments.id,
        name: departments.name,
        leader_user_id: departments.leader_user_id,
        leader_name: leader.display_name,
        is_active: departments.is_active,
        sort_order: departments.sort_order,
      })
      .from(departments)
      .leftJoin(leader, eq(leader.id, departments.leader_user_id))
      .where(eq(departments.organization_id, orgId))
      .orderBy(asc(departments.sort_order), asc(departments.name));
    // People in each department today.
    const counts = await db.execute(sql`
      SELECT department_id, COUNT(*)::int AS members FROM (
        SELECT DISTINCT ON (user_id) user_id, department_id FROM employee_assignments
        WHERE organization_id = ${orgId} AND valid_from <= CURRENT_DATE
        ORDER BY user_id, valid_from DESC
      ) current_assignment WHERE department_id IS NOT NULL GROUP BY department_id`);
    const membersOf = new Map((counts.rows as { department_id: string; members: number }[]).map((r) => [r.department_id, r.members]));
    return {
      ok: true,
      departments: rows.map((r) => ({ ...r, members: membersOf.get(r.id) ?? 0 })),
      canEdit: await can(db, orgId, callerId, 'nav.orgSettings', 'edit'),
    };
  }

  @Post('organizations/:orgId/departments')
  async createDepartment(
    @Param('orgId') orgId: string,
    @Body() body: { name?: string; leaderUserId?: string | null; sortOrder?: number },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.departmentEditor(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const name = cleanText(body.name);
    if (!name) return { ok: false, error: 'invalid-name' };
    const leader = await this.checkLeader(db, orgId, body.leaderUserId);
    if (leader === false) return { ok: false, error: 'leader-not-a-member' };
    if (await this.nameTaken(db, orgId, name)) return { ok: false, error: 'duplicate-name' };
    const values = {
      organization_id: orgId,
      name,
      leader_user_id: leader,
      sort_order: Number.isInteger(body.sortOrder) ? (body.sortOrder as number) : 0,
    };
    const [row] = await db.insert(departments).values(values).returning({ id: departments.id });
    void this.versions.record('departments', row.id, 'insert', callerId, { id: row.id, ...values }).catch(() => {});
    void this.audit.record(orgId, callerId, 'department.create', 'department', row.id, values).catch(() => {});
    return { ok: true, id: row.id };
  }

  @Patch('organizations/:orgId/departments/:id')
  async updateDepartment(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; leaderUserId?: string | null; isActive?: boolean; sortOrder?: number },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.departmentEditor(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const [existing] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, id), eq(departments.organization_id, orgId)));
    if (!existing) return { ok: false, error: 'not-found' };

    const patch: Partial<typeof departments.$inferInsert> = {};
    if (body.name !== undefined) {
      const name = cleanText(body.name);
      if (!name) return { ok: false, error: 'invalid-name' };
      if (await this.nameTaken(db, orgId, name, id)) return { ok: false, error: 'duplicate-name' };
      patch.name = name;
    }
    if (body.leaderUserId !== undefined) {
      const leader = await this.checkLeader(db, orgId, body.leaderUserId);
      if (leader === false) return { ok: false, error: 'leader-not-a-member' };
      patch.leader_user_id = leader;
    }
    if (typeof body.isActive === 'boolean') patch.is_active = body.isActive;
    if (Number.isInteger(body.sortOrder)) patch.sort_order = body.sortOrder as number;
    if (Object.keys(patch).length === 0) return { ok: true, noop: true };
    await db.update(departments).set(patch).where(eq(departments.id, id));
    void this.versions.record('departments', id, 'update_delta', callerId, patch).catch(() => {});
    void this.audit.record(orgId, callerId, 'department.update', 'department', id, patch).catch(() => {});
    return { ok: true };
  }

  /** Deletes an unused department; one that appears in anyone's history is deactivated instead. */
  @Delete('organizations/:orgId/departments/:id')
  async deleteDepartment(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.departmentEditor(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const [existing] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, id), eq(departments.organization_id, orgId)));
    if (!existing) return { ok: false, error: 'not-found' };
    const [used] = await db.select({ n: count() }).from(employee_assignments).where(eq(employee_assignments.department_id, id));
    if (Number(used?.n ?? 0) > 0) return { ok: false, error: 'department-in-use' };
    await db.delete(departments).where(eq(departments.id, id));
    void this.versions.record('departments', id, 'delete', callerId, { id }).catch(() => {});
    void this.audit.record(orgId, callerId, 'department.delete', 'department', id, {}).catch(() => {});
    return { ok: true };
  }

  // ---------- a person's employment ----------

  @Get('organizations/:orgId/users/:userId/employment')
  async employment(@Param('orgId') orgId: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, assignments: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', assignments: [] };
    if (!(await canSeeUserData(db, orgId, callerId, EMPLOYMENT_OBJECT, userId))) return { ok: false, error: 'forbidden', assignments: [] };

    const [membership] = await db
      .select({ start_date: organization_memberships.start_date, joined_at: organization_memberships.joined_at, exit_at: organization_memberships.exit_at })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.user_id, userId)));
    if (!membership) return { ok: false, error: 'unknown-user', assignments: [] };

    const manager = alias(users, 'manager');
    const assignments = await db
      .select({
        id: employee_assignments.id,
        valid_from: employee_assignments.valid_from,
        department_id: employee_assignments.department_id,
        department_name: departments.name,
        job_function: employee_assignments.job_function,
        manager_user_id: employee_assignments.manager_user_id,
        manager_name: manager.display_name,
      })
      .from(employee_assignments)
      .leftJoin(departments, eq(departments.id, employee_assignments.department_id))
      .leftJoin(manager, eq(manager.id, employee_assignments.manager_user_id))
      .where(and(eq(employee_assignments.organization_id, orgId), eq(employee_assignments.user_id, userId)))
      .orderBy(desc(employee_assignments.valid_from));
    const today = new Date().toISOString().slice(0, 10);
    return {
      ok: true,
      startDate: membership.start_date ?? membership.joined_at?.slice(0, 10) ?? null,
      exitDate: membership.exit_at?.slice(0, 10) ?? null,
      currentId: assignments.find((a) => a.valid_from <= today)?.id ?? null,
      assignments,
      canEdit: await can(db, orgId, callerId, EMPLOYMENT_OBJECT, 'edit', userId),
    };
  }

  @Put('organizations/:orgId/users/:userId/start-date')
  async setStartDate(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: { startDate?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.employmentEditor(db, orgId, userId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const startDate = body.startDate ?? null;
    if (startDate !== null && !isIsoDate(startDate)) return { ok: false, error: 'invalid-date' };
    const [membership] = await db
      .select({ id: organization_memberships.id })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.user_id, userId)));
    if (!membership) return { ok: false, error: 'unknown-user' };
    await db.update(organization_memberships).set({ start_date: startDate }).where(eq(organization_memberships.id, membership.id));
    void this.versions.record('organization_memberships', membership.id, 'update_delta', callerId, { start_date: startDate }).catch(() => {});
    void this.audit.record(orgId, callerId, 'membership.start-date', 'membership', membership.id, { start_date: startDate }).catch(() => {});
    return { ok: true };
  }

  @Post('organizations/:orgId/users/:userId/assignments')
  async addAssignment(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: AssignmentBody,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.employmentEditor(db, orgId, userId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    if (!(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'unknown-user' };
    const checked = await this.checkAssignment(db, orgId, userId, body);
    if ('error' in checked) return { ok: false, error: checked.error };
    if (await this.dateTaken(db, orgId, userId, checked.valid_from)) return { ok: false, error: 'duplicate-date' };

    const values = { organization_id: orgId, user_id: userId, ...checked };
    const [row] = await db.insert(employee_assignments).values(values).returning({ id: employee_assignments.id });
    void this.versions.record('employee_assignments', row.id, 'insert', callerId, { id: row.id, ...values }).catch(() => {});
    void this.audit.record(orgId, callerId, 'employment.assign', 'user', userId, values).catch(() => {});
    await this.workflows.rerouteToCurrentManagers(db).catch(() => 0);
    return { ok: true, id: row.id };
  }

  @Patch('organizations/:orgId/assignments/:id')
  async updateAssignment(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: AssignmentBody, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const row = await this.assignment(db, orgId, id);
    if (!row) return { ok: false, error: 'not-found' };
    const callerId = await this.employmentEditor(db, orgId, row.user_id, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const merged: AssignmentBody = {
      validFrom: body.validFrom ?? row.valid_from,
      departmentId: body.departmentId !== undefined ? body.departmentId : row.department_id,
      jobFunction: body.jobFunction !== undefined ? body.jobFunction : row.job_function,
      managerUserId: body.managerUserId !== undefined ? body.managerUserId : row.manager_user_id,
    };
    const checked = await this.checkAssignment(db, orgId, row.user_id, merged);
    if ('error' in checked) return { ok: false, error: checked.error };
    if (checked.valid_from !== row.valid_from && (await this.dateTaken(db, orgId, row.user_id, checked.valid_from))) return { ok: false, error: 'duplicate-date' };

    await db.update(employee_assignments).set(checked).where(eq(employee_assignments.id, id));
    void this.versions.record('employee_assignments', id, 'update_delta', callerId, checked).catch(() => {});
    void this.audit.record(orgId, callerId, 'employment.update', 'user', row.user_id, { id, ...checked }).catch(() => {});
    await this.workflows.rerouteToCurrentManagers(db).catch(() => 0);
    return { ok: true };
  }

  @Delete('organizations/:orgId/assignments/:id')
  async deleteAssignment(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const row = await this.assignment(db, orgId, id);
    if (!row) return { ok: false, error: 'not-found' };
    const callerId = await this.employmentEditor(db, orgId, row.user_id, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    await db.delete(employee_assignments).where(eq(employee_assignments.id, id));
    void this.versions.record('employee_assignments', id, 'delete', callerId, row).catch(() => {});
    void this.audit.record(orgId, callerId, 'employment.delete', 'user', row.user_id, row).catch(() => {});
    await this.workflows.rerouteToCurrentManagers(db).catch(() => 0);
    return { ok: true };
  }

  // ---------- helpers ----------

  private async departmentEditor(db: Db, orgId: string, req: AuthenticatedRequest): Promise<string | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'nav.orgSettings', 'edit'))) return null;
    return callerId;
  }

  private async employmentEditor(db: Db, orgId: string, userId: string, req: AuthenticatedRequest): Promise<string | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return null;
    return (await can(db, orgId, callerId, EMPLOYMENT_OBJECT, 'edit', userId)) ? callerId : null;
  }

  /** The leader id to store: null for none, false when not a member of the org. */
  private async checkLeader(db: Db, orgId: string, leaderUserId: string | null | undefined): Promise<string | null | false> {
    if (!leaderUserId) return null;
    return (await isOrgMember(db, orgId, leaderUserId)) ? leaderUserId : false;
  }

  private async nameTaken(db: Db, orgId: string, name: string, exceptId?: string): Promise<boolean> {
    const rows = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.organization_id, orgId), sql`lower(${departments.name}) = lower(${name})`));
    return rows.some((r) => r.id !== exceptId);
  }

  private async dateTaken(db: Db, orgId: string, userId: string, validFrom: string): Promise<boolean> {
    const rows = await db
      .select({ id: employee_assignments.id })
      .from(employee_assignments)
      .where(and(eq(employee_assignments.organization_id, orgId), eq(employee_assignments.user_id, userId), eq(employee_assignments.valid_from, validFrom)));
    return rows.length > 0;
  }

  private async assignment(db: Db, orgId: string, id: string) {
    const [row] = await db
      .select({
        user_id: employee_assignments.user_id,
        valid_from: employee_assignments.valid_from,
        department_id: employee_assignments.department_id,
        job_function: employee_assignments.job_function,
        manager_user_id: employee_assignments.manager_user_id,
      })
      .from(employee_assignments)
      .where(and(eq(employee_assignments.id, id), eq(employee_assignments.organization_id, orgId)));
    return row ?? null;
  }

  /** Validates an assignment: a date, the org's department, a function, and a manager who is a member and not in a loop. */
  private async checkAssignment(
    db: Db,
    orgId: string,
    userId: string,
    body: AssignmentBody,
  ): Promise<{ valid_from: string; department_id: string | null; job_function: string | null; manager_user_id: string | null } | { error: string }> {
    if (!isIsoDate(body.validFrom)) return { error: 'invalid-date' };
    const jobFunction = cleanText(body.jobFunction);
    if (jobFunction === undefined) return { error: 'invalid-function' };
    const departmentId = body.departmentId || null;
    if (departmentId) {
      const [dep] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, departmentId), eq(departments.organization_id, orgId)));
      if (!dep) return { error: 'unknown-department' };
    }
    const managerUserId = body.managerUserId || null;
    if (managerUserId) {
      if (managerUserId === userId) return { error: 'cannot-be-own-manager' };
      if (!(await isOrgMember(db, orgId, managerUserId))) return { error: 'manager-not-a-member' };
      // Walk the manager's chain on that date: reaching the person again would be a loop.
      let current: string | null = managerUserId;
      for (let i = 0; current && i < 50; i++) {
        current = await membershipManagerId(db, orgId, current, body.validFrom);
        if (current === userId) return { error: 'manager-cycle' };
      }
    }
    return { valid_from: body.validFrom, department_id: departmentId, job_function: jobFunction, manager_user_id: managerUserId };
  }
}
