import { Injectable } from '@nestjs/common';
import { DbService } from './db.service';
import { audit_logs } from './db/schema';

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async record(orgId: string, actorId: string | null, action: string, targetType: string, targetId: string, metadata: unknown = {}) {
    const db = this.db.getDb();
    if (!db) return;
    await db.insert(audit_logs).values({
      organization_id: orgId,
      actor_user_id: actorId,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
    });
  }
}
