import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { DbService } from './db.service';
import { callerUserId, isAnyOrgAdmin } from './access';
import type { AuthenticatedRequest } from './jwt.guard';

@Controller('static-data')
export class StaticDataController {
  constructor(private readonly db: DbService) {}

  /** All enum definitions across every entity, for the admin static-data screen. */
  @Get()
  async listAll() {
    const pool = this.db.getPool();
    if (!pool) return [];
    return (await pool.query('SELECT * FROM static_data ORDER BY entity, enum_name')).rows;
  }

  @Get(':category')
  async get(@Param('category') category: string) {
    const pool = this.db.getPool();
    if (!pool) return [];
    return (await pool.query('SELECT * FROM static_data WHERE entity=$1 ORDER BY enum_name', [category])).rows;
  }

  @Post()
  async create(
    @Body() body: { entity: string; entityUuid?: string; enumName: string; values: unknown; translation?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isAnyOrgAdmin(pool, callerId))) return { ok: false, error: 'forbidden' };
    if (!body.entity?.trim() || !body.enumName?.trim()) return { ok: false, error: 'entity-and-enum-name-required' };
    const r = await pool.query(
      'INSERT INTO static_data (entity, entity_uuid, enum_name, "values", translation) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [body.entity.trim(), body.entityUuid ?? null, body.enumName.trim(), JSON.stringify(body.values ?? {}), JSON.stringify(body.translation ?? {})],
    );
    return { ok: true, id: r.rows[0].id };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { enumName?: string; values?: unknown; translation?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isAnyOrgAdmin(pool, callerId))) return { ok: false, error: 'forbidden' };
    const sets: string[] = [];
    const args: unknown[] = [id];
    if (body.enumName !== undefined) {
      args.push(body.enumName.trim());
      sets.push(`enum_name = $${args.length}`);
    }
    if (body.values !== undefined) {
      args.push(JSON.stringify(body.values));
      sets.push(`"values" = $${args.length}`);
    }
    if (body.translation !== undefined) {
      args.push(JSON.stringify(body.translation));
      sets.push(`translation = $${args.length}`);
    }
    if (sets.length > 0) {
      await pool.query(`UPDATE static_data SET ${sets.join(', ')} WHERE id = $1`, args);
    }
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isAnyOrgAdmin(pool, callerId))) return { ok: false, error: 'forbidden' };
    await pool.query('DELETE FROM static_data WHERE id=$1', [id]);
    return { ok: true };
  }
}
