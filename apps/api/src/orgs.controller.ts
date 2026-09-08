import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DbService } from './db.service';

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
  async invite(@Param('id') id: string, @Body() body: { email: string; roleId: string; invitedBy: string }) {
    const pool = this.db.getPool();
    if (!pool) return { ok: true, offline: true };
    const token = Math.random().toString(36).slice(2);
    await pool.query(
      "INSERT INTO organization_invitations (organization_id, email, role_id, token, invited_by_user_id, expires_at) VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '7 days')",
      [id, body.email, body.roleId, token, body.invitedBy],
    );
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
