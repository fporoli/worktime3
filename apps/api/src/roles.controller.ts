import { Controller, Get } from '@nestjs/common';
import { DbService } from './db.service';

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
    const pool = this.db.getPool();
    if (!pool) return [];
    const r = await pool.query(
      `SELECT id, name, description FROM roles WHERE organization_id IS NULL ORDER BY name`,
    );
    return r.rows.filter((row) => isAssignableInviteRole(row.name as string));
  }
}
