import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, isAnyOrgAdmin } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { static_data } from './db/schema';

@Controller('static-data')
export class StaticDataController {
  constructor(private readonly db: DbService) {}

  /** All enum definitions across every entity, for the admin static-data screen. */
  @Get()
  async listAll() {
    const db = this.db.getDb();
    if (!db) return [];
    return db.select().from(static_data).orderBy(asc(static_data.entity), asc(static_data.enum_name));
  }

  @Get(':category')
  async get(@Param('category') category: string) {
    const db = this.db.getDb();
    if (!db) return [];
    return db
      .select()
      .from(static_data)
      .where(eq(static_data.entity, category))
      .orderBy(asc(static_data.enum_name));
  }

  @Post()
  async create(
    @Body() body: { entity: string; entityUuid?: string; enumName: string; values: unknown; translation?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isAnyOrgAdmin(db, callerId))) return { ok: false, error: 'forbidden' };
    if (!body.entity?.trim() || !body.enumName?.trim()) return { ok: false, error: 'entity-and-enum-name-required' };
    const [row] = await db
      .insert(static_data)
      .values({
        entity: body.entity.trim(),
        entity_uuid: body.entityUuid ?? null,
        enum_name: body.enumName.trim(),
        values: body.values ?? {},
        translation: body.translation ?? {},
      })
      .returning({ id: static_data.id });
    return { ok: true, id: row.id };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { enumName?: string; values?: unknown; translation?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isAnyOrgAdmin(db, callerId))) return { ok: false, error: 'forbidden' };

    const patch: Partial<typeof static_data.$inferInsert> = {};
    if (body.enumName !== undefined) patch.enum_name = body.enumName.trim();
    if (body.values !== undefined) patch.values = body.values;
    if (body.translation !== undefined) patch.translation = body.translation;

    if (Object.keys(patch).length > 0) {
      await db.update(static_data).set(patch).where(eq(static_data.id, id));
    }
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isAnyOrgAdmin(db, callerId))) return { ok: false, error: 'forbidden' };
    await db.delete(static_data).where(eq(static_data.id, id));
    return { ok: true };
  }
}
