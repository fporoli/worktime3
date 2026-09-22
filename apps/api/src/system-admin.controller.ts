import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, isOrgAdmin } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { permissions, role_permissions, roles, workflow_definitions } from './db/schema';
import { VersionsService } from './versions.service';

type WorkflowStep = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

@Controller('organizations/:orgId/system-admin')
export class SystemAdminController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
  ) {}

  private async caller(orgId: string, req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { db: null, callerId: null };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    return { db, callerId: callerId && (await isOrgAdmin(db, orgId, callerId)) ? callerId : null };
  }

  @Get('workflow-definitions')
  async listWorkflowDefinitions(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const { db, callerId } = await this.caller(orgId, req);
    if (!db || !callerId) return [];
    return db
      .select()
      .from(workflow_definitions)
      .where(eq(workflow_definitions.organization_id, orgId))
      .orderBy(asc(workflow_definitions.name));
  }

  @Post('workflow-definitions')
  async createWorkflowDefinition(
    @Param('orgId') orgId: string,
    @Body() body: { name?: string; description?: string; steps?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const { db, callerId } = await this.caller(orgId, req);
    if (!db) return { ok: true, offline: true };
    if (!callerId) return { ok: false, error: 'forbidden' };
    const validation = this.validateWorkflow(body);
    if (!validation.ok) return validation;
    const [row] = await db
      .insert(workflow_definitions)
      .values({ organization_id: orgId, name: body.name!.trim(), description: body.description?.trim() || null, steps: body.steps! })
      .returning();
    void this.versions.record('workflow_definitions', row.workflow_def_id, 'insert', callerId, row).catch(() => {});
    return { ok: true, definition: row };
  }

  @Patch('workflow-definitions/:id')
  async updateWorkflowDefinition(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; steps?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const { db, callerId } = await this.caller(orgId, req);
    if (!db) return { ok: true, offline: true };
    if (!callerId) return { ok: false, error: 'forbidden' };
    const validation = this.validateWorkflow(body, true);
    if (!validation.ok) return validation;
    const patch: Partial<typeof workflow_definitions.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.description !== undefined) patch.description = body.description.trim() || null;
    if (body.steps !== undefined) patch.steps = body.steps;
    if (Object.keys(patch).length === 0) return { ok: false, error: 'nothing-to-update' };
    const [row] = await db
      .update(workflow_definitions)
      .set(patch)
      .where(and(eq(workflow_definitions.workflow_def_id, id), eq(workflow_definitions.organization_id, orgId)))
      .returning();
    if (!row) return { ok: false, error: 'not-found' };
    void this.versions.record('workflow_definitions', id, 'update_delta', callerId, patch).catch(() => {});
    return { ok: true, definition: row };
  }

  @Delete('workflow-definitions/:id')
  async deleteWorkflowDefinition(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const { db, callerId } = await this.caller(orgId, req);
    if (!db) return { ok: true, offline: true };
    if (!callerId) return { ok: false, error: 'forbidden' };
    const [row] = await db
      .delete(workflow_definitions)
      .where(and(eq(workflow_definitions.workflow_def_id, id), eq(workflow_definitions.organization_id, orgId)))
      .returning({ workflow_def_id: workflow_definitions.workflow_def_id });
    if (!row) return { ok: false, error: 'not-found' };
    void this.versions.record('workflow_definitions', id, 'delete', callerId, null).catch(() => {});
    return { ok: true };
  }

  @Get('permissions')
  async listPermissions(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const { db, callerId } = await this.caller(orgId, req);
    if (!db || !callerId) return [];
    return db.select().from(permissions).orderBy(asc(permissions.id));
  }

  @Get('roles')
  async listRoles(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const { db, callerId } = await this.caller(orgId, req);
    if (!db || !callerId) return [];
    const roleRows = await db
      .select()
      .from(roles)
      .where(or(isNull(roles.organization_id), eq(roles.organization_id, orgId)))
      .orderBy(asc(roles.name));
    const grants = await db.select().from(role_permissions).where(inArray(role_permissions.role_id, roleRows.map((r) => r.id)));
    const byRole = new Map<string, string[]>();
    for (const grant of grants) byRole.set(grant.role_id, [...(byRole.get(grant.role_id) ?? []), grant.permission_id]);
    return roleRows.map((role) => ({ ...role, permission_ids: byRole.get(role.id) ?? [] }));
  }

  @Post('roles')
  async createRole(
    @Param('orgId') orgId: string,
    @Body() body: { name?: string; description?: string; permissionIds?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const { db, callerId } = await this.caller(orgId, req);
    if (!db) return { ok: true, offline: true };
    if (!callerId) return { ok: false, error: 'forbidden' };
    const permissionIds = await this.validPermissionIds(db, body.permissionIds);
    if (!body.name?.trim()) return { ok: false, error: 'name-required' };
    if (permissionIds === null) return { ok: false, error: 'invalid-permission' };
    const [role] = await db
      .insert(roles)
      .values({ organization_id: orgId, name: body.name.trim(), description: body.description?.trim() || null, is_system_role: false })
      .returning();
    if (permissionIds.length) await db.insert(role_permissions).values(permissionIds.map((permission_id) => ({ role_id: role.id, permission_id })));
    return { ok: true, role: { ...role, permission_ids: permissionIds } };
  }

  @Patch('roles/:roleId')
  async updateRole(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @Body() body: { name?: string; description?: string; permissionIds?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const { db, callerId } = await this.caller(orgId, req);
    if (!db) return { ok: true, offline: true };
    if (!callerId) return { ok: false, error: 'forbidden' };
    const [role] = await db.select().from(roles).where(and(eq(roles.id, roleId), or(isNull(roles.organization_id), eq(roles.organization_id, orgId))));
    if (!role) return { ok: false, error: 'not-found' };
    const permissionIds = body.permissionIds === undefined ? undefined : await this.validPermissionIds(db, body.permissionIds);
    if (permissionIds === null) return { ok: false, error: 'invalid-permission' };
    if (body.name !== undefined && !body.name.trim()) return { ok: false, error: 'name-required' };
    const patch: Partial<typeof roles.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.description !== undefined) patch.description = body.description.trim() || null;
    if (Object.keys(patch).length) await db.update(roles).set(patch).where(eq(roles.id, roleId));
    if (permissionIds !== undefined) {
      await db.delete(role_permissions).where(eq(role_permissions.role_id, roleId));
      if (permissionIds.length) await db.insert(role_permissions).values(permissionIds.map((permission_id) => ({ role_id: roleId, permission_id })));
    }
    void this.versions.record('roles', roleId, 'update_delta', callerId, { ...patch, permission_ids: permissionIds }).catch(() => {});
    return { ok: true };
  }

  @Delete('roles/:roleId')
  async deleteRole(@Param('orgId') orgId: string, @Param('roleId') roleId: string, @Req() req: AuthenticatedRequest) {
    const { db, callerId } = await this.caller(orgId, req);
    if (!db) return { ok: true, offline: true };
    if (!callerId) return { ok: false, error: 'forbidden' };
    const [role] = await db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organization_id, orgId)));
    if (!role) return { ok: false, error: 'not-found-or-system-role' };
    await db.delete(roles).where(eq(roles.id, roleId));
    void this.versions.record('roles', roleId, 'delete', callerId, null).catch(() => {});
    return { ok: true };
  }

  private validateWorkflow(body: { name?: string; steps?: unknown }, partial = false): { ok: true } | { ok: false; error: string } {
    if (!partial && !body.name?.trim()) return { ok: false, error: 'name-required' };
    if (body.name !== undefined && !body.name.trim()) return { ok: false, error: 'name-required' };
    if (body.steps !== undefined && (!Array.isArray(body.steps) || body.steps.some((step) => !isObject(step)))) {
      return { ok: false, error: 'steps-must-be-an-array-of-objects' };
    }
    return { ok: true };
  }

  private async validPermissionIds(db: NonNullable<ReturnType<DbService['getDb']>>, value: unknown): Promise<string[] | null> {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) return null;
    const ids = [...new Set(value)];
    const rows = ids.length ? await db.select({ id: permissions.id }).from(permissions).where(inArray(permissions.id, ids)) : [];
    return rows.length === ids.length ? ids : null;
  }
}
