import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { and, eq, ilike, or } from 'drizzle-orm';
import { DbService } from './db.service';
import { VersionsService } from './versions.service';
import { callerUserId, isAnyOrgAdmin, isOrgAdmin } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { users, user_identities, organization_memberships } from './db/schema';
import { membershipsOf } from './auth.controller';
import { mintLocalToken } from './jwt';

const USER_COLUMNS = { id: users.id, email: users.email, display_name: users.display_name, status: users.status, locale: users.locale, settings: users.settings };

@Controller('users')
export class UsersController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
  ) {}

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

  /** Search members of an organization the caller administers for temporary impersonation. */
  @Get('search')
  async search(@Query('orgId') orgId: string | undefined, @Query('q') query: string | undefined, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, users: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !orgId || !(await isOrgAdmin(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const normalized = (query ?? '').trim();
    if (normalized.length < 2) return { ok: true, users: [] };
    const rows = await db
      .select({ id: users.id, email: users.email, displayName: users.display_name, status: organization_memberships.status })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(and(
        eq(organization_memberships.organization_id, orgId),
        or(ilike(users.email, `%${normalized}%`), ilike(users.display_name, `%${normalized}%`)),
      ))
      .limit(20);
    return { ok: true, users: rows };
  }

  /** Mint a short-lived local token for a member of an organization the caller administers. */
  @Post(':id/impersonate')
  async impersonate(@Param('id') id: string, @Body() body: { orgId?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !body.orgId || !(await isOrgAdmin(db, body.orgId, callerId))) return { ok: false, error: 'forbidden' };
    const [member] = await db
      .select({ id: users.id, email: users.email, displayName: users.display_name })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(and(eq(organization_memberships.organization_id, body.orgId), eq(organization_memberships.user_id, id), eq(organization_memberships.status, 'active')));
    if (!member) return { ok: false, error: 'user-not-member' };
    return {
      ok: true,
      userId: member.id,
      email: member.email,
      displayName: member.displayName,
      token: await mintLocalToken(member.id, member.email, 60 * 60),
      memberships: await membershipsOf(db, member.id),
    };
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
    await db.update(users).set(patch).where(eq(users.id, id));
    void this.versions.record('users', id, 'update_delta', callerId, patch).catch(() => {});
    return { ok: true };
  }
}
