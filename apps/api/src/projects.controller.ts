import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { DbService } from './db.service';

@Controller()
export class ProjectsController {
  constructor(private readonly db: DbService) {}

  @Get('organizations/:orgId/projects')
  async list(@Param('orgId') orgId: string) {
    const pool = this.db.getPool();
    if (!pool) return [];
    return (await pool.query('SELECT * FROM projects WHERE organization_id=$1 ORDER BY name', [orgId])).rows;
  }

  @Post('organizations/:orgId/projects')
  async create(@Param('orgId') orgId: string, @Body() body: { name: string; ownerUserId: string; costItem?: string; type?: string }) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const r = await pool.query(
      'INSERT INTO projects (organization_id, name, owner_user_id, cost_item, type) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [orgId, body.name, body.ownerUserId, body.costItem ?? null, body.type ?? 'internal'],
    );
    return { ok: true, id: r.rows[0].id };
  }

  @Get('projects/:id/subprojects')
  async subList(@Param('id') id: string) {
    const pool = this.db.getPool();
    if (!pool) return [];
    return (await pool.query('SELECT * FROM subprojects WHERE project_id=$1 ORDER BY name', [id])).rows;
  }

  @Post('projects/:id/subprojects')
  async subCreate(@Param('id') id: string, @Body() body: { organizationId: string; name: string; ownerUserId: string; costItem?: string; type?: string }) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const r = await pool.query(
      'INSERT INTO subprojects (project_id, organization_id, name, owner_user_id, cost_item, type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [id, body.organizationId, body.name, body.ownerUserId, body.costItem ?? null, body.type ?? 'phase'],
    );
    return { ok: true, id: r.rows[0].id };
  }

  @Patch('projects/:id')
  async rename(@Param('id') id: string, @Body() body: { name: string }) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    await pool.query('UPDATE projects SET name=$2, updated_at=NOW() WHERE id=$1', [id, body.name]);
    return { ok: true };
  }

  @Delete('projects/:id')
  async remove(@Param('id') id: string) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    await pool.query('DELETE FROM projects WHERE id=$1', [id]);
    return { ok: true };
  }
}
