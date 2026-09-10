import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { asc, eq, getTableColumns, sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, isOrgManagerOrAdmin, isOrgMember, userOrgRole } from './access';
import { RbacService } from './rbac.service';
import type { AuthenticatedRequest } from './jwt.guard';
import { projects, subprojects, users } from './db/schema';

@Controller()
export class ProjectsController {
  constructor(
    private readonly db: DbService,
    private readonly rbac: RbacService,
  ) {}

  @Get('organizations/:orgId/projects')
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];
    return db
      .select({
        ...getTableColumns(projects),
        owner_name: users.display_name,
        owner_email: users.email,
        subproject_count: sql<number>`count(${subprojects.id})::int`,
      })
      .from(projects)
      .leftJoin(users, eq(users.id, projects.owner_user_id))
      .leftJoin(subprojects, eq(subprojects.project_id, projects.id))
      .where(eq(projects.organization_id, orgId))
      .groupBy(projects.id, users.display_name, users.email)
      .orderBy(asc(projects.name));
  }

  @Post('organizations/:orgId/projects')
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { name: string; ownerUserId?: string; costItem?: string; type?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(db, orgId, callerId))) {
      return { ok: false, error: 'forbidden' };
    }
    const name = (body.name ?? '').trim();
    if (!name) return { ok: false, error: 'name-required' };
    const ownerUserId = body.ownerUserId || callerId;
    const [project] = await db
      .insert(projects)
      .values({
        organization_id: orgId,
        name,
        owner_user_id: ownerUserId,
        cost_item: body.costItem ?? null,
        type: (body.type as (typeof projects.$inferInsert)['type']) ?? 'internal',
      })
      .returning();
    return { ok: true, id: project.id, project };
  }

  @Patch('projects/:id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; ownerUserId?: string | null; costItem?: string | null; type?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };

    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    if (!project) return { ok: false, error: 'project-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const role = await userOrgRole(db, project.organization_id, callerId);
    const isAdmin = role === 'owner' || role === 'admin';
    const isOwner = project.owner_user_id === callerId;
    if (!isAdmin && !(role === 'manager' && isOwner)) {
      return { ok: false, error: 'forbidden' };
    }

    const patch: Partial<typeof projects.$inferInsert> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.ownerUserId !== undefined) patch.owner_user_id = body.ownerUserId || null;
    if (body.costItem !== undefined) patch.cost_item = body.costItem || null;
    if (body.type !== undefined) patch.type = body.type as (typeof projects.$inferInsert)['type'];

    const [updated] = await db.update(projects).set(patch).where(eq(projects.id, id)).returning();
    return { ok: true, project: updated };
  }

  @Delete('projects/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };

    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    if (!project) return { ok: false, error: 'project-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const role = await userOrgRole(db, project.organization_id, callerId);
    const isAdmin = role === 'owner' || role === 'admin';
    const isOwner = project.owner_user_id === callerId;
    if (!isAdmin && !(role === 'manager' && isOwner)) {
      return { ok: false, error: 'forbidden' };
    }

    await db.delete(projects).where(eq(projects.id, id));
    return { ok: true };
  }

  @Get('organizations/:orgId/subprojects')
  async orgSubList(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];
    return db
      .select({
        ...getTableColumns(subprojects),
        project_name: projects.name,
        owner_name: users.display_name,
        owner_email: users.email,
      })
      .from(subprojects)
      .innerJoin(projects, eq(projects.id, subprojects.project_id))
      .leftJoin(users, eq(users.id, subprojects.owner_user_id))
      .where(eq(subprojects.organization_id, orgId))
      .orderBy(asc(projects.name), asc(subprojects.name));
  }

  @Get('projects/:id/subprojects')
  async subList(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const [project] = await db.select({ organization_id: projects.organization_id }).from(projects).where(eq(projects.id, id));
    if (!project) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, project.organization_id, callerId))) return [];
    return db
      .select({
        ...getTableColumns(subprojects),
        project_name: projects.name,
        owner_name: users.display_name,
        owner_email: users.email,
      })
      .from(subprojects)
      .innerJoin(projects, eq(projects.id, subprojects.project_id))
      .leftJoin(users, eq(users.id, subprojects.owner_user_id))
      .where(eq(subprojects.project_id, id))
      .orderBy(asc(subprojects.name));
  }

  @Post('projects/:id/subprojects')
  async subCreate(
    @Param('id') id: string,
    @Body() body: { organizationId?: string; name: string; ownerUserId?: string; costItem?: string; type?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };

    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    if (!project) return { ok: false, error: 'project-not-found' };
    const orgId = body.organizationId || project.organization_id;

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const role = (await userOrgRole(db, orgId, callerId)) ?? 'user';
    const isProjectOwner = project.owner_user_id === callerId;
    if (!this.rbac.canCreateSubproject(role, isProjectOwner)) {
      return { ok: false, error: 'forbidden' };
    }

    const name = (body.name ?? '').trim();
    if (!name) return { ok: false, error: 'name-required' };
    const ownerUserId = body.ownerUserId || callerId;

    const [subproject] = await db
      .insert(subprojects)
      .values({
        project_id: id,
        organization_id: orgId,
        name,
        owner_user_id: ownerUserId,
        cost_item: body.costItem ?? null,
        type: (body.type as (typeof subprojects.$inferInsert)['type']) ?? 'phase',
      })
      .returning();
    return { ok: true, id: subproject.id, subproject };
  }

  /** Shared by subUpdate/subRemove: the subproject plus its parent project's owner/org, for the authz check. */
  private async subprojectWithParent(db: NonNullable<ReturnType<DbService['getDb']>>, id: string) {
    const [row] = await db
      .select({
        ...getTableColumns(subprojects),
        project_owner_user_id: projects.owner_user_id,
      })
      .from(subprojects)
      .innerJoin(projects, eq(projects.id, subprojects.project_id))
      .where(eq(subprojects.id, id));
    return row;
  }

  @Patch('subprojects/:id')
  async subUpdate(
    @Param('id') id: string,
    @Body() body: { name?: string; ownerUserId?: string | null; costItem?: string | null; type?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };

    const subproject = await this.subprojectWithParent(db, id);
    if (!subproject) return { ok: false, error: 'subproject-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const role = (await userOrgRole(db, subproject.organization_id, callerId)) ?? 'user';
    const isParentProjectOwner = subproject.project_owner_user_id === callerId;
    const isSubOwner = subproject.owner_user_id === callerId;
    const isAdmin = role === 'owner' || role === 'admin';

    if (!isAdmin && !(role === 'manager' && (isParentProjectOwner || isSubOwner))) {
      return { ok: false, error: 'forbidden' };
    }

    const patch: Partial<typeof subprojects.$inferInsert> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.ownerUserId !== undefined) patch.owner_user_id = body.ownerUserId || null;
    if (body.costItem !== undefined) patch.cost_item = body.costItem || null;
    if (body.type !== undefined) patch.type = body.type as (typeof subprojects.$inferInsert)['type'];

    const [updated] = await db.update(subprojects).set(patch).where(eq(subprojects.id, id)).returning();
    return { ok: true, subproject: updated };
  }

  @Delete('subprojects/:id')
  async subRemove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };

    const subproject = await this.subprojectWithParent(db, id);
    if (!subproject) return { ok: false, error: 'subproject-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const role = (await userOrgRole(db, subproject.organization_id, callerId)) ?? 'user';
    const isParentProjectOwner = subproject.project_owner_user_id === callerId;
    const isSubOwner = subproject.owner_user_id === callerId;
    const isAdmin = role === 'owner' || role === 'admin';

    if (!isAdmin && !(role === 'manager' && (isParentProjectOwner || isSubOwner))) {
      return { ok: false, error: 'forbidden' };
    }

    await db.delete(subprojects).where(eq(subprojects.id, id));
    return { ok: true };
  }
}
