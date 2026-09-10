import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, isAnyOrgAdmin } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { users, user_identities } from './db/schema';

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
