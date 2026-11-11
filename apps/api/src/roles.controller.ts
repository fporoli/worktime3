import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { ADMIN_LOCKED_PERMISSIONS, allPermissionIds } from '@worktime3/shared/permissions';
import { DbService, type Db } from './db.service';
import { callerUserId, can, isOrgMember, isSuperDeveloper } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { membership_roles, organization_memberships, role_permissions, roles } from './db/schema';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';

/** System roles assignable when inviting someone; owner is reserved for the org creator. */
export function isAssignableInviteRole(name: string): boolean {
  return name !== 'owner';
}

@Controller('roles')
export class RolesController {
  constructor(private readonly db: DbService) {}

  /** Built-in (organization-agnostic) roles, for role pickers such as the invite dialog. */
  @Get()
  async list() {
    const db = this.db.getDb();
    if (!db) return [];
    const rows = await db
      .select({ id: roles.id, name: roles.name, description: roles.description })
      .from(roles)
      .where(isNull(roles.organization_id))
      .orderBy(asc(roles.name));
    return rows.filter((row) => isAssignableInviteRole(row.name));
  }
}

// ---------------------------------------------------------------------------------------------
// Roles & permissions administration.
//
// Global roles (`organization_id` NULL) are the system roles and carry the default permissions;
// a superdeveloper edits them (`scope: 'global'`). An organization customizes a system role by
// getting its own copy (same name): the first org-level change creates the copy, copies the
// defaults and moves the org's memberships, invitations and team-role references onto it;
// "reset" moves them back and deletes the copy. Organizations can also create their own roles.

export type RoleScope = 'global' | 'override' | 'custom';

export interface RoleRowLike {
  id: string;
  organization_id: string | null;
  name: string;
}

/**
 * The roles in effect for an organization: its own roles, plus the global roles it has no copy
 * of. `override` = the org's copy of a global role, `custom` = a role only this org has.
 */
export function effectiveOrgRoles<T extends RoleRowLike>(rows: T[], orgId: string): (T & { scope: RoleScope })[] {
  const globalNames = new Set(rows.filter((r) => r.organization_id === null).map((r) => r.name));
  const orgNames = new Set(rows.filter((r) => r.organization_id === orgId).map((r) => r.name));
  const out: (T & { scope: RoleScope })[] = [];
  for (const r of rows) {
    if (r.organization_id === null) {
      if (!orgNames.has(r.name)) out.push({ ...r, scope: 'global' });
    } else if (r.organization_id === orgId) {
      out.push({ ...r, scope: globalNames.has(r.name) ? 'override' : 'custom' });
    }
  }
  return out;
}

/** Error code when a permission list holds anything outside the catalogue, else null. */
export function checkPermissionIds(ids: unknown): string | null {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return 'invalid-permissions';
  const catalogue = new Set(allPermissionIds());
  return ids.every((id) => catalogue.has(id)) ? null : 'unknown-permission';
}

/** Error code when the `admin` role would lose a grant it must keep, else null. */
export function checkAdminLock(roleName: string, ids: string[]): string | null {
  if (roleName !== 'admin') return null;
  return ADMIN_LOCKED_PERMISSIONS.every((id) => ids.includes(id)) ? null : 'admin-role-locked';
}

/** Error code for a new/renamed custom role name, else null. Names are compared case-insensitively. */
export function checkRoleName(name: unknown, takenNames: string[]): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'name-required';
  if (name.trim().length > 64) return 'name-too-long';
  const lower = name.trim().toLowerCase();
  return takenNames.some((n) => n.toLowerCase() === lower) ? 'name-taken' : null;
}

/** `{ locale: label }` with string values only; anything else is dropped. */
export function sanitizeTranslations(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  return out;
}

interface RoleBody {
  scope?: 'org' | 'global';
  name?: string;
  description?: string | null;
  translations?: unknown;
  permissions?: unknown;
  adminUserIds?: unknown;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

@Controller('organizations/:orgId/roles')
export class OrgRolesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
  ) {}

  /** May the caller administer roles in this org? Superdevelopers may always (they also edit the defaults). */
  private async canAdminister(db: Db, orgId: string, callerId: string) {
    const superDev = await isSuperDeveloper(db, callerId);
    const org = superDev || (await can(db, orgId, callerId, 'section.admin.roles', 'edit'));
    return { org, global: superDev };
  }

  /**
   * The roles in effect for this organization (for role pickers and the Roles & permissions page).
   * Permissions, role admins and member counts only for callers who administer roles.
   */
  @Get()
  async list(@Param('orgId') orgId: string, @Query('scope') scope: string | undefined, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, roles: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: true, roles: [] };
    const access = await this.canAdminister(db, orgId, callerId);
    if (!access.org && !(await isOrgMember(db, orgId, callerId))) return { ok: true, roles: [] };
    // `scope=global`: the default roles themselves (superdevelopers edit these).
    const globalOnly = scope === 'global';
    if (globalOnly && !access.global) return { ok: false, error: 'forbidden' };

    const rows = await db
      .select()
      .from(roles)
      .where(globalOnly ? isNull(roles.organization_id) : or(isNull(roles.organization_id), eq(roles.organization_id, orgId)))
      .orderBy(asc(roles.name));
    const effective = globalOnly ? rows.map((r) => ({ ...r, scope: 'global' as RoleScope })) : effectiveOrgRoles(rows, orgId);
    if (!access.org) {
      return {
        ok: true,
        canAdminister: false,
        canEditGlobal: false,
        roles: effective.map((r) => ({ id: r.id, name: r.name, description: r.description, translations: r.translations, scope: r.scope })),
      };
    }

    const ids = effective.map((r) => r.id);
    const perms = ids.length
      ? await db.select().from(role_permissions).where(inArray(role_permissions.role_id, ids))
      : [];
    // Global rows too, so the page can show what "reset to default" would restore.
    const globalIds = rows.filter((r) => r.organization_id === null).map((r) => r.id);
    const globalPerms = globalIds.length
      ? await db.select().from(role_permissions).where(inArray(role_permissions.role_id, globalIds))
      : [];
    const counts = await db
      .select({ role_id: membership_roles.role_id, n: sql<number>`count(*)::int` })
      .from(membership_roles)
      .innerJoin(organization_memberships, eq(organization_memberships.id, membership_roles.membership_id))
      .where(and(eq(organization_memberships.organization_id, orgId), inArray(membership_roles.role_id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])))
      .groupBy(membership_roles.role_id);
    const byRole = (list: { role_id: string; permission_id: string }[], id: string) =>
      list.filter((p) => p.role_id === id).map((p) => p.permission_id).sort();
    const globalByName = new Map(rows.filter((r) => r.organization_id === null).map((r) => [r.name, r.id]));

    return {
      ok: true,
      canAdminister: true,
      canEditGlobal: access.global,
      roles: effective.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        translations: r.translations,
        scope: r.scope,
        permissions: byRole(perms, r.id),
        defaultPermissions: globalByName.has(r.name) ? byRole(globalPerms, globalByName.get(r.name)!) : null,
        adminUserIds: (r.admin_user_ids ?? []).filter(Boolean),
        // A default role is shared by every organization: count only this one's members.
        memberCount: counts.find((c) => c.role_id === r.id)?.n ?? 0,
      })),
    };
  }

  /** Create a role only this organization has. */
  @Post()
  async create(@Param('orgId') orgId: string, @Body() body: RoleBody, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await this.canAdminister(db, orgId, callerId)).org) return { ok: false, error: 'forbidden' };

    const taken = await db
      .select({ name: roles.name })
      .from(roles)
      .where(or(isNull(roles.organization_id), eq(roles.organization_id, orgId)));
    const nameError = checkRoleName(body.name, taken.map((r) => r.name));
    if (nameError) return { ok: false, error: nameError };
    const permissions = body.permissions ?? [];
    const permError = checkPermissionIds(permissions);
    if (permError) return { ok: false, error: permError };

    const [created] = await db
      .insert(roles)
      .values({
        organization_id: orgId,
        name: body.name!.trim(),
        description: typeof body.description === 'string' ? body.description.trim() || null : null,
        is_system_role: false,
        translations: sanitizeTranslations(body.translations),
      })
      .returning({ id: roles.id });
    const ids = [...new Set(permissions as string[])];
    if (ids.length) await db.insert(role_permissions).values(ids.map((permission_id) => ({ role_id: created.id, permission_id })));

    void this.audit.record(orgId, callerId, 'role.create', 'role', created.id, { name: body.name, permissions: ids }).catch(() => {});
    void this.versions.record('roles', created.id, 'insert', callerId, { id: created.id, organization_id: orgId, name: body.name, permissions: ids }).catch(() => {});
    return { ok: true, id: created.id };
  }

  /**
   * Change a role. A global role with `scope: 'global'` changes the default (superdeveloper);
   * otherwise the org gets (or already has) its own copy and only that changes.
   */
  @Patch(':roleId')
  async update(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @Body() body: RoleBody,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const access = await this.canAdminister(db, orgId, callerId);

    const [role] = await db.select().from(roles).where(eq(roles.id, roleId));
    if (!role || (role.organization_id !== null && role.organization_id !== orgId)) return { ok: false, error: 'role-not-found' };
    if (role.name === 'owner') return { ok: false, error: 'owner-role-locked' };
    const editGlobal = body.scope === 'global';
    if (editGlobal ? !access.global || role.organization_id !== null : !access.org) return { ok: false, error: 'forbidden' };

    if (body.permissions !== undefined) {
      const permError = checkPermissionIds(body.permissions) ?? checkAdminLock(role.name, body.permissions as string[]);
      if (permError) return { ok: false, error: permError };
    }
    // Only an org's own roles can be renamed: system role names are what the code and other orgs refer to.
    const isCustom = role.organization_id !== null && !(await this.globalRoleNamed(db, role.name));
    if (body.name !== undefined && body.name.trim() !== role.name) {
      if (!isCustom) return { ok: false, error: 'system-role-name-locked' };
      const taken = await db
        .select({ name: roles.name })
        .from(roles)
        .where(or(isNull(roles.organization_id), eq(roles.organization_id, orgId)));
      const nameError = checkRoleName(body.name, taken.filter((r) => r.name !== role.name).map((r) => r.name));
      if (nameError) return { ok: false, error: nameError };
    }
    let adminUserIds: string[] | undefined;
    if (body.adminUserIds !== undefined) {
      if (!Array.isArray(body.adminUserIds) || body.adminUserIds.some((id) => typeof id !== 'string')) return { ok: false, error: 'invalid-admin-users' };
      adminUserIds = [...new Set(body.adminUserIds as string[])];
    }

    const targetId = await db.transaction(async (tx) => {
      const id = !editGlobal && role.organization_id === null ? await this.createOrgCopy(tx, orgId, role.id) : role.id;
      const patch: Partial<typeof roles.$inferInsert> = {};
      if (body.name !== undefined && isCustom) patch.name = body.name.trim();
      if (body.description !== undefined) patch.description = typeof body.description === 'string' ? body.description.trim() || null : null;
      if (body.translations !== undefined) patch.translations = sanitizeTranslations(body.translations);
      if (adminUserIds !== undefined) patch.admin_user_ids = adminUserIds;
      if (Object.keys(patch).length) await tx.update(roles).set(patch).where(eq(roles.id, id));
      if (body.permissions !== undefined) {
        const ids = [...new Set(body.permissions as string[])];
        await tx.delete(role_permissions).where(eq(role_permissions.role_id, id));
        if (ids.length) await tx.insert(role_permissions).values(ids.map((permission_id) => ({ role_id: id, permission_id })));
      }
      return id;
    });

    const change = { scope: editGlobal ? 'global' : 'org', name: body.name, description: body.description, translations: body.translations, permissions: body.permissions, adminUserIds };
    void this.audit.record(orgId, callerId, 'role.update', 'role', targetId, change).catch(() => {});
    void this.versions.record('roles', targetId, 'update_delta', callerId, change).catch(() => {});
    return { ok: true, id: targetId };
  }

  /** Drop the org's copy of a global role: everything moves back to the default role. */
  @Post(':roleId/reset')
  async reset(@Param('orgId') orgId: string, @Param('roleId') roleId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await this.canAdminister(db, orgId, callerId)).org) return { ok: false, error: 'forbidden' };

    const [role] = await db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organization_id, orgId)));
    if (!role) return { ok: false, error: 'role-not-found' };
    const globalId = await this.globalRoleNamed(db, role.name);
    if (!globalId) return { ok: false, error: 'not-an-override' };

    await db.transaction(async (tx) => {
      await this.repoint(tx, orgId, role.id, globalId);
      await tx.delete(roles).where(eq(roles.id, role.id));
    });
    void this.audit.record(orgId, callerId, 'role.reset', 'role', role.id, { name: role.name }).catch(() => {});
    void this.versions.record('roles', role.id, 'delete', callerId, { id: role.id, name: role.name }).catch(() => {});
    return { ok: true, id: globalId };
  }

  /** Delete one of the org's own roles; refused while anyone holds it or a pending invitation uses it. */
  @Delete(':roleId')
  async remove(@Param('orgId') orgId: string, @Param('roleId') roleId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await this.canAdminister(db, orgId, callerId)).org) return { ok: false, error: 'forbidden' };

    const [role] = await db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organization_id, orgId)));
    if (!role) return { ok: false, error: 'role-not-found' };
    if (await this.globalRoleNamed(db, role.name)) return { ok: false, error: 'use-reset' };
    const inUse = await db.execute(
      sql`SELECT 1 FROM membership_roles WHERE role_id = ${roleId}
          UNION ALL SELECT 1 FROM organization_invitations WHERE role_id = ${roleId}
          LIMIT 1`,
    );
    if (inUse.rows.length) return { ok: false, error: 'role-in-use' };
    await db.delete(roles).where(eq(roles.id, roleId));
    void this.audit.record(orgId, callerId, 'role.delete', 'role', roleId, { name: role.name }).catch(() => {});
    void this.versions.record('roles', roleId, 'delete', callerId, { id: roleId, name: role.name }).catch(() => {});
    return { ok: true };
  }

  private async globalRoleNamed(db: Db | Tx, name: string): Promise<string | null> {
    const [row] = await db.select({ id: roles.id }).from(roles).where(and(isNull(roles.organization_id), eq(roles.name, name)));
    return row?.id ?? null;
  }

  /** Copy a global role (with its permissions) into the org and move the org's references onto the copy. */
  private async createOrgCopy(tx: Tx, orgId: string, globalId: string): Promise<string> {
    const [g] = await tx.select().from(roles).where(eq(roles.id, globalId));
    const [copy] = await tx
      .insert(roles)
      .values({
        organization_id: orgId,
        name: g.name,
        description: g.description,
        is_system_role: g.is_system_role,
        settings: g.settings,
        translations: g.translations,
        admin_user_ids: (g.admin_user_ids ?? []).filter(Boolean),
      })
      .returning({ id: roles.id });
    await tx.execute(
      sql`INSERT INTO role_permissions (role_id, permission_id) SELECT ${copy.id}, permission_id FROM role_permissions WHERE role_id = ${globalId}`,
    );
    await this.repoint(tx, orgId, globalId, copy.id);
    return copy.id;
  }

  /** Move this org's memberships, invitations and team-member roles from one role id to another. */
  private async repoint(tx: Tx, orgId: string, fromId: string, toId: string) {
    await tx.execute(
      sql`UPDATE membership_roles mr SET role_id = ${toId}
          FROM organization_memberships m
          WHERE mr.membership_id = m.id AND m.organization_id = ${orgId} AND mr.role_id = ${fromId}`,
    );
    await tx.execute(sql`UPDATE organization_invitations SET role_id = ${toId} WHERE organization_id = ${orgId} AND role_id = ${fromId}`);
    await tx.execute(
      sql`UPDATE team_members tm SET team_role_id = ${toId}
          FROM teams t WHERE tm.team_id = t.id AND t.organization_id = ${orgId} AND tm.team_role_id = ${fromId}`,
    );
  }
}
