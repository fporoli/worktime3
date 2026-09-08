import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from './db.service';
import { callerUserId, isOrgAdmin } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { sendMail } from './mailer';
import { isValidEmail } from './auth.controller';

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

@Controller('organizations')
export class OrgsController {
  constructor(private readonly db: DbService) {}

  @Get(':id/members')
  async members(@Param('id') id: string) {
    const pool = this.db.getPool();
    if (!pool) return [];
    const r = await pool.query(
      'SELECT m.id, m.user_id, m.role_id, m.status, u.email, u.display_name FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1',
      [id],
    );
    return r.rows;
  }

  @Post(':id/invite')
  async invite(
    @Param('id') id: string,
    @Body() body: { email: string; roleId: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const principal = req.user;
    if (!principal) return { ok: false, error: 'unauthenticated' };
    const callerId = await callerUserId(pool, principal);
    if (!callerId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgAdmin(pool, id, callerId))) return { ok: false, error: 'forbidden' };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
    const role = await pool.query('SELECT id FROM roles WHERE id = $1', [body.roleId]);
    if (role.rows.length === 0) return { ok: false, error: 'invalid-role' };
    const org = await pool.query('SELECT name FROM organizations WHERE id = $1', [id]);
    if (org.rows.length === 0) return { ok: false, error: 'unknown-organization' };
    const token = randomUUID();
    await pool.query(
      "INSERT INTO organization_invitations (organization_id, email, role_id, token, invited_by_user_id, expires_at) VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '7 days')",
      [id, email, body.roleId, token, callerId],
    );
    const mail = buildInviteEmail(org.rows[0].name as string, token);
    // Best-effort invite mail (local catcher); the token is returned so it can be shared manually.
    void sendMail({ to: email, ...mail }).catch(() => {});
    return { ok: true, token };
  }

  @Post(':id/domains')
  async upsertDomain(@Param('id') id: string, @Body() body: { domain: string; autoJoin: boolean }) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    await pool.query(
      'INSERT INTO organization_domains (organization_id, domain, verification_token, auto_join_enabled) VALUES ($1,$2,$3,$4) ON CONFLICT (domain) DO UPDATE SET auto_join_enabled=EXCLUDED.auto_join_enabled',
      [id, body.domain, Math.random().toString(36).slice(2), body.autoJoin ?? false],
    );
    return { ok: true };
  }

  @Post(':id/sso')
  async upsertSso(@Param('id') id: string, @Body() body: { protocol: string; idpEntityId: string; idpSsoUrl: string }) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    await pool.query(
      'INSERT INTO sso_configurations (organization_id, protocol, idp_entity_id, idp_sso_url) VALUES ($1,$2,$3,$4) ON CONFLICT (organization_id) DO UPDATE SET protocol=EXCLUDED.protocol, idp_entity_id=EXCLUDED.idp_entity_id, idp_sso_url=EXCLUDED.idp_sso_url',
      [id, body.protocol, body.idpEntityId, body.idpSsoUrl],
    );
    return { ok: true };
  }
}
