import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { DbService } from './db.service';

@Controller('users')
export class UsersController {
  constructor(private readonly db: DbService) {}

  @Get('me')
  me() {
    return { hint: 'Resolve user from Keycloak JWT (sub -> user_identities.provider_user_id).' };
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
