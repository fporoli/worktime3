import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class DbService {
  pool: Pool | null = null;

  getPool(): Pool | null {
    if (this.pool) return this.pool;
    if (!process.env.DATABASE_URL) return null;
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return this.pool;
  }
}
