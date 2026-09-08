import { Controller, Get, Query } from '@nestjs/common';
import { DbService } from './db.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@Query('orgId') orgId?: string) {
    const pool = this.db.getPool();
    if (!pool) return [];
    if (!orgId) return [];
    return (
      await pool.query('SELECT * FROM audit_logs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 200', [orgId])
    ).rows;
  }
}
