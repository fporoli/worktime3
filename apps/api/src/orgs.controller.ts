import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, canManageRole, isOrgAdmin, isOrgManagerOrAdmin, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { sendMail } from './mailer';
import { isValidEmail } from './auth.controller';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import {
  organizations,
  organization_memberships,
  organization_invitations,
  organization_domains,
  users,
  roles,
} from './db/schema';

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

export function buildInviteEmail(orgName: string, token: string): { subject: string; text: string } {
  const link = `${appBaseUrl()}/?invite=${encodeURIComponent(token)}`;
  return {
    subject: `You've been invited to ${orgName} on Worktime`,
    text: `Hi,\n\nYou've been invited to join "${orgName}".\n\nAccept it here: ${link}\n\nOr paste this token on the Invited tab of the login screen: ${token}\n`,
  };
}

const managerUsers = alias(users, 'manager_users');

const ORG_COLUMNS = {
  id: organizations.id,
  slug: organizations.slug,
  name: organizations.name,
  type: organizations.type,
  avatar_url: organizations.avatar_url,
  settings: organizations.settings,
};

/** Default reporting currency when an org hasn't set one in `settings.defaultCurrency` yet. */
const FALLBACK_DEFAULT_CURRENCY = 'CHF';

/** Default full-day vacation hours when an org hasn't set `settings.maxHoursPerDay` yet. */
const DEFAULT_MAX_HOURS_PER_DAY = 8;

@Controller('organizations')
export class OrgsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
  ) {}

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, id, callerId))) return null;
    const [org] = await db.select(ORG_COLUMNS).from(organizations).where(eq(organizations.id, id));
    if (!org) return null;
    const { settings, ...rest } = org;
    const settingsObj = settings as Record<string, unknown> | null;
    const defaultCurrency = settingsObj?.defaultCurrency;
    const maxHoursPerDay = settingsObj?.maxHoursPerDay;
    return {
      ...rest,
      default_currency: typeof defaultCurrency === 'string' ? defaultCurrency : FALLBACK_DEFAULT_CURRENCY,
      max_hours_per_day: typeof maxHoursPerDay === 'number' ? maxHoursPerDay : DEFAULT_MAX_HOURS_PER_DAY,
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; avatarUrl?: string | null; defaultCurrency?: string; maxHoursPerDay?: number },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(db, id, callerId))) return { ok: false, error: 'forbidden' };
    if (body.name !== undefined && !body.name.trim()) return { ok: false, error: 'name-required' };
    if (body.defaultCurrency !== undefined && !/^[A-Za-z]{3}$/.test(body.defaultCurrency)) {
      return { ok: false, error: 'invalid-default-currency' };
    }
    if (body.maxHoursPerDay !== undefined && !(typeof body.maxHoursPerDay === 'number' && body.maxHoursPerDay > 0 && body.maxHoursPerDay <= 24)) {
      return { ok: false, error: 'invalid-max-hours-per-day' };
    }

    const patch: Partial<typeof organizations.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.avatarUrl !== undefined) patch.avatar_url = body.avatarUrl;
    // Merged into the existing settings JSON rather than a dedicated column — same bucket
    // every other org-level, rarely-queried setting already lives in (see 006-fold-org-settings-and-sso.sql).
    const settingsPatch: Record<string, unknown> = {};
    if (body.defaultCurrency !== undefined) settingsPatch.defaultCurrency = body.defaultCurrency.toUpperCase();
    if (body.maxHoursPerDay !== undefined) settingsPatch.maxHoursPerDay = body.maxHoursPerDay;
    if (Object.keys(settingsPatch).length > 0) {
      patch.settings = sql`${organizations.settings} || ${JSON.stringify(settingsPatch)}::jsonb`;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(organizations).set(patch).where(eq(organizations.id, id));
      void this.audit.record(id, callerId, 'organization.update', 'organization', id, { ...patch, settings: settingsPatch }).catch(() => {});
      void this.versions.record('organizations', id, 'update_delta', callerId, { ...patch, settings: settingsPatch }).catch(() => {});
    }
    return { ok: true };
  }

  @Get(':id/members')
  async members(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, id, callerId))) return [];
    const rows = await db
      .select({
        id: organization_memberships.id,
        user_id: organization_memberships.user_id,
        status: organization_memberships.status,
        email: users.email,
        display_name: users.display_name,
        manager_user_id: organization_memberships.manager_user_id,
        manager_display_name: managerUsers.display_name,
        settings: organization_memberships.settings,
        role_id: roles.id,
        role_name: roles.name,
      })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .leftJoin(managerUsers, eq(managerUsers.id, organization_memberships.manager_user_id))
      .leftJoin(roles, sql`${roles.id} = ANY(${organization_memberships.role_ids})`)
      .where(eq(organization_memberships.organization_id, id));

    // A membership can hold several roles now — fold the joined rows back into one entry per member.
    const byMembership = new Map<
      string,
      {
        id: string;
        user_id: string;
        status: string;
        email: string;
        display_name: string;
        manager_user_id: string | null;
        manager_display_name: string | null;
        settings: unknown;
        role_ids: string[];
        role_names: string[];
      }
    >();
    for (const row of rows) {
      let entry = byMembership.get(row.id);
      if (!entry) {
        entry = {
          id: row.id,
          user_id: row.user_id,
          status: row.status,
          email: row.email,
          display_name: row.display_name,
          manager_user_id: row.manager_user_id,
          manager_display_name: row.manager_display_name,
          settings: row.settings,
          role_ids: [],
          role_names: [],
        };
        byMembership.set(row.id, entry);
      }
      if (row.role_id) entry.role_ids.push(row.role_id);
      if (row.role_name) entry.role_names.push(row.role_name);
    }
    return [...byMembership.values()];
  }

  /** Admin-only: (re)assign who a member's timesheet approvals route to, or stash free-form per-membership data. */
  @Patch(':id/members/:membershipId')
  async updateMember(
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Body() body: { managerUserId?: string | null; settings?: Record<string, unknown> },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(db, id, callerId))) return { ok: false, error: 'forbidden' };

    const [membership] = await db
      .select({ user_id: organization_memberships.user_id })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.id, membershipId), eq(organization_memberships.organization_id, id)));
    if (!membership) return { ok: false, error: 'membership-not-found' };

    const patch: Partial<typeof organization_memberships.$inferInsert> = {};
    if (body.managerUserId !== undefined) {
      if (body.managerUserId === membership.user_id) return { ok: false, error: 'cannot-be-own-manager' };
      if (body.managerUserId) {
        const [managerMembership] = await db
          .select({ id: organization_memberships.id })
          .from(organization_memberships)
          .where(and(eq(organization_memberships.organization_id, id), eq(organization_memberships.user_id, body.managerUserId)));
        if (!managerMembership) return { ok: false, error: 'manager-not-a-member' };
      }
      patch.manager_user_id = body.managerUserId;
    }
    if (body.settings !== undefined) patch.settings = body.settings;
    if (Object.keys(patch).length === 0) return { ok: true, noop: true };

    await db.update(organization_memberships).set(patch).where(eq(organization_memberships.id, membershipId));
    void this.audit.record(id, callerId, 'membership.update', 'membership', membershipId, patch).catch(() => {});
    void this.versions.record('organization_memberships', membershipId, 'update_delta', callerId, patch).catch(() => {});
    return { ok: true };
  }

  @Post(':id/members/:membershipId/roles')
  async grantRole(
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Body() body: { roleId: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!body.roleId) return { ok: false, error: 'role-id-required' };
    const [membership] = await db
      .select({ organization_id: organization_memberships.organization_id })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.id, membershipId), eq(organization_memberships.organization_id, id)));
    if (!membership) return { ok: false, error: 'membership-not-found' };
    const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, body.roleId));
    if (!role) return { ok: false, error: 'invalid-role' };
    // Only an org admin, or one of this specific role's designated admins, may hand this role out.
    if (!(await canManageRole(db, id, callerId, body.roleId))) return { ok: false, error: 'forbidden' };
    await db
      .update(organization_memberships)
      .set({
        role_ids: sql`CASE WHEN ${body.roleId}::uuid = ANY(${organization_memberships.role_ids}) THEN ${organization_memberships.role_ids} ELSE array_append(${organization_memberships.role_ids}, ${body.roleId}::uuid) END`,
      })
      .where(eq(organization_memberships.id, membershipId));
    void this.audit.record(id, callerId, 'role.grant', 'membership', membershipId, { roleId: body.roleId }).catch(() => {});
    return { ok: true };
  }

  @Delete(':id/members/:membershipId/roles/:roleId')
  async revokeRole(
    @Param('id') id: string,
    @Param('membershipId') membershipId: string,
    @Param('roleId') roleId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const [membership] = await db
      .select({ organization_id: organization_memberships.organization_id })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.id, membershipId), eq(organization_memberships.organization_id, id)));
    if (!membership) return { ok: false, error: 'membership-not-found' };
    if (!(await canManageRole(db, id, callerId, roleId))) return { ok: false, error: 'forbidden' };
    // A membership must always keep at least one role — revoke by removing the whole membership instead.
    const updated = await db
      .update(organization_memberships)
      .set({ role_ids: sql`array_remove(${organization_memberships.role_ids}, ${roleId}::uuid)` })
      .where(and(eq(organization_memberships.id, membershipId), sql`cardinality(${organization_memberships.role_ids}) > 1`))
      .returning({ id: organization_memberships.id });
    if (updated.length === 0) return { ok: false, error: 'last-role' };
    void this.audit.record(id, callerId, 'role.revoke', 'membership', membershipId, { roleId }).catch(() => {});
    return { ok: true };
  }

  @Post(':id/invite')
  async invite(
    @Param('id') id: string,
    @Body() body: { email: string; roleId: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const principal = req.user;
    if (!principal) return { ok: false, error: 'unauthenticated' };
    const callerId = await callerUserId(db, principal);
    if (!callerId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgMember(db, id, callerId))) return { ok: false, error: 'forbidden' };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
    const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, body.roleId));
    if (!role) return { ok: false, error: 'invalid-role' };
    // Only an org admin, or one of this specific role's designated admins, may onboard someone into it.
    if (!(await canManageRole(db, id, callerId, body.roleId))) return { ok: false, error: 'forbidden' };
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, id));
    if (!org) return { ok: false, error: 'unknown-organization' };
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const [inserted] = await db
      .insert(organization_invitations)
      .values({
        organization_id: id,
        email,
        role_id: body.roleId,
        token,
        invited_by_user_id: callerId,
        expires_at: expiresAt,
      })
      .returning({ id: organization_invitations.id });
    const mail = buildInviteEmail(org.name, token);
    // Best-effort invite mail (local catcher); the token is returned so it can be shared manually.
    void sendMail({ to: email, ...mail }).catch(() => {});
    void this.audit.record(id, callerId, 'invitation.send', 'organization_invitation', inserted.id, { email, roleId: body.roleId }).catch(() => {});
    void this.versions
      .record('organization_invitations', inserted.id, 'insert', callerId, { id: inserted.id, organization_id: id, email, role_id: body.roleId, token, expires_at: expiresAt })
      .catch(() => {});
    return { ok: true, token, id: inserted.id };
  }

  @Get(':id/invitations')
  async invitations(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgManagerOrAdmin(db, id, callerId))) return [];
    return db
      .select({
        id: organization_invitations.id,
        email: organization_invitations.email,
        status: organization_invitations.status,
        expires_at: organization_invitations.expires_at,
        role_name: roles.name,
        invited_by: users.display_name,
      })
      .from(organization_invitations)
      .innerJoin(roles, eq(roles.id, organization_invitations.role_id))
      .innerJoin(users, eq(users.id, organization_invitations.invited_by_user_id))
      .where(eq(organization_invitations.organization_id, id));
  }

  @Delete('invitations/:invitationId')
  async revokeInvitation(@Param('invitationId') invitationId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [invitation] = await db
      .select({ organization_id: organization_invitations.organization_id, status: organization_invitations.status })
      .from(organization_invitations)
      .where(eq(organization_invitations.id, invitationId));
    if (!invitation) return { ok: false, error: 'invitation-not-found' };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(db, invitation.organization_id, callerId))) {
      return { ok: false, error: 'forbidden' };
    }
    if (invitation.status !== 'pending') return { ok: false, error: 'invitation-not-pending' };
    await db
      .update(organization_invitations)
      .set({ status: 'revoked' })
      .where(eq(organization_invitations.id, invitationId));
    void this.audit
      .record(invitation.organization_id, callerId, 'invitation.revoke', 'organization_invitation', invitationId)
      .catch(() => {});
    void this.versions.record('organization_invitations', invitationId, 'update_delta', callerId, { status: 'revoked' }).catch(() => {});
    return { ok: true };
  }

  @Get(':id/domains')
  async domains(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgAdmin(db, id, callerId))) return [];
    return db
      .select({
        id: organization_domains.id,
        domain: organization_domains.domain,
        verified_at: organization_domains.verified_at,
        auto_join_enabled: organization_domains.auto_join_enabled,
      })
      .from(organization_domains)
      .where(eq(organization_domains.organization_id, id))
      .orderBy(asc(organization_domains.domain));
  }

  @Post(':id/domains')
  async upsertDomain(
    @Param('id') id: string,
    @Body() body: { domain: string; autoJoin: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(db, id, callerId))) return { ok: false, error: 'forbidden' };
    const domain = (body.domain ?? '').trim().toLowerCase();
    if (!domain) return { ok: false, error: 'domain-required' };
    const [row] = await db
      .insert(organization_domains)
      .values({
        organization_id: id,
        domain,
        verification_token: randomUUID(),
        auto_join_enabled: body.autoJoin ?? false,
      })
      .onConflictDoUpdate({
        target: organization_domains.domain,
        set: { auto_join_enabled: body.autoJoin ?? false },
      })
      .returning({ id: organization_domains.id });
    void this.audit
      .record(id, callerId, 'domain.upsert', 'organization_domain', domain, { autoJoin: body.autoJoin ?? false })
      .catch(() => {});
    void this.versions.record('organization_domains', row.id, 'update_delta', callerId, { domain, auto_join_enabled: body.autoJoin ?? false }).catch(() => {});
    return { ok: true };
  }

  @Get(':id/sso')
  async sso(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgAdmin(db, id, callerId))) return null;
    const [org] = await db.select({ sso_config: organizations.sso_config }).from(organizations).where(eq(organizations.id, id));
    const config = org?.sso_config as Record<string, unknown> | undefined;
    if (!config || !config.protocol) return null;
    return {
      protocol: config.protocol,
      idp_entity_id: config.idp_entity_id,
      idp_sso_url: config.idp_sso_url,
      is_active: config.is_active ?? false,
      updated_at: config.updated_at,
    };
  }

  @Post(':id/sso')
  async upsertSso(
    @Param('id') id: string,
    @Body() body: { protocol: string; idpEntityId: string; idpSsoUrl: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(db, id, callerId))) return { ok: false, error: 'forbidden' };
    if (!body.idpEntityId?.trim() || !body.idpSsoUrl?.trim()) return { ok: false, error: 'idp-fields-required' };
    const protocol = body.protocol;
    const idpEntityId = body.idpEntityId.trim();
    const idpSsoUrl = body.idpSsoUrl.trim();
    const ssoConfig = {
      protocol,
      idp_entity_id: idpEntityId,
      idp_sso_url: idpSsoUrl,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    await db.update(organizations).set({ sso_config: ssoConfig }).where(eq(organizations.id, id));
    void this.audit.record(id, callerId, 'sso.upsert', 'organization', id, { protocol, idpEntityId }).catch(() => {});
    void this.versions.record('organizations', id, 'update_delta', callerId, { sso_config: ssoConfig }).catch(() => {});
    return { ok: true };
  }
}
