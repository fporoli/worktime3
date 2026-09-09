import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { DbService } from './db.service';
import { callerUserId, isOrgAdmin, isOrgManagerOrAdmin, userOrgRole } from './access';
import { RbacService } from './rbac.service';
import type { AuthenticatedRequest } from './jwt.guard';

@Controller()
export class ProjectsController {
  constructor(
    private readonly db: DbService,
    private readonly rbac: RbacService,
  ) {}

  @Get('organizations/:orgId/projects')
  async list(@Param('orgId') orgId: string) {
    const pool = this.db.getPool();
    if (!pool) return [];
    const r = await pool.query(
      `SELECT p.*,
              u.display_name AS owner_name,
              u.email AS owner_email,
              COUNT(s.id)::int AS subproject_count
       FROM projects p
       LEFT JOIN users u ON u.id = p.owner_user_id
       LEFT JOIN subprojects s ON s.project_id = p.id
       WHERE p.organization_id = $1
       GROUP BY p.id, u.display_name, u.email
       ORDER BY p.name`,
      [orgId],
    );
    return r.rows;
  }

  @Post('organizations/:orgId/projects')
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { name: string; ownerUserId?: string; costItem?: string; type?: string },
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
    const ownerUserId = body.ownerUserId || callerId;
    const r = await pool.query(
      'INSERT INTO projects (organization_id, name, owner_user_id, cost_item, type) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [orgId, name, ownerUserId, body.costItem ?? null, body.type ?? 'internal'],
    );
    return { ok: true, id: r.rows[0].id, project: r.rows[0] };
  }

  @Patch('projects/:id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; ownerUserId?: string | null; costItem?: string | null; type?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };

    const projRes = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (projRes.rows.length === 0) return { ok: false, error: 'project-not-found' };
    const project = projRes.rows[0];

    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const role = await userOrgRole(pool, project.organization_id, callerId);
    const isAdmin = role === 'owner' || role === 'admin';
    const isOwner = project.owner_user_id === callerId;
    if (!isAdmin && !(role === 'manager' && isOwner)) {
      return { ok: false, error: 'forbidden' };
    }

    const sets: string[] = ['updated_at = NOW()'];
    const args: unknown[] = [id];
    if (body.name !== undefined) {
      args.push(body.name.trim());
      sets.push(`name = $${args.length}`);
    }
    if (body.ownerUserId !== undefined) {
      args.push(body.ownerUserId || null);
      sets.push(`owner_user_id = $${args.length}`);
    }
    if (body.costItem !== undefined) {
      args.push(body.costItem || null);
      sets.push(`cost_item = $${args.length}`);
    }
    if (body.type !== undefined) {
      args.push(body.type);
      sets.push(`type = $${args.length}`);
    }

    const r = await pool.query(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      args,
    );
    return { ok: true, project: r.rows[0] };
  }

  @Delete('projects/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };

    const projRes = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (projRes.rows.length === 0) return { ok: false, error: 'project-not-found' };
    const project = projRes.rows[0];

    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const role = await userOrgRole(pool, project.organization_id, callerId);
    const isAdmin = role === 'owner' || role === 'admin';
    const isOwner = project.owner_user_id === callerId;
    if (!isAdmin && !(role === 'manager' && isOwner)) {
      return { ok: false, error: 'forbidden' };
    }

    await pool.query('DELETE FROM projects WHERE id=$1', [id]);
    return { ok: true };
  }

  @Get('organizations/:orgId/subprojects')
  async orgSubList(@Param('orgId') orgId: string) {
    const pool = this.db.getPool();
    if (!pool) return [];
    const r = await pool.query(
      `SELECT s.*,
              p.name AS project_name,
              u.display_name AS owner_name,
              u.email AS owner_email
       FROM subprojects s
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN users u ON u.id = s.owner_user_id
       WHERE s.organization_id = $1
       ORDER BY p.name, s.name`,
      [orgId],
    );
    return r.rows;
  }

  @Get('projects/:id/subprojects')
  async subList(@Param('id') id: string) {
    const pool = this.db.getPool();
    if (!pool) return [];
    const r = await pool.query(
      `SELECT s.*,
              p.name AS project_name,
              u.display_name AS owner_name,
              u.email AS owner_email
       FROM subprojects s
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN users u ON u.id = s.owner_user_id
       WHERE s.project_id = $1
       ORDER BY s.name`,
      [id],
    );
    return r.rows;
  }

  @Post('projects/:id/subprojects')
  async subCreate(
    @Param('id') id: string,
    @Body() body: { organizationId?: string; name: string; ownerUserId?: string; costItem?: string; type?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };

    const projRes = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (projRes.rows.length === 0) return { ok: false, error: 'project-not-found' };
    const project = projRes.rows[0];
    const orgId = body.organizationId || (project.organization_id as string);

    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const role = (await userOrgRole(pool, orgId, callerId)) ?? 'user';
    const isProjectOwner = project.owner_user_id === callerId;
    if (!this.rbac.canCreateSubproject(role, isProjectOwner)) {
      return { ok: false, error: 'forbidden' };
    }

    const name = (body.name ?? '').trim();
    if (!name) return { ok: false, error: 'name-required' };
    const ownerUserId = body.ownerUserId || callerId;

    const r = await pool.query(
      'INSERT INTO subprojects (project_id, organization_id, name, owner_user_id, cost_item, type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [id, orgId, name, ownerUserId, body.costItem ?? null, body.type ?? 'phase'],
    );
    return { ok: true, id: r.rows[0].id, subproject: r.rows[0] };
  }

  @Patch('subprojects/:id')
  async subUpdate(
    @Param('id') id: string,
    @Body() body: { name?: string; ownerUserId?: string | null; costItem?: string | null; type?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };

    const subRes = await pool.query(
      `SELECT s.*, p.owner_user_id AS project_owner_user_id, p.organization_id
       FROM subprojects s
       JOIN projects p ON p.id = s.project_id
       WHERE s.id = $1`,
      [id],
    );
    if (subRes.rows.length === 0) return { ok: false, error: 'subproject-not-found' };
    const subproject = subRes.rows[0];

    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const role = (await userOrgRole(pool, subproject.organization_id, callerId)) ?? 'user';
    const isParentProjectOwner = subproject.project_owner_user_id === callerId;
    const isSubOwner = subproject.owner_user_id === callerId;
    const isAdmin = role === 'owner' || role === 'admin';

    if (!isAdmin && !(role === 'manager' && (isParentProjectOwner || isSubOwner))) {
      return { ok: false, error: 'forbidden' };
    }

    const sets: string[] = ['updated_at = NOW()'];
    const args: unknown[] = [id];
    if (body.name !== undefined) {
      args.push(body.name.trim());
      sets.push(`name = $${args.length}`);
    }
    if (body.ownerUserId !== undefined) {
      args.push(body.ownerUserId || null);
      sets.push(`owner_user_id = $${args.length}`);
    }
    if (body.costItem !== undefined) {
      args.push(body.costItem || null);
      sets.push(`cost_item = $${args.length}`);
    }
    if (body.type !== undefined) {
      args.push(body.type);
      sets.push(`type = $${args.length}`);
    }

    const r = await pool.query(
      `UPDATE subprojects SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      args,
    );
    return { ok: true, subproject: r.rows[0] };
  }

  @Delete('subprojects/:id')
  async subRemove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };

    const subRes = await pool.query(
      `SELECT s.*, p.owner_user_id AS project_owner_user_id, p.organization_id
       FROM subprojects s
       JOIN projects p ON p.id = s.project_id
       WHERE s.id = $1`,
      [id],
    );
    if (subRes.rows.length === 0) return { ok: false, error: 'subproject-not-found' };
    const subproject = subRes.rows[0];

    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const role = (await userOrgRole(pool, subproject.organization_id, callerId)) ?? 'user';
    const isParentProjectOwner = subproject.project_owner_user_id === callerId;
    const isSubOwner = subproject.owner_user_id === callerId;
    const isAdmin = role === 'owner' || role === 'admin';

    if (!isAdmin && !(role === 'manager' && (isParentProjectOwner || isSubOwner))) {
      return { ok: false, error: 'forbidden' };
    }

    await pool.query('DELETE FROM subprojects WHERE id = $1', [id]);
    return { ok: true };
  }
}
