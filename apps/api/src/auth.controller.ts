import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { Public, type AuthenticatedRequest } from './jwt.guard';
import { mintLocalToken } from './jwt';
import { sendMail } from './mailer';
import * as bcrypt from 'bcryptjs';
import { users, user_identities, organizations, organization_memberships, organization_invitations, roles, membership_roles } from './db/schema';
import { pickPrimaryRole } from './access';

/**
 * Auth: Keycloak is the IdP (same Postgres DB, `auth` schema).
 * - Self-onboarding creates the user row + password identity.
 * - Password reset updates the password identity (Keycloak mirrors via user federation/LDAP or API in prod).
 * - Azure link/unlink manages an `azure_oidc` user_identity row.
 * - Local login/register/invite-accept below power the web login screen (dev
 *   parity with Keycloak; production should validate Keycloak JWTs instead).
 */

export const OWNER_ROLE_ID = '00000000-0000-0000-0000-000000000001';
export const ADMIN_ROLE_ID = '00000000-0000-0000-0000-000000000002';

export function isValidEmail(email: unknown): boolean {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isValidPassword(password: unknown): boolean {
  return typeof password === 'string' && password.length >= 8;
}

/** Slug base for a workspace derived from an email local part. */
export function slugBase(email: string): string {
  return email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

interface SessionMembership {
  organizationId: string;
  slug: string;
  name: string;
  /** Highest-privilege role, for the existing single-role UI gates. */
  role: string;
  /** Every role this membership currently holds — a membership can carry more than one. */
  roles: string[];
  status: string;
}

interface Session {
  userId: string;
  email: string;
  displayName: string;
  /** Local API token (HS256). Keycloak SSO uses a Keycloak-issued token instead. */
  token: string;
  memberships: SessionMembership[];
}

async function membershipsOf(db: Db, userId: string): Promise<SessionMembership[]> {
  const rows = await db
    .select({
      organizationId: organization_memberships.organization_id,
      slug: organizations.slug,
      name: organizations.name,
      status: organization_memberships.status,
      roleName: roles.name,
    })
    .from(organization_memberships)
    .innerJoin(organizations, eq(organizations.id, organization_memberships.organization_id))
    .leftJoin(membership_roles, eq(membership_roles.membership_id, organization_memberships.id))
    .leftJoin(roles, eq(roles.id, membership_roles.role_id))
    .where(eq(organization_memberships.user_id, userId))
    .orderBy(asc(organizations.slug));

  const byOrg = new Map<string, SessionMembership>();
  for (const row of rows) {
    let entry = byOrg.get(row.organizationId);
    if (!entry) {
      entry = { organizationId: row.organizationId, slug: row.slug, name: row.name, role: '', roles: [], status: row.status };
      byOrg.set(row.organizationId, entry);
    }
    if (row.roleName) entry.roles.push(row.roleName);
  }
  for (const entry of byOrg.values()) {
    entry.role = pickPrimaryRole(entry.roles) ?? 'member';
  }
  return [...byOrg.values()];
}

@Controller('auth')
export class AuthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Post('onboard')
  async onboard(@Body() body: { email: string; displayName: string; passwordHash: string }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const [user] = await db
      .insert(users)
      .values({ email: body.email, display_name: body.displayName })
      .onConflictDoUpdate({ target: users.email, set: { display_name: body.displayName } })
      .returning({ id: users.id });
    await db
      .insert(user_identities)
      .values({ user_id: user.id, provider: 'password', provider_user_id: body.email, password_hash: body.passwordHash })
      .onConflictDoUpdate({
        target: [user_identities.provider, user_identities.provider_user_id],
        set: { password_hash: body.passwordHash },
      });
    return { ok: true, userId: user.id };
  }

  /** Register a new admin user: creates the user, a personal workspace org, and an owner membership. */
  @Public()
  @Post('register')
  async register(@Body() body: { email: string; displayName: string; password: string }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
    if (!body.displayName?.trim()) return { ok: false, error: 'display-name-required' };
    if (!isValidPassword(body.password)) return { ok: false, error: 'password-too-short' };
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) return { ok: false, error: 'email-taken' };
    const passwordHash = await bcrypt.hash(body.password, 10);
    const [user] = await db
      .insert(users)
      .values({ email, display_name: body.displayName.trim() })
      .returning({ id: users.id, email: users.email, display_name: users.display_name });
    const userId = user.id;
    await db
      .insert(user_identities)
      .values({ user_id: userId, provider: 'password', provider_user_id: email, password_hash: passwordHash });
    const base = slugBase(email) || 'workspace';
    let slug = base;
    for (let attempt = 0; attempt < 25; attempt++) {
      const [taken] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug));
      if (!taken) break;
      slug = `${base}-${attempt + 2}`;
    }
    const [org] = await db
      .insert(organizations)
      .values({ slug, name: `${body.displayName.trim()}'s workspace`, type: 'personal', created_by_user_id: userId })
      .returning({ id: organizations.id });
    const [membership] = await db
      .insert(organization_memberships)
      .values({ organization_id: org.id, user_id: userId, status: 'active' })
      .returning({ id: organization_memberships.id });
    await db.insert(membership_roles).values({ membership_id: membership.id, role_id: OWNER_ROLE_ID });
    const session: Session = {
      userId,
      email: user.email,
      displayName: user.display_name,
      token: await mintLocalToken(userId, email),
      memberships: await membershipsOf(db, userId),
    };
    // Best-effort welcome mail (local catcher); never fail registration over it.
    void sendMail({
      to: email,
      subject: 'Welcome to Worktime',
      text: `Hi ${body.displayName.trim()},\n\nYour account and personal workspace "${slug}" are ready.\n`,
    }).catch(() => {});
    return { ok: true, ...session };
  }

  /** Local login: verifies the password identity and returns the session. */
  @Public()
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email) || typeof body.password !== 'string') return { ok: false, error: 'invalid-credentials' };
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        display_name: users.display_name,
        status: users.status,
        password_hash: user_identities.password_hash,
      })
      .from(users)
      .innerJoin(user_identities, and(eq(user_identities.user_id, users.id), eq(user_identities.provider, 'password')))
      .where(eq(users.email, email));
    if (!row) return { ok: false, error: 'invalid-credentials' };
    if (row.status !== 'active') return { ok: false, error: 'account-inactive' };
    const match = row.password_hash ? await bcrypt.compare(body.password, row.password_hash) : false;
    if (!match) return { ok: false, error: 'invalid-credentials' };
    await db
      .update(user_identities)
      .set({ last_sign_in_at: new Date().toISOString() })
      .where(and(eq(user_identities.provider, 'password'), eq(user_identities.provider_user_id, email)));
    const session: Session = {
      userId: row.id,
      email: row.email,
      displayName: row.display_name,
      token: await mintLocalToken(row.id, row.email),
      memberships: await membershipsOf(db, row.id),
    };
    return { ok: true, ...session };
  }

  /** Reset a local password (server-side hashing). Always returns ok to avoid account enumeration. */
  @Public()
  @Post('reset')
  async resetLocal(@Body() body: { email: string; newPassword: string }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const email = (body.email ?? '').trim().toLowerCase();
    if (isValidEmail(email) && isValidPassword(body.newPassword)) {
      const passwordHash = await bcrypt.hash(body.newPassword, 10);
      await db
        .update(user_identities)
        .set({ password_hash: passwordHash })
        .where(and(eq(user_identities.provider, 'password'), eq(user_identities.provider_user_id, email)));
    }
    return { ok: true };
  }

  /**
   * Accept an organization invitation: attaches the invited email to the org
   * with the invited role and sets the local password.
   */
  @Public()
  @Post('invitations/accept')
  async acceptInvitation(@Body() body: { token: string; displayName: string; password: string }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const token = (body.token ?? '').trim();
    if (!token) return { ok: false, error: 'token-required' };
    if (!body.displayName?.trim()) return { ok: false, error: 'display-name-required' };
    if (!isValidPassword(body.password)) return { ok: false, error: 'password-too-short' };
    const [invitation] = await db
      .select({
        organization_id: organization_invitations.organization_id,
        email: organization_invitations.email,
        role_id: organization_invitations.role_id,
        status: organization_invitations.status,
        expires_at: organization_invitations.expires_at,
      })
      .from(organization_invitations)
      .where(eq(organization_invitations.token, token));
    if (!invitation) return { ok: false, error: 'invalid-token' };
    if (invitation.status !== 'pending') return { ok: false, error: 'invitation-not-pending' };
    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      await db.update(organization_invitations).set({ status: 'expired' }).where(eq(organization_invitations.token, token));
      return { ok: false, error: 'invitation-expired' };
    }
    const email = invitation.email.toLowerCase();
    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    let userId: string;
    if (!existingUser) {
      const [created] = await db
        .insert(users)
        .values({ email, display_name: body.displayName.trim() })
        .returning({ id: users.id });
      userId = created.id;
    } else {
      userId = existingUser.id;
    }
    const passwordHash = await bcrypt.hash(body.password, 10);
    await db
      .insert(user_identities)
      .values({ user_id: userId, provider: 'password', provider_user_id: email, password_hash: passwordHash })
      .onConflictDoUpdate({
        target: [user_identities.provider, user_identities.provider_user_id],
        set: { password_hash: passwordHash },
      });
    const [membership] = await db
      .insert(organization_memberships)
      .values({ organization_id: invitation.organization_id, user_id: userId, status: 'active' })
      .onConflictDoUpdate({
        target: [organization_memberships.organization_id, organization_memberships.user_id],
        set: { status: 'active' },
      })
      .returning({ id: organization_memberships.id });
    await db
      .insert(membership_roles)
      .values({ membership_id: membership.id, role_id: invitation.role_id })
      .onConflictDoNothing();
    await db.update(organization_invitations).set({ status: 'accepted' }).where(eq(organization_invitations.token, token));
    const session: Session = {
      userId,
      email,
      displayName: body.displayName.trim(),
      token: await mintLocalToken(userId, email),
      memberships: await membershipsOf(db, userId),
    };
    return { ok: true, ...session };
  }

  /**
   * SSO sync: upserts the caller from their validated token (Keycloak `sub`
   * -> `oidc` identity, or the local user id) and returns the session.
   * The web app calls this right after the Keycloak redirect; the session
   * keeps the Keycloak access token for subsequent API calls.
   */
  @Post('sso/sync')
  async ssoSync(@Req() req: AuthenticatedRequest, @Body() body: { email?: string; displayName?: string }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const principal = req.user;
    if (!principal) return { ok: false, error: 'unauthenticated' };
    const userId: string =
      principal.kind === 'local' ? principal.sub : await this.resolveSsoUserId(db, principal, body);
    const [user] = await db
      .select({ id: users.id, email: users.email, display_name: users.display_name })
      .from(users)
      .where(eq(users.id, userId));
    const session = {
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      memberships: await membershipsOf(db, userId),
    };
    return { ok: true, ...session };
  }

  private async resolveSsoUserId(
    db: Db,
    principal: { sub: string; email?: string },
    body: { email?: string; displayName?: string },
  ): Promise<string> {
    const [found] = await db
      .select({ user_id: user_identities.user_id })
      .from(user_identities)
      .where(eq(user_identities.provider_user_id, principal.sub))
      .limit(1);
    if (found) return found.user_id;
    const email = (body.email ?? principal.email ?? `${principal.sub}@sso.local`).toLowerCase();
    const [created] = await db
      .insert(users)
      .values({ email, display_name: body.displayName ?? principal.email ?? 'SSO user' })
      .onConflictDoUpdate({ target: users.email, set: { email } })
      .returning({ id: users.id });
    const userId = created.id;
    await db
      .insert(user_identities)
      .values({ user_id: userId, provider: 'oidc', provider_user_id: principal.sub })
      .onConflictDoNothing();
    return userId;
  }

  @Public()
  @Post('reset-password')
  async reset(@Body() body: { email: string; newPasswordHash: string }) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    await db
      .update(user_identities)
      .set({ password_hash: body.newPasswordHash })
      .where(and(eq(user_identities.provider, 'password'), eq(user_identities.provider_user_id, body.email)));
    return { ok: true };
  }

  @Post('azure/link')
  linkAzure(@Body() body: { userId: string; azureId: string }) {
    return this.setAzure(body.userId, body.azureId, true);
  }

  @Delete('azure/link/:userId')
  unlinkAzure(@Param('userId') userId: string) {
    return this.setAzure(userId, '', false);
  }

  private async setAzure(userId: string, azureId: string, link: boolean) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    if (link) {
      await db
        .insert(user_identities)
        .values({ user_id: userId, provider: 'oidc', provider_user_id: azureId })
        .onConflictDoNothing();
    } else {
      await db
        .delete(user_identities)
        .where(and(eq(user_identities.user_id, userId), eq(user_identities.provider, 'oidc')));
    }
    return { ok: true };
  }

  @Public()
  @Get('azure/providers')
  providers() {
    return [{ type: 'azure_oidc', tenantHint: process.env.AZURE_TENANT_ID ?? null }];
  }
}
