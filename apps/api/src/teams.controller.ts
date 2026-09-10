import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { and, asc, eq, getTableColumns, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DbService } from './db.service';
import { callerUserId, isOrgManagerOrAdmin, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { teams, team_members, organization_memberships, users, roles, work_times, projects, subprojects } from './db/schema';

const managerUsers = alias(users, 'manager_users');

@Controller()
export class TeamsController {
  constructor(private readonly db: DbService) {}

  @Get('organizations/:orgId/teams')
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];
    return db
      .select({
        id: teams.id,
        organization_id: teams.organization_id,
        name: teams.name,
        description: teams.description,
        created_at: teams.created_at,
        member_count: sql<number>`count(${team_members.membership_id})::int`,
      })
      .from(teams)
      .leftJoin(team_members, eq(team_members.team_id, teams.id))
      .where(eq(teams.organization_id, orgId))
      .groupBy(teams.id)
      .orderBy(asc(teams.name));
  }

  @Post('organizations/:orgId/teams')
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { name: string; description?: string },
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
    const [team] = await db
      .insert(teams)
      .values({ organization_id: orgId, name, description: body.description ?? null })
      .returning({
        id: teams.id,
        organization_id: teams.organization_id,
        name: teams.name,
        description: teams.description,
        created_at: teams.created_at,
      });
    return { ok: true, team, id: team.id };
  }

  @Patch('teams/:id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [team] = await db.select({ organization_id: teams.organization_id }).from(teams).where(eq(teams.id, id));
    if (!team) return { ok: false, error: 'team-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(db, team.organization_id, callerId))) {
      return { ok: false, error: 'forbidden' };
    }

    const patch: Partial<typeof teams.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.description !== undefined) patch.description = body.description;
    if (Object.keys(patch).length === 0) return { ok: true, noop: true };

    const [updated] = await db
      .update(teams)
      .set(patch)
      .where(eq(teams.id, id))
      .returning({
        id: teams.id,
        organization_id: teams.organization_id,
        name: teams.name,
        description: teams.description,
        created_at: teams.created_at,
      });
    return { ok: true, team: updated };
  }

  @Delete('teams/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [team] = await db.select({ organization_id: teams.organization_id }).from(teams).where(eq(teams.id, id));
    if (!team) return { ok: false, error: 'team-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(db, team.organization_id, callerId))) {
      return { ok: false, error: 'forbidden' };
    }

    await db.delete(teams).where(eq(teams.id, id));
    return { ok: true };
  }

  @Get('teams/:id/members')
  async members(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const [team] = await db.select({ organization_id: teams.organization_id }).from(teams).where(eq(teams.id, id));
    if (!team) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, team.organization_id, callerId))) return [];
    return db
      .select({
        team_id: team_members.team_id,
        membership_id: team_members.membership_id,
        created_at: team_members.created_at,
        user_id: organization_memberships.user_id,
        email: users.email,
        display_name: users.display_name,
        manager_user_id: team_members.manager_user_id,
        manager_display_name: managerUsers.display_name,
        team_role_id: team_members.team_role_id,
        team_role_name: roles.name,
      })
      .from(team_members)
      .innerJoin(organization_memberships, eq(organization_memberships.id, team_members.membership_id))
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .leftJoin(managerUsers, eq(managerUsers.id, team_members.manager_user_id))
      .leftJoin(roles, eq(roles.id, team_members.team_role_id))
      .where(eq(team_members.team_id, id))
      .orderBy(asc(users.display_name));
  }

  /**
   * Booked work time for every member of a team, so a manager can see hours
   * per person without opening each member's own log. Members with zero
   * entries in range still appear (with an empty entries list) so nobody
   * silently drops off the report.
   */
  @Get('teams/:id/work-time')
  async workTime(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('withCost') withCost?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return { members: [], entries: [] };
    const [team] = await db.select({ organization_id: teams.organization_id }).from(teams).where(eq(teams.id, id));
    if (!team) return { members: [], entries: [] };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgManagerOrAdmin(db, team.organization_id, callerId))) {
      return { members: [], entries: [] };
    }

    const members = await db
      .select({ user_id: organization_memberships.user_id, email: users.email, display_name: users.display_name })
      .from(team_members)
      .innerJoin(organization_memberships, eq(organization_memberships.id, team_members.membership_id))
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(eq(team_members.team_id, id))
      .orderBy(asc(users.display_name));
    if (members.length === 0) return { members: [], entries: [] };

    const memberIds = members.map((m) => m.user_id);
    const conditions: SQL[] = [
      inArray(work_times.user_id, memberIds),
      eq(work_times.organization_id, team.organization_id),
    ];
    if (from) conditions.push(gte(work_times.start_time, from));
    if (to) conditions.push(lt(work_times.start_time, to));

    const includeCost = withCost === 'true';
    const entries = await db
      .select({
        ...getTableColumns(work_times),
        project_name: projects.name,
        subproject_name: subprojects.name,
        // Rate active on the entry's own date, not today's — a plain per-row column, not a joined
        // aggregate, so the frontend does the cost = hours * rate math itself (same place it already
        // computes minutes from start/end via aggregate.ts's `minutes()`).
        ...(includeCost
          ? {
              hourly_rate: sql<string | null>`(
                SELECT mr.hourly_rate FROM member_rates mr
                WHERE mr.organization_id = ${team.organization_id}
                  AND mr.user_id = ${work_times.user_id}
                  AND mr.effective_from <= ${work_times.start_time}::date
                  AND (mr.effective_to IS NULL OR mr.effective_to > ${work_times.start_time}::date)
                LIMIT 1
              )`.as('hourly_rate'),
            }
          : {}),
      })
      .from(work_times)
      .leftJoin(projects, eq(projects.id, work_times.project_id))
      .leftJoin(subprojects, eq(subprojects.id, work_times.subproject_id))
      .where(and(...conditions))
      .orderBy(asc(work_times.start_time));

    return { members, entries };
  }

  @Post('teams/:id/members')
  async addMember(
    @Param('id') id: string,
    @Body() body: { membershipId?: string; userId?: string; managerUserId?: string; teamRoleId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [team] = await db.select({ organization_id: teams.organization_id }).from(teams).where(eq(teams.id, id));
    if (!team) return { ok: false, error: 'team-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(db, team.organization_id, callerId))) {
      return { ok: false, error: 'forbidden' };
    }

    let membershipId = body.membershipId;
    if (!membershipId && body.userId) {
      const [membership] = await db
        .select({ id: organization_memberships.id })
        .from(organization_memberships)
        .where(
          and(
            eq(organization_memberships.organization_id, team.organization_id),
            eq(organization_memberships.user_id, body.userId),
          ),
        );
      if (!membership) return { ok: false, error: 'membership-not-found' };
      membershipId = membership.id;
    }

    if (!membershipId) return { ok: false, error: 'membership-id-required' };

    await db
      .insert(team_members)
      .values({
        team_id: id,
        membership_id: membershipId,
        manager_user_id: body.managerUserId ?? null,
        team_role_id: body.teamRoleId ?? null,
      })
      .onConflictDoUpdate({
        target: [team_members.team_id, team_members.membership_id],
        set: { manager_user_id: body.managerUserId ?? null, team_role_id: body.teamRoleId ?? null },
      });
    return { ok: true };
  }

  @Delete('teams/:id/members/:membershipId')
  async removeMember(
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [team] = await db.select({ organization_id: teams.organization_id }).from(teams).where(eq(teams.id, id));
    if (!team) return { ok: false, error: 'team-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(db, team.organization_id, callerId))) {
      return { ok: false, error: 'forbidden' };
    }

    await db
      .delete(team_members)
      .where(and(eq(team_members.team_id, id), eq(team_members.membership_id, membershipId)));
    return { ok: true };
  }
}
