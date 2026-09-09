import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { DbService } from './db.service';
import { WorktimeService } from './worktime.service';
import { callerUserId } from './access';
import type { AuthenticatedRequest } from './jwt.guard';

@Controller()
export class WorktimeController {
  constructor(
    private readonly db: DbService,
    private readonly wt: WorktimeService,
  ) {}

  @Post('organizations/:orgId/work-time')
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { projectId?: string; subprojectId?: string; startTime: string; endTime: string; comment?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    // The entry always belongs to the caller — never trust a client-supplied user id.
    const userId = req.user ? await callerUserId(pool, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    const r = await pool.query(
      'INSERT INTO work_times (user_id, organization_id, project_id, subproject_id, start_time, end_time, comment) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [userId, orgId, body.projectId ?? null, body.subprojectId ?? null, body.startTime, body.endTime, body.comment ?? null],
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
    const cond: string[] = ['w.organization_id=$1'];
    const args: unknown[] = [orgId];
    if (userId) {
      args.push(userId);
      cond.push(`w.user_id=$${args.length}`);
    }
    if (from) {
      args.push(from);
      cond.push(`w.start_time >= $${args.length}`);
    }
    if (to) {
      args.push(to);
      cond.push(`w.start_time < $${args.length}`);
    }
    // Names come along so the UI can list entries without a lookup per row.
    const rows = (
      await pool.query(
        `SELECT w.*, p.name AS project_name, s.name AS subproject_name
         FROM work_times w
         LEFT JOIN projects p ON p.id = w.project_id
         LEFT JOIN subprojects s ON s.id = w.subproject_id
         WHERE ${cond.join(' AND ')}
         ORDER BY w.start_time`,
        args,
      )
    ).rows;
    const summary = this.wt.bucket(
      rows.map((r: { start_time: string; end_time: string }) => ({ startTime: r.start_time, endTime: r.end_time })),
      view ?? 'daily',
    );
    return { entries: rows, summary };
  }

  @Patch('work-time/:id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      projectId?: string | null;
      subprojectId?: string | null;
      startTime?: string;
      endTime?: string;
      comment?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const owned = await this.assertOwnEntry(pool, id, req);
    if (owned) return owned;
    const sets: string[] = [];
    const args: unknown[] = [id];
    const set = (column: string, value: unknown) => {
      args.push(value);
      sets.push(`${column}=$${args.length}`);
    };
    if (body.projectId !== undefined) set('project_id', body.projectId || null);
    if (body.subprojectId !== undefined) set('subproject_id', body.subprojectId || null);
    if (body.startTime !== undefined) set('start_time', body.startTime);
    if (body.endTime !== undefined) set('end_time', body.endTime);
    if (body.comment !== undefined) set('comment', body.comment);
    if (sets.length === 0) return { ok: true };
    // One statement: start/end move together, so chk_worktime_order never sees a half-applied edit.
    await pool.query(`UPDATE work_times SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$1`, args);
    return { ok: true };
  }

  @Delete('work-time/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const owned = await this.assertOwnEntry(pool, id, req);
    if (owned) return owned;
    await pool.query('DELETE FROM work_times WHERE id=$1', [id]);
    return { ok: true };
  }

  /** Entries are only editable by the user they belong to. Returns an error body, or null when allowed. */
  private async assertOwnEntry(
    pool: NonNullable<ReturnType<DbService['getPool']>>,
    id: string,
    req: AuthenticatedRequest,
  ): Promise<{ ok: false; error: string } | null> {
    const userId = req.user ? await callerUserId(pool, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    const row = (await pool.query('SELECT user_id FROM work_times WHERE id=$1', [id])).rows[0];
    if (!row) return { ok: false, error: 'not-found' };
    if (row.user_id !== userId) return { ok: false, error: 'forbidden' };
    return null;
  }
}
