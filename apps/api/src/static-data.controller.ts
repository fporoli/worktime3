import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { DbService } from './db.service';
import { VersionsService } from './versions.service';
import { callerUserId, isOrgAdmin, isOrgMember, isSuperDeveloper } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { static_data } from './db/schema';

export interface StaticDataRowLike {
  organization_id: string | null;
  entity: string;
  enum_name: string;
}

/**
 * Collapses global (`organization_id === null`) and organization-specific rows per
 * `(entity, enum_name)`: an org row overrides any global row with the same key pair.
 */
export function resolveEffectiveStaticData<T extends StaticDataRowLike>(rows: T[], orgId: string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.entity}\0${row.enum_name}`;
    const existing = byKey.get(key);
    if (!existing || (row.organization_id === orgId && existing.organization_id !== orgId)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === '23505' || e.cause?.code === '23505';
}

@Controller('organizations/:orgId/static-data')
export class StaticDataController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
  ) {}

  /** All enum definitions visible in this org (org-specific + global `organization_id IS NULL`), for Admin Settings. */
  @Get()
  async listAll(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || (!(await isOrgMember(db, orgId, callerId)) && !(await isSuperDeveloper(db, callerId)))) return [];
    return db
      .select()
      .from(static_data)
      .where(or(eq(static_data.organization_id, orgId), isNull(static_data.organization_id)))
      .orderBy(asc(static_data.entity), asc(static_data.enum_name), asc(static_data.organization_id));
  }

  /** Whether the caller may create/edit/delete global (`organization_id = null`) static data rows. */
  @Get('global-access')
  async globalAccess(@Param('orgId') _orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, canEditGlobal: false };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: true, canEditGlobal: false };
    return { ok: true, canEditGlobal: await isSuperDeveloper(db, callerId) };
  }

  /** Effective enums for a given entity category, resolving org overrides over global rows. */
  @Get(':category')
  async get(@Param('orgId') orgId: string, @Param('category') category: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || (!(await isOrgMember(db, orgId, callerId)) && !(await isSuperDeveloper(db, callerId)))) return [];
    const rows = await db
      .select()
      .from(static_data)
      .where(
        and(
          or(eq(static_data.organization_id, orgId), isNull(static_data.organization_id)),
          eq(static_data.entity, category),
        ),
      )
      .orderBy(asc(static_data.enum_name));
    return resolveEffectiveStaticData(rows, orgId);
  }

  @Post()
  async create(
    @Param('orgId') orgId: string,
    @Body()
    body: {
      scope?: 'org' | 'global';
      entity: string;
      entityUuid?: string;
      enumName: string;
      values: unknown;
      translation?: unknown;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const isGlobal = body.scope === 'global';
    const allowed = isGlobal ? await isSuperDeveloper(db, callerId) : await isOrgAdmin(db, orgId, callerId);
    if (!allowed) return { ok: false, error: 'forbidden' };

    if (!body.entity?.trim() || !body.enumName?.trim()) return { ok: false, error: 'entity-and-enum-name-required' };
    const values = {
      organization_id: isGlobal ? null : orgId,
      entity: body.entity.trim(),
      entity_uuid: body.entityUuid ?? null,
      enum_name: body.enumName.trim(),
      values: body.values ?? {},
      translation: body.translation ?? {},
    };
    try {
      const [row] = await db.insert(static_data).values(values).returning({ id: static_data.id });
      void this.versions.record('static_data', row.id, 'insert', callerId, { id: row.id, ...values }).catch(() => {});
      return { ok: true, id: row.id };
    } catch (err) {
      if (isUniqueViolation(err)) return { ok: false, error: 'duplicate-enum' };
      throw err;
    }
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

    const [existing] = await db
      .select({ id: static_data.id, organization_id: static_data.organization_id })
      .from(static_data)
      .where(eq(static_data.id, id));
    if (!existing) return { ok: false, error: 'not-found' };

    const isGlobal = existing.organization_id === null;
    const allowed = isGlobal
      ? await isSuperDeveloper(db, callerId)
      : existing.organization_id === orgId && (await isOrgAdmin(db, orgId, callerId));
    if (!allowed) return { ok: false, error: 'forbidden' };

    const patch: Partial<typeof static_data.$inferInsert> = {};
    if (body.enumName !== undefined) patch.enum_name = body.enumName.trim();
    if (body.values !== undefined) patch.values = body.values;
    if (body.translation !== undefined) patch.translation = body.translation;

    if (Object.keys(patch).length > 0) {
      const scopeCond = isGlobal ? isNull(static_data.organization_id) : eq(static_data.organization_id, orgId);
      try {
        await db.update(static_data).set(patch).where(and(eq(static_data.id, id), scopeCond));
        void this.versions.record('static_data', id, 'update_delta', callerId, patch).catch(() => {});
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, error: 'duplicate-enum' };
        throw err;
      }
    }
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const [existing] = await db
      .select({ id: static_data.id, organization_id: static_data.organization_id })
      .from(static_data)
      .where(eq(static_data.id, id));
    if (!existing) return { ok: false, error: 'not-found' };

    const isGlobal = existing.organization_id === null;
    const allowed = isGlobal
      ? await isSuperDeveloper(db, callerId)
      : existing.organization_id === orgId && (await isOrgAdmin(db, orgId, callerId));
    if (!allowed) return { ok: false, error: 'forbidden' };

    const scopeCond = isGlobal ? isNull(static_data.organization_id) : eq(static_data.organization_id, orgId);
    await db.delete(static_data).where(and(eq(static_data.id, id), scopeCond));
    void this.versions.record('static_data', id, 'delete', callerId, null).catch(() => {});
    return { ok: true };
  }
}
