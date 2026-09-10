import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './db/schema';

export type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class DbService {
  pool: Pool | null = null;
  private db: Db | null = null;

  /** Raw pool escape hatch — prefer getDb() for anything new. */
  getPool(): Pool | null {
    if (this.pool) return this.pool;
    if (!process.env.DATABASE_URL) return null;
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return this.pool;
  }

  /** Typed Drizzle client. Returns null when DATABASE_URL isn't set (offline demo mode). */
  getDb(): Db | null {
    if (this.db) return this.db;
    const pool = this.getPool();
    if (!pool) return null;
    this.db = drizzle(pool, { schema });
    return this.db;
  }
}
