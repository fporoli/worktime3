import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { DbService } from './db.service';

/**
 * Auth: Keycloak is the IdP (same Postgres DB, `auth` schema).
 * - Self-onboarding creates the user row + password identity.
 * - Password reset updates the password identity (Keycloak mirrors via user federation/LDAP or API in prod).
 * - Azure link/unlink manages an `azure_oidc` user_identity row.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly db: DbService) {}

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

  @Get('azure/providers')
  providers() {
    return [{ type: 'azure_oidc', tenantHint: process.env.AZURE_TENANT_ID ?? null }];
  }
}
