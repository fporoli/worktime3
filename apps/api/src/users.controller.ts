import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { DbService } from './db.service';
import type { AuthenticatedRequest } from './jwt.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly db: DbService) {}

  /** Resolve the caller from the validated JWT (local user id, or Keycloak sub -> user_identities). */
  @Get('me')
  async me(@Req() req: AuthenticatedRequest) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const principal = req.user;
    if (!principal) return { ok: false, error: 'unauthenticated' };
    const rows =
      principal.kind === 'local'
        ? await pool.query('SELECT id, email, display_name, status FROM users WHERE id = $1', [principal.sub])
        : await pool.query(
            `SELECT u.id, u.email, u.display_name, u.status FROM users u
             JOIN user_identities i ON i.user_id = u.id
             WHERE i.provider_user_id = $1 LIMIT 1`,
            [principal.sub],
          );
    if (rows.rows.length === 0) return { ok: false, error: 'unknown-user' };
    return { ok: true, ...rows.rows[0] };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const allowed = ['display_name', 'first_name', 'middle_name', 'last_name', 'locale', 'timezone', 'settings', 'is_active'];
    const keys = Object.keys(body).filter((k) => allowed.includes(k));
    if (keys.length === 0) return { ok: true, noop: true };
    const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
    await pool.query(`UPDATE users SET ${sets}, updated_at=NOW() WHERE id=$1`, [id, ...keys.map((k) => body[k])]);
    return { ok: true };
  }
}
