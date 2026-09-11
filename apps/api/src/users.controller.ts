import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, isAnyOrgAdmin, isOrgAdmin } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { users, user_identities, organizations, organization_memberships, roles, membership_roles } from './db/schema';

const USER_COLUMNS = { id: users.id, email: users.email, display_name: users.display_name, status: users.status };

@Controller('users')
export class UsersController {
  constructor(private readonly db: DbService) {}

  /** Resolve the caller from the validated JWT (local user id, or Keycloak sub -> user_identities). */
  @Get('me')
  async me(@Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const principal = req.user;
    if (!principal) return { ok: false, error: 'unauthenticated' };
    const rows =
      principal.kind === 'local'
        ? await db.select(USER_COLUMNS).from(users).where(eq(users.id, principal.sub))
        : await db
            .select(USER_COLUMNS)
            .from(users)
            .innerJoin(user_identities, eq(user_identities.user_id, users.id))
            .where(eq(user_identities.provider_user_id, principal.sub))
            .limit(1);
    if (rows.length === 0) return { ok: false, error: 'unknown-user' };
    return { ok: true, ...rows[0] };
  }

  /**
   * Find a user by email and list which organizations they belong to — scoped to
   * only the organizations the caller themself administers, so an admin of org A
   * can't use this to learn that some email is a member of unrelated org B.
   */
  @Get('lookup')
  async lookup(@Query('email') email: string | undefined, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, user: null, memberships: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isAnyOrgAdmin(db, callerId))) return { ok: false, error: 'forbidden' };
    const normalized = (email ?? '').trim().toLowerCase();
    if (!normalized) return { ok: false, error: 'email-required' };

    const [found] = await db.select(USER_COLUMNS).from(users).where(eq(users.email, normalized));
    if (!found) return { ok: true, user: null, memberships: [] };

    const rows = await db
      .select({
        organization_id: organization_memberships.organization_id,
        organization_name: organizations.name,
        status: organization_memberships.status,
        role_name: roles.name,
      })
      .from(organization_memberships)
      .innerJoin(organizations, eq(organizations.id, organization_memberships.organization_id))
      .leftJoin(membership_roles, eq(membership_roles.membership_id, organization_memberships.id))
      .leftJoin(roles, eq(roles.id, membership_roles.role_id))
      .where(eq(organization_memberships.user_id, found.id));

    // Only keep rows for organizations the caller themself administers.
    const distinctOrgIds = [...new Set(rows.map((r) => r.organization_id))];
    const allowedOrgIds = new Set<string>();
    for (const orgId of distinctOrgIds) {
      if (await isOrgAdmin(db, orgId, callerId)) allowedOrgIds.add(orgId);
    }

    const byOrg = new Map<string, { organization_id: string; organization_name: string; status: string; role_names: string[] }>();
    for (const row of rows) {
      if (!allowedOrgIds.has(row.organization_id)) continue;
      let entry = byOrg.get(row.organization_id);
      if (!entry) {
        entry = { organization_id: row.organization_id, organization_name: row.organization_name, status: row.status, role_names: [] };
        byOrg.set(row.organization_id, entry);
      }
      if (row.role_name) entry.role_names.push(row.role_name);
    }

    return { ok: true, user: found, memberships: [...byOrg.values()] };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    // Self-service, or org admin. Only admins may toggle is_active.
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unknown-user' };
    const admin = await isAnyOrgAdmin(db, callerId);
    if (id !== callerId && !admin) return { ok: false, error: 'forbidden' };
    const allowed = ['display_name', 'first_name', 'middle_name', 'last_name', 'locale', 'timezone', 'settings', 'is_active'];
    const keys = Object.keys(body).filter((k) => allowed.includes(k) && (admin || k !== 'is_active'));
    if (keys.length === 0) return { ok: true, noop: true };
    const patch: Partial<typeof users.$inferInsert> = {};
    for (const k of keys) (patch as Record<string, unknown>)[k] = body[k];
    patch.updated_at = new Date().toISOString();
    await db.update(users).set(patch).where(eq(users.id, id));
    return { ok: true };
  }
}
