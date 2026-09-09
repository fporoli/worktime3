import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { DbService } from './db.service';
import { callerUserId, isOrgManagerOrAdmin } from './access';
import type { AuthenticatedRequest } from './jwt.guard';

@Controller()
export class TeamsController {
  constructor(private readonly db: DbService) {}

  @Get('organizations/:orgId/teams')
  async list(@Param('orgId') orgId: string) {
    const pool = this.db.getPool();
    if (!pool) return [];
    const r = await pool.query(
      `SELECT t.id, t.organization_id, t.name, t.description, t.created_at,
              COUNT(tm.membership_id)::int AS member_count
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       WHERE t.organization_id = $1
       GROUP BY t.id
       ORDER BY t.name`,
      [orgId],
    );
    return r.rows;
  }

  @Post('organizations/:orgId/teams')
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { name: string; description?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(pool, orgId, callerId))) {
      return { ok: false, error: 'forbidden' };
    }
    const name = (body.name ?? '').trim();
    if (!name) return { ok: false, error: 'name-required' };
    const r = await pool.query(
      'INSERT INTO teams (organization_id, name, description) VALUES ($1, $2, $3) RETURNING id, organization_id, name, description, created_at',
      [orgId, name, body.description ?? null],
    );
    return { ok: true, team: r.rows[0], id: r.rows[0].id };
  }

  @Patch('teams/:id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const teamRes = await pool.query('SELECT organization_id FROM teams WHERE id = $1', [id]);
    if (teamRes.rows.length === 0) return { ok: false, error: 'team-not-found' };
    const orgId = teamRes.rows[0].organization_id as string;

    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(pool, orgId, callerId))) {
      return { ok: false, error: 'forbidden' };
    }

    const sets: string[] = [];
    const args: unknown[] = [id];
    if (body.name !== undefined) {
      args.push(body.name.trim());
      sets.push(`name = $${args.length}`);
    }
    if (body.description !== undefined) {
      args.push(body.description);
      sets.push(`description = $${args.length}`);
    }
    if (sets.length === 0) return { ok: true, noop: true };

    const r = await pool.query(
      `UPDATE teams SET ${sets.join(', ')} WHERE id = $1 RETURNING id, organization_id, name, description, created_at`,
      args,
    );
    return { ok: true, team: r.rows[0] };
  }

  @Delete('teams/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const teamRes = await pool.query('SELECT organization_id FROM teams WHERE id = $1', [id]);
    if (teamRes.rows.length === 0) return { ok: false, error: 'team-not-found' };
    const orgId = teamRes.rows[0].organization_id as string;

    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(pool, orgId, callerId))) {
      return { ok: false, error: 'forbidden' };
    }

    await pool.query('DELETE FROM teams WHERE id = $1', [id]);
    return { ok: true };
  }

  @Get('teams/:id/members')
  async members(@Param('id') id: string) {
    const pool = this.db.getPool();
    if (!pool) return [];
    const r = await pool.query(
      `SELECT tm.team_id, tm.membership_id, tm.created_at,
              m.user_id, u.email, u.display_name,
              tm.manager_user_id, mu.display_name AS manager_display_name,
              tm.team_role_id, r.name AS team_role_name
       FROM team_members tm
       JOIN organization_memberships m ON m.id = tm.membership_id
       JOIN users u ON u.id = m.user_id
       LEFT JOIN users mu ON mu.id = tm.manager_user_id
       LEFT JOIN roles r ON r.id = tm.team_role_id
       WHERE tm.team_id = $1
       ORDER BY u.display_name`,
      [id],
    );
    return r.rows;
  }

  @Post('teams/:id/members')
  async addMember(
    @Param('id') id: string,
    @Body() body: { membershipId?: string; userId?: string; managerUserId?: string; teamRoleId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const teamRes = await pool.query('SELECT organization_id FROM teams WHERE id = $1', [id]);
    if (teamRes.rows.length === 0) return { ok: false, error: 'team-not-found' };
    const orgId = teamRes.rows[0].organization_id as string;

    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(pool, orgId, callerId))) {
      return { ok: false, error: 'forbidden' };
    }

    let membershipId = body.membershipId;
    if (!membershipId && body.userId) {
      const mRes = await pool.query(
        'SELECT id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
        [orgId, body.userId],
      );
      if (mRes.rows.length === 0) return { ok: false, error: 'membership-not-found' };
      membershipId = mRes.rows[0].id as string;
    }

    if (!membershipId) return { ok: false, error: 'membership-id-required' };

    await pool.query(
      `INSERT INTO team_members (team_id, membership_id, manager_user_id, team_role_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (team_id, membership_id) DO UPDATE
       SET manager_user_id = EXCLUDED.manager_user_id, team_role_id = EXCLUDED.team_role_id`,
      [id, membershipId, body.managerUserId ?? null, body.teamRoleId ?? null],
    );
    return { ok: true };
  }

  @Delete('teams/:id/members/:membershipId')
  async removeMember(
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const teamRes = await pool.query('SELECT organization_id FROM teams WHERE id = $1', [id]);
    if (teamRes.rows.length === 0) return { ok: false, error: 'team-not-found' };
    const orgId = teamRes.rows[0].organization_id as string;

    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(pool, orgId, callerId))) {
      return { ok: false, error: 'forbidden' };
    }

    await pool.query('DELETE FROM team_members WHERE team_id = $1 AND membership_id = $2', [id, membershipId]);
    return { ok: true };
  }
}

