import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from './db.service';
import { callerUserId, isOrgAdmin, isOrgManagerOrAdmin } from './access';
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

  @Get(':id')
  async get(@Param('id') id: string) {
    const pool = this.db.getPool();
    if (!pool) return null;
    const r = await pool.query(
      'SELECT id, slug, name, type, avatar_url, created_at FROM organizations WHERE id = $1',
      [id],
    );
    return r.rows[0] ?? null;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; avatarUrl?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(pool, id, callerId))) return { ok: false, error: 'forbidden' };
    if (body.name !== undefined && !body.name.trim()) return { ok: false, error: 'name-required' };
    const sets: string[] = [];
    const args: unknown[] = [id];
    if (body.name !== undefined) {
      args.push(body.name.trim());
      sets.push(`name = $${args.length}`);
    }
    if (body.avatarUrl !== undefined) {
      args.push(body.avatarUrl);
      sets.push(`avatar_url = $${args.length}`);
    }
    if (sets.length > 0) {
      await pool.query(`UPDATE organizations SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, args);
    }
    return { ok: true };
  }

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
    // Admins and managers may both grow the organization's roster.
    if (!(await isOrgManagerOrAdmin(pool, id, callerId))) return { ok: false, error: 'forbidden' };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
    const role = await pool.query('SELECT id FROM roles WHERE id = $1', [body.roleId]);
    if (role.rows.length === 0) return { ok: false, error: 'invalid-role' };
    const org = await pool.query('SELECT name FROM organizations WHERE id = $1', [id]);
    if (org.rows.length === 0) return { ok: false, error: 'unknown-organization' };
    const token = randomUUID();
    const inserted = await pool.query(
      "INSERT INTO organization_invitations (organization_id, email, role_id, token, invited_by_user_id, expires_at) VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '7 days') RETURNING id",
      [id, email, body.roleId, token, callerId],
    );
    const mail = buildInviteEmail(org.rows[0].name as string, token);
    // Best-effort invite mail (local catcher); the token is returned so it can be shared manually.
    void sendMail({ to: email, ...mail }).catch(() => {});
    return { ok: true, token, id: inserted.rows[0].id };
  }

  @Get(':id/invitations')
  async invitations(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return [];
    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId || !(await isOrgManagerOrAdmin(pool, id, callerId))) return [];
    const r = await pool.query(
      `SELECT i.id, i.email, i.status, i.expires_at, i.created_at, r.name AS role_name, u.display_name AS invited_by
       FROM organization_invitations i
       JOIN roles r ON r.id = i.role_id
       JOIN users u ON u.id = i.invited_by_user_id
       WHERE i.organization_id = $1
       ORDER BY i.created_at DESC`,
      [id],
    );
    return r.rows;
  }

  @Delete('invitations/:invitationId')
  async revokeInvitation(@Param('invitationId') invitationId: string, @Req() req: AuthenticatedRequest) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const inv = await pool.query('SELECT organization_id, status FROM organization_invitations WHERE id = $1', [
      invitationId,
    ]);
    if (inv.rows.length === 0) return { ok: false, error: 'invitation-not-found' };
    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgManagerOrAdmin(pool, inv.rows[0].organization_id as string, callerId))) {
      return { ok: false, error: 'forbidden' };
    }
    if (inv.rows[0].status !== 'pending') return { ok: false, error: 'invitation-not-pending' };
    await pool.query("UPDATE organization_invitations SET status='revoked' WHERE id = $1", [invitationId]);
    return { ok: true };
  }

  @Get(':id/domains')
  async domains(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const pool = this.db.getPool();
    if (!pool) return [];
    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId || !(await isOrgAdmin(pool, id, callerId))) return [];
    const r = await pool.query(
      'SELECT id, domain, verified_at, auto_join_enabled, created_at FROM organization_domains WHERE organization_id = $1 ORDER BY domain',
      [id],
    );
    return r.rows;
  }

  @Post(':id/domains')
  async upsertDomain(
    @Param('id') id: string,
    @Body() body: { domain: string; autoJoin: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(pool, id, callerId))) return { ok: false, error: 'forbidden' };
    const domain = (body.domain ?? '').trim().toLowerCase();
    if (!domain) return { ok: false, error: 'domain-required' };
    await pool.query(
      'INSERT INTO organization_domains (organization_id, domain, verification_token, auto_join_enabled) VALUES ($1,$2,$3,$4) ON CONFLICT (domain) DO UPDATE SET auto_join_enabled=EXCLUDED.auto_join_enabled',
      [id, domain, randomUUID(), body.autoJoin ?? false],
    );
    return { ok: true };
  }

  @Get(':id/sso')
  async sso(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const pool = this.db.getPool();
    if (!pool) return null;
    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId || !(await isOrgAdmin(pool, id, callerId))) return null;
    const r = await pool.query(
      'SELECT protocol, idp_entity_id, idp_sso_url, is_active, updated_at FROM sso_configurations WHERE organization_id = $1',
      [id],
    );
    return r.rows[0] ?? null;
  }

  @Post(':id/sso')
  async upsertSso(
    @Param('id') id: string,
    @Body() body: { protocol: string; idpEntityId: string; idpSsoUrl: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(pool, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(pool, id, callerId))) return { ok: false, error: 'forbidden' };
    if (!body.idpEntityId?.trim() || !body.idpSsoUrl?.trim()) return { ok: false, error: 'idp-fields-required' };
    await pool.query(
      'INSERT INTO sso_configurations (organization_id, protocol, idp_entity_id, idp_sso_url) VALUES ($1,$2,$3,$4) ON CONFLICT (organization_id) DO UPDATE SET protocol=EXCLUDED.protocol, idp_entity_id=EXCLUDED.idp_entity_id, idp_sso_url=EXCLUDED.idp_sso_url, updated_at=NOW()',
      [id, body.protocol, body.idpEntityId.trim(), body.idpSsoUrl.trim()],
    );
    return { ok: true };
  }
}
