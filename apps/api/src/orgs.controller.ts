import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, isOrgAdmin, isOrgManagerOrAdmin, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { sendMail } from './mailer';
import { isValidEmail } from './auth.controller';
import {
  organizations,
  organization_memberships,
  organization_invitations,
  organization_domains,
  sso_configurations,
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

const ORG_COLUMNS = {
  id: organizations.id,
  slug: organizations.slug,
  name: organizations.name,
  type: organizations.type,
  avatar_url: organizations.avatar_url,
  created_at: organizations.created_at,
};

@Controller('organizations')
export class OrgsController {
  constructor(private readonly db: DbService) {}

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, id, callerId))) return null;
    const [org] = await db.select(ORG_COLUMNS).from(organizations).where(eq(organizations.id, id));
    return org ?? null;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; avatarUrl?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(db, id, callerId))) return { ok: false, error: 'forbidden' };
    if (body.name !== undefined && !body.name.trim()) return { ok: false, error: 'name-required' };

    const patch: Partial<typeof organizations.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.avatarUrl !== undefined) patch.avatar_url = body.avatarUrl;
    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString();
      await db.update(organizations).set(patch).where(eq(organizations.id, id));
    }
    return { ok: true };
  }

  @Get(':id/members')
  async members(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, id, callerId))) return [];
    return db
      .select({
        id: organization_memberships.id,
        user_id: organization_memberships.user_id,
        role_id: organization_memberships.role_id,
        status: organization_memberships.status,
        email: users.email,
        display_name: users.display_name,
      })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(eq(organization_memberships.organization_id, id));
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
    // Admins and managers may both grow the organization's roster.
    if (!(await isOrgManagerOrAdmin(db, id, callerId))) return { ok: false, error: 'forbidden' };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
    const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, body.roleId));
    if (!role) return { ok: false, error: 'invalid-role' };
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
        created_at: organization_invitations.created_at,
        role_name: roles.name,
        invited_by: users.display_name,
      })
      .from(organization_invitations)
      .innerJoin(roles, eq(roles.id, organization_invitations.role_id))
      .innerJoin(users, eq(users.id, organization_invitations.invited_by_user_id))
      .where(eq(organization_invitations.organization_id, id))
      .orderBy(desc(organization_invitations.created_at));
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
        created_at: organization_domains.created_at,
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
    await db
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
      });
    return { ok: true };
  }

  @Get(':id/sso')
  async sso(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgAdmin(db, id, callerId))) return null;
    const [config] = await db
      .select({
        protocol: sso_configurations.protocol,
        idp_entity_id: sso_configurations.idp_entity_id,
        idp_sso_url: sso_configurations.idp_sso_url,
        is_active: sso_configurations.is_active,
        updated_at: sso_configurations.updated_at,
      })
      .from(sso_configurations)
      .where(eq(sso_configurations.organization_id, id));
    return config ?? null;
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
    const protocol = body.protocol as (typeof sso_configurations.$inferInsert)['protocol'];
    const idpEntityId = body.idpEntityId.trim();
    const idpSsoUrl = body.idpSsoUrl.trim();
    await db
      .insert(sso_configurations)
      .values({ organization_id: id, protocol, idp_entity_id: idpEntityId, idp_sso_url: idpSsoUrl })
      .onConflictDoUpdate({
        target: sso_configurations.organization_id,
        set: { protocol, idp_entity_id: idpEntityId, idp_sso_url: idpSsoUrl, updated_at: new Date().toISOString() },
      });
    return { ok: true };
  }
}
