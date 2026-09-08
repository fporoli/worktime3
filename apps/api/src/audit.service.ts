import { Injectable } from '@nestjs/common';
import { DbService } from './db.service';

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async record(orgId: string, actorId: string | null, action: string, targetType: string, targetId: string, metadata: unknown = {}) {
    const pool = this.db.getPool();
    if (!pool) return;
    await pool.query(
      'INSERT INTO audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata) VALUES ($1,$2,$3,$4,$5,$6)',
      [orgId, actorId, action, targetType, targetId, JSON.stringify(metadata)],
    );
  }
}
