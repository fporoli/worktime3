import { Controller, Get, Query, Req } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, isOrgAdmin } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { audit_logs } from './db/schema';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@Query('orgId') orgId: string | undefined, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    if (!orgId) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgAdmin(db, orgId, callerId))) return [];
    return db
      .select()
      .from(audit_logs)
      .where(eq(audit_logs.organization_id, orgId))
      .orderBy(desc(audit_logs.created_at))
      .limit(200);
  }
}
