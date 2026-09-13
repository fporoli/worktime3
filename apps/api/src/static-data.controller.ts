import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DbService } from './db.service';
import { VersionsService } from './versions.service';
import { callerUserId, isOrgAdmin, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { static_data } from './db/schema';

@Controller('organizations/:orgId/static-data')
export class StaticDataController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
  ) {}

  /** All enum definitions for this organization, for the admin static-data screen. */
  @Get()
  async listAll(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];
    return db
      .select()
      .from(static_data)
      .where(eq(static_data.organization_id, orgId))
      .orderBy(asc(static_data.entity), asc(static_data.enum_name));
  }

  @Get(':category')
  async get(@Param('orgId') orgId: string, @Param('category') category: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];
    return db
      .select()
      .from(static_data)
      .where(and(eq(static_data.organization_id, orgId), eq(static_data.entity, category)))
      .orderBy(asc(static_data.enum_name));
  }

  @Post()
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { entity: string; entityUuid?: string; enumName: string; values: unknown; translation?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    if (!body.entity?.trim() || !body.enumName?.trim()) return { ok: false, error: 'entity-and-enum-name-required' };
    const values = {
      organization_id: orgId,
      entity: body.entity.trim(),
      entity_uuid: body.entityUuid ?? null,
      enum_name: body.enumName.trim(),
      values: body.values ?? {},
      translation: body.translation ?? {},
    };
    const [row] = await db.insert(static_data).values(values).returning({ id: static_data.id });
    void this.versions.record('static_data', row.id, 'insert', callerId, { id: row.id, ...values }).catch(() => {});
    return { ok: true, id: row.id };
  }

  @Patch(':id')
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: { enumName?: string; values?: unknown; translation?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(db, orgId, callerId))) return { ok: false, error: 'forbidden' };

    const patch: Partial<typeof static_data.$inferInsert> = {};
    if (body.enumName !== undefined) patch.enum_name = body.enumName.trim();
    if (body.values !== undefined) patch.values = body.values;
    if (body.translation !== undefined) patch.translation = body.translation;

    if (Object.keys(patch).length > 0) {
      // Scoped by organization_id too, so an org admin can't edit another org's row by guessing its id.
      await db.update(static_data).set(patch).where(and(eq(static_data.id, id), eq(static_data.organization_id, orgId)));
      void this.versions.record('static_data', id, 'update_delta', callerId, patch).catch(() => {});
    }
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgAdmin(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    await db.delete(static_data).where(and(eq(static_data.id, id), eq(static_data.organization_id, orgId)));
    void this.versions.record('static_data', id, 'delete', callerId, null).catch(() => {});
    return { ok: true };
  }
}
