import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DbService } from './db.service';
import { WorktimeService } from './worktime.service';

@Controller()
export class WorktimeController {
  constructor(
    private readonly db: DbService,
    private readonly wt: WorktimeService,
  ) {}

  @Post('organizations/:orgId/work-time')
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { userId: string; projectId?: string; subprojectId?: string; startTime: string; endTime: string; comment?: string },
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const r = await pool.query(
      'INSERT INTO work_times (user_id, organization_id, project_id, subproject_id, start_time, end_time, comment) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [body.userId, orgId, body.projectId ?? null, body.subprojectId ?? null, body.startTime, body.endTime, body.comment ?? null],
    );
    return { ok: true, id: r.rows[0].id };
  }

  @Get('organizations/:orgId/work-time')
  async list(
    @Param('orgId') orgId: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('view') view?: 'daily' | 'weekly' | 'monthly',
  ) {
    const pool = this.db.getPool();
    if (!pool) return { entries: [], summary: {} };
    const cond: string[] = ['organization_id=$1'];
    const args: unknown[] = [orgId];
    if (userId) {
      args.push(userId);
      cond.push(`user_id=$${args.length}`);
    }
    if (from) {
      args.push(from);
      cond.push(`start_time >= $${args.length}`);
    }
    if (to) {
      args.push(to);
      cond.push(`start_time < $${args.length}`);
    }
    const rows = (await pool.query(`SELECT * FROM work_times WHERE ${cond.join(' AND ')} ORDER BY start_time`, args)).rows;
    const summary = this.wt.bucket(
      rows.map((r: { start_time: string; end_time: string }) => ({ startTime: r.start_time, endTime: r.end_time })),
      view ?? 'daily',
    );
    return { entries: rows, summary };
  }

  @Patch('work-time/:id')
  async update(@Param('id') id: string, @Body() body: { comment?: string; endTime?: string }) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    if (body.comment !== undefined) await pool.query('UPDATE work_times SET comment=$2, updated_at=NOW() WHERE id=$1', [id, body.comment]);
    if (body.endTime !== undefined) await pool.query('UPDATE work_times SET end_time=$2, updated_at=NOW() WHERE id=$1', [id, body.endTime]);
    return { ok: true };
  }

  @Delete('work-time/:id')
  async remove(@Param('id') id: string) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    await pool.query('DELETE FROM work_times WHERE id=$1', [id]);
    return { ok: true };
  }
}
