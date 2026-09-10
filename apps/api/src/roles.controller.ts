import { Controller, Get } from '@nestjs/common';
import { asc, isNull } from 'drizzle-orm';
import { DbService } from './db.service';
import { roles } from './db/schema';

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
