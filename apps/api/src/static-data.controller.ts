import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { DbService } from './db.service';

@Controller('static-data')
export class StaticDataController {
  constructor(private readonly db: DbService) {}

  @Get(':category')
  async get(@Param('category') category: string) {
    const pool = this.db.getPool();
    if (!pool) return [];
    return (await pool.query('SELECT * FROM static_data WHERE entity=$1 ORDER BY enum_name', [category])).rows;
  }

  @Post()
  async create(@Body() body: { entity: string; entityUuid?: string; enumName: string; values: unknown; translation?: unknown }) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const r = await pool.query(
      'INSERT INTO static_data (entity, entity_uuid, enum_name, "values", translation) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [body.entity, body.entityUuid ?? null, body.enumName, JSON.stringify(body.values), JSON.stringify(body.translation ?? {})],
    );
    return { ok: true, id: r.rows[0].id };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    await pool.query('DELETE FROM static_data WHERE id=$1', [id]);
    return { ok: true };
  }
}
