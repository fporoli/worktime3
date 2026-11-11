import { Controller, Get, Param, Req } from '@nestjs/common';
import { DbService } from './db.service';
import { callerUserId, permissionIdsOf } from './access';
import type { AuthenticatedRequest } from './jwt.guard';

@Controller('organizations/:orgId/me')
export class PermissionsController {
  constructor(private readonly db: DbService) {}

  /**
   * The caller's permission ids in this organization (`<object>:<action>:<scope>`, see
   * packages/shared/src/permissions.ts). The web app shows a navbar entry when one of them
   * names its object. Empty for non-members; `offline` without a database.
   */
  @Get('permissions')
  async mine(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, permissions: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: true, permissions: [] };
    return { ok: true, permissions: [...(await permissionIdsOf(db, orgId, callerId))].sort() };
  }
}
