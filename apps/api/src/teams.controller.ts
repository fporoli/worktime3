import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { and, asc, eq, getTableColumns, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DbService } from './db.service';
import { callerUserId, canManageTeamMembers, isOrgAdmin, isOrgManagerOrAdmin, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { teams, team_members, organization_memberships, users, roles, work_times, projects, subprojects } from './db/schema';

const leadUsers = alias(users, 'lead_users');

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
        lead_user_id: teams.lead_user_id,
        lead_display_name: leadUsers.display_name,
        member_count: sql<number>`count(${team_members.membership_id})::int`,
      })
      .from(teams)
      .leftJoin(team_members, eq(team_members.team_id, teams.id))
      .leftJoin(leadUsers, eq(leadUsers.id, teams.lead_user_id))
      .where(eq(teams.organization_id, orgId))
      .groupBy(teams.id, leadUsers.display_name)
      .orderBy(asc(teams.name));
  }

  @Post('organizations/:orgId/teams')
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { name: string; description?: string; leadUserId?: string | null },
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
    // Only an org admin may designate the team lead — a manager creating a team can't hand themself that.
    if (body.leadUserId !== undefined && !(await isOrgAdmin(db, orgId, callerId))) {
      return { ok: false, error: 'forbidden-lead' };
    }
    const [team] = await db
      .insert(teams)
      .values({ organization_id: orgId, name, description: body.description ?? null, lead_user_id: body.leadUserId ?? null })
      .returning({
        id: teams.id,
        organization_id: teams.organization_id,
        name: teams.name,
        description: teams.description,
        created_at: teams.created_at,
        lead_user_id: teams.lead_user_id,
      });
    return { ok: true, team, id: team.id };
  }

  @Patch('teams/:id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; leadUserId?: string | null },
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
    // Only an org admin may reassign the team lead.
    if (body.leadUserId !== undefined && !(await isOrgAdmin(db, team.organization_id, callerId))) {
      return { ok: false, error: 'forbidden-lead' };
    }

    const patch: Partial<typeof teams.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.description !== undefined) patch.description = body.description;
    if (body.leadUserId !== undefined) patch.lead_user_id = body.leadUserId;
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
        lead_user_id: teams.lead_user_id,
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
        team_role_id: team_members.team_role_id,
        team_role_name: roles.name,
      })
      .from(team_members)
      .innerJoin(organization_memberships, eq(organization_memberships.id, team_members.membership_id))
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
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

    const entries = await db
      .select({
        ...getTableColumns(work_times),
        project_name: projects.name,
        subproject_name: subprojects.name,
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
    @Body() body: { membershipId?: string; userId?: string; teamRoleId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [team] = await db.select({ organization_id: teams.organization_id }).from(teams).where(eq(teams.id, id));
    if (!team) return { ok: false, error: 'team-not-found' };

    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await canManageTeamMembers(db, team.organization_id, id, callerId))) {
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
        team_role_id: body.teamRoleId ?? null,
      })
      .onConflictDoUpdate({
        target: [team_members.team_id, team_members.membership_id],
        set: { team_role_id: body.teamRoleId ?? null },
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
    if (!(await canManageTeamMembers(db, team.organization_id, id, callerId))) {
      return { ok: false, error: 'forbidden' };
    }

    await db
      .delete(team_members)
      .where(and(eq(team_members.team_id, id), eq(team_members.membership_id, membershipId)));
    return { ok: true };
  }
}
