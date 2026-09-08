import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { DbService } from './db.service';
import { Public, type AuthenticatedRequest } from './jwt.guard';
import { mintLocalToken } from './jwt';
import { sendMail } from './mailer';
import * as bcrypt from 'bcryptjs';

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
  role: string;
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

async function membershipsOf(pool: any, userId: string): Promise<SessionMembership[]> {
  const rows = await pool.query(
    `SELECT m.organization_id AS "organizationId", o.slug, o.name, r.name AS role, m.status
     FROM organization_memberships m
     JOIN organizations o ON o.id = m.organization_id
     JOIN roles r ON r.id = m.role_id
     WHERE m.user_id = $1
     ORDER BY o.slug`,
    [userId],
  );
  return rows.rows;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Post('onboard')
  async onboard(@Body() body: { email: string; displayName: string; passwordHash: string }) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const user = await pool.query(
      "INSERT INTO users (email, display_name) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id",
      [body.email, body.displayName],
    );
    await pool.query(
      "INSERT INTO user_identities (user_id, provider, provider_user_id, password_hash) VALUES ($1,'password',$2,$3) ON CONFLICT (provider, provider_user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash",
      [user.rows[0].id, body.email, body.passwordHash],
    );
    return { ok: true, userId: user.rows[0].id };
  }

  /** Register a new admin user: creates the user, a personal workspace org, and an owner membership. */
  @Public()
  @Post('register')
  async register(@Body() body: { email: string; displayName: string; password: string }) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
    if (!body.displayName?.trim()) return { ok: false, error: 'display-name-required' };
    if (!isValidPassword(body.password)) return { ok: false, error: 'password-too-short' };
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return { ok: false, error: 'email-taken' };
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await pool.query('INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id, email, display_name', [
      email,
      body.displayName.trim(),
    ]);
    const userId = user.rows[0].id;
    await pool.query(
      "INSERT INTO user_identities (user_id, provider, provider_user_id, password_hash) VALUES ($1,'password',$2,$3)",
      [userId, email, passwordHash],
    );
    const base = slugBase(email) || 'workspace';
    let slug = base;
    for (let attempt = 0; attempt < 25; attempt++) {
      const taken = await pool.query('SELECT id FROM organizations WHERE slug = $1', [slug]);
      if (taken.rows.length === 0) break;
      slug = `${base}-${attempt + 2}`;
    }
    const org = await pool.query(
      "INSERT INTO organizations (slug, name, type, created_by_user_id) VALUES ($1,$2,'personal',$3) RETURNING id",
      [slug, `${body.displayName.trim()}'s workspace`, userId],
    );
    await pool.query(
      "INSERT INTO organization_memberships (organization_id, user_id, role_id, status) VALUES ($1,$2,$3,'active')",
      [org.rows[0].id, userId, OWNER_ROLE_ID],
    );
    const session: Session = {
      userId,
      email: user.rows[0].email,
      displayName: user.rows[0].display_name,
      token: await mintLocalToken(userId, email),
      memberships: await membershipsOf(pool, userId),
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
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email) || typeof body.password !== 'string') return { ok: false, error: 'invalid-credentials' };
    const rows = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.status, i.password_hash
       FROM users u
       JOIN user_identities i ON i.user_id = u.id
       WHERE u.email = $1 AND i.provider = 'password'`,
      [email],
    );
    if (rows.rows.length === 0) return { ok: false, error: 'invalid-credentials' };
    const row = rows.rows[0];
    if (row.status !== 'active') return { ok: false, error: 'account-inactive' };
    const match = row.password_hash ? await bcrypt.compare(body.password, row.password_hash) : false;
    if (!match) return { ok: false, error: 'invalid-credentials' };
    await pool.query('UPDATE user_identities SET last_sign_in_at = NOW() WHERE provider = $1 AND provider_user_id = $2', [
      'password',
      email,
    ]);
    const session: Session = {
      userId: row.id,
      email: row.email,
      displayName: row.display_name,
      token: await mintLocalToken(row.id, row.email),
      memberships: await membershipsOf(pool, row.id),
    };
    return { ok: true, ...session };
  }

  /** Reset a local password (server-side hashing). Always returns ok to avoid account enumeration. */
  @Public()
  @Post('reset')
  async resetLocal(@Body() body: { email: string; newPassword: string }) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const email = (body.email ?? '').trim().toLowerCase();
    if (isValidEmail(email) && isValidPassword(body.newPassword)) {
      const passwordHash = await bcrypt.hash(body.newPassword, 10);
      await pool.query('UPDATE user_identities SET password_hash=$1 WHERE provider=$2 AND provider_user_id=$3', [
        passwordHash,
        'password',
        email,
      ]);
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
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const token = (body.token ?? '').trim();
    if (!token) return { ok: false, error: 'token-required' };
    if (!body.displayName?.trim()) return { ok: false, error: 'display-name-required' };
    if (!isValidPassword(body.password)) return { ok: false, error: 'password-too-short' };
    const inv = await pool.query(
      `SELECT organization_id, email, role_id, status, expires_at FROM organization_invitations WHERE token = $1`,
      [token],
    );
    if (inv.rows.length === 0) return { ok: false, error: 'invalid-token' };
    const invitation = inv.rows[0];
    if (invitation.status !== 'pending') return { ok: false, error: 'invitation-not-pending' };
    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      await pool.query("UPDATE organization_invitations SET status='expired' WHERE token = $1", [token]);
      return { ok: false, error: 'invitation-expired' };
    }
    const email = String(invitation.email).toLowerCase();
    let user = await pool.query('SELECT id, email, display_name FROM users WHERE email = $1', [email]);
    let userId: string;
    if (user.rows.length === 0) {
      const created = await pool.query('INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id', [
        email,
        body.displayName.trim(),
      ]);
      userId = created.rows[0].id;
    } else {
      userId = user.rows[0].id;
    }
    const passwordHash = await bcrypt.hash(body.password, 10);
    await pool.query(
      "INSERT INTO user_identities (user_id, provider, provider_user_id, password_hash) VALUES ($1,'password',$2,$3) ON CONFLICT (provider, provider_user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash",
      [userId, email, passwordHash],
    );
    await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role_id, status) VALUES ($1,$2,$3,'active')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role_id=EXCLUDED.role_id, status='active'`,
      [invitation.organization_id, userId, invitation.role_id],
    );
    await pool.query("UPDATE organization_invitations SET status='accepted' WHERE token = $1", [token]);
    const session: Session = {
      userId,
      email,
      displayName: body.displayName.trim(),
      token: await mintLocalToken(userId, email),
      memberships: await membershipsOf(pool, userId),
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
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const principal = req.user;
    if (!principal) return { ok: false, error: 'unauthenticated' };
    const userId: string =
      principal.kind === 'local' ? principal.sub : await this.resolveSsoUserId(pool, principal, body);
    const user = await pool.query('SELECT id, email, display_name FROM users WHERE id = $1', [userId]);
    const session = {
      userId: user.rows[0].id,
      email: user.rows[0].email,
      displayName: user.rows[0].display_name,
      memberships: await membershipsOf(pool, userId),
    };
    return { ok: true, ...session };
  }

  private async resolveSsoUserId(
    pool: any,
    principal: { sub: string; email?: string },
    body: { email?: string; displayName?: string },
  ): Promise<string> {
    const found = await pool.query('SELECT user_id FROM user_identities WHERE provider_user_id = $1 LIMIT 1', [
      principal.sub,
    ]);
    if (found.rows.length > 0) return found.rows[0].user_id as string;
    const email = (body.email ?? principal.email ?? `${principal.sub}@sso.local`).toLowerCase();
    const created = await pool.query(
      'INSERT INTO users (email, display_name) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id',
      [email, body.displayName ?? principal.email ?? 'SSO user'],
    );
    const userId = created.rows[0].id as string;
    await pool.query(
      "INSERT INTO user_identities (user_id, provider, provider_user_id) VALUES ($1,'oidc',$2) ON CONFLICT DO NOTHING",
      [userId, principal.sub],
    );
    return userId;
  }

  @Public()
  @Post('reset-password')
  async reset(@Body() body: { email: string; newPasswordHash: string }) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    await pool.query("UPDATE user_identities SET password_hash=$2 WHERE provider='password' AND provider_user_id=$1", [
      body.email,
      body.newPasswordHash,
    ]);
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
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    if (link) {
      await pool.query(
        "INSERT INTO user_identities (user_id, provider, provider_user_id) VALUES ($1,'oidc',$2) ON CONFLICT DO NOTHING",
        [userId, azureId],
      );
    } else {
      await pool.query("DELETE FROM user_identities WHERE user_id=$1 AND provider='oidc'", [userId]);
    }
    return { ok: true };
  }

  @Public()
  @Get('azure/providers')
  providers() {
    return [{ type: 'azure_oidc', tenantHint: process.env.AZURE_TENANT_ID ?? null }];
  }
}
