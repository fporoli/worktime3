import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, isOrgHrOrAdmin, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { BasicDataService } from './basicdata.service';
import { users } from './db/schema';
import { FieldsService } from './fields.service';
import { BASICDATA_FORM, editableKeys, validateFields } from '@worktime3/shared/fields';

/**
 * Nested objects and lists the field registry does not describe yet (docs/FIELD_CONFIG.md, "Basic
 * data specifics"). Anyone may change them via a change request.
 */
const NESTED_KEYS = ['bankAccounts', 'emergencyContacts', 'partner', 'children'] as const;

/** Every key an HR/admin direct edit may set: the registry's writable fields plus the nested ones. */
const ALL_KEYS = [...editableKeys(BASICDATA_FORM, 'hr'), ...NESTED_KEYS];

/** Keys an employee may change about themselves through a change request (`editableBy: 'self'`). */
const SELF_SERVICE_KEYS = [...editableKeys(BASICDATA_FORM, 'self'), ...NESTED_KEYS];

/**
 * Registry fields stored in real `users` columns rather than the basicdata jsonb: `update()` routes
 * them to a `users` update instead of merging them into users.basicdata.
 */
const USER_COLUMN_MAP: Record<string, string> = Object.fromEntries(
  BASICDATA_FORM.fields
    .filter((f) => !f.readOnly && f.storage.kind === 'column' && f.storage.table === 'users')
    .map((f) => [f.key, f.storage.column]),
);

export { ALL_KEYS as BASICDATA_HR_KEYS, SELF_SERVICE_KEYS as BASICDATA_SELF_KEYS, USER_COLUMN_MAP as BASICDATA_USER_COLUMNS };

/** Keep only known top-level keys from `keys`, and cap overall size so nobody can stuff arbitrary payloads in here. */
function sanitizePatch(body: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in (body as Record<string, unknown>)) patch[key] = (body as Record<string, unknown>)[key];
  }
  if (Object.keys(patch).length === 0) return null;
  if (JSON.stringify(patch).length > 20_000) return null;
  return patch;
}

@Controller()
export class BasicDataController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versionsService: VersionsService,
    private readonly basicData: BasicDataService,
    private readonly fields: FieldsService,
  ) {}

  @Get('organizations/:orgId/users/:userId/basicdata')
  async get(@Param('orgId') orgId: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, basicdata: {}, pending: null };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const isSelf = callerId === userId;
    const isReviewer = await isOrgHrOrAdmin(db, orgId, callerId);
    if (!isSelf && !isReviewer) return { ok: false, error: 'forbidden' };

    const [basicdata, pending, [account]] = await Promise.all([
      this.basicData.get(userId),
      this.basicData.pending(userId),
      db
        .select({ email: users.email, display_name: users.display_name, first_name: users.first_name, middle_name: users.middle_name, last_name: users.last_name })
        .from(users)
        .where(eq(users.id, userId)),
    ]);
    const merged = {
      ...basicdata,
      displayName: account?.display_name ?? '',
      firstName: account?.first_name ?? '',
      middleName: account?.middle_name ?? '',
      lastName: account?.last_name ?? '',
    };
    return { ok: true, basicdata: merged, pending, canEditDirectly: isReviewer, companyEmail: account?.email ?? null };
  }

  @Get('organizations/:orgId/users/:userId/basicdata/versions')
  async versions(@Param('orgId') orgId: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, history: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    if (callerId !== userId && !(await isOrgHrOrAdmin(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    return { ok: true, history: await this.basicData.history(userId) };
  }

  @Put('organizations/:orgId/users/:userId/basicdata')
  async update(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: { patch?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgHrOrAdmin(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const sanitized = sanitizePatch(body.patch, ALL_KEYS);
    if (!sanitized) return { ok: false, error: 'invalid-patch' };
    const checked = await this.validate(orgId, sanitized);
    if (!checked.ok) return checked;
    const patch = checked.patch;

    const userColumnPatch: Partial<typeof users.$inferInsert> = {};
    const basicdataPatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      const column = USER_COLUMN_MAP[key];
      if (column) (userColumnPatch as Record<string, unknown>)[column] = value;
      else basicdataPatch[key] = value;
    }

    if (Object.keys(userColumnPatch).length > 0) {
      await db.update(users).set(userColumnPatch).where(eq(users.id, userId));
      void this.versionsService.record('users', userId, 'update_delta', callerId, userColumnPatch).catch(() => {});
    }
    if (Object.keys(basicdataPatch).length > 0) {
      await this.basicData.applyDirectEdit(userId, basicdataPatch, callerId);
    }
    void this.audit.record(orgId, callerId, 'basicdata.update', 'user', userId, { fields: Object.keys(patch) }).catch(() => {});
    return { ok: true };
  }

  @Post('organizations/:orgId/users/:userId/basicdata/request')
  async requestChange(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: { patch?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (callerId !== userId) return { ok: false, error: 'forbidden' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const sanitized = sanitizePatch(body.patch, SELF_SERVICE_KEYS);
    if (!sanitized) return { ok: false, error: 'invalid-patch' };
    const checked = await this.validate(orgId, sanitized);
    if (!checked.ok) return checked;
    const patch = checked.patch;

    const result = await this.basicData.requestChange(userId, patch, callerId);
    if (result.ok) void this.audit.record(orgId, callerId, 'basicdata.request', 'user', userId, { fields: Object.keys(patch) }).catch(() => {});
    return result;
  }

  @Post('organizations/:orgId/users/:userId/basicdata/versions/:versionNr/approve')
  async approve(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Param('versionNr') versionNr: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgHrOrAdmin(db, orgId, callerId))) return { ok: false, error: 'forbidden' };

    const result = await this.basicData.resolveRequest(userId, Number(versionNr), 'approved', callerId, null);
    if (result.ok) void this.audit.record(orgId, callerId, 'basicdata.approve', 'user', userId, { version: Number(versionNr) }).catch(() => {});
    return result;
  }

  @Post('organizations/:orgId/users/:userId/basicdata/versions/:versionNr/reject')
  async reject(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Param('versionNr') versionNr: string,
    @Body() body: { note?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgHrOrAdmin(db, orgId, callerId))) return { ok: false, error: 'forbidden' };

    const note = (body.note ?? '').trim() || null;
    const result = await this.basicData.resolveRequest(userId, Number(versionNr), 'rejected', callerId, note);
    if (result.ok) void this.audit.record(orgId, callerId, 'basicdata.reject', 'user', userId, { version: Number(versionNr), note: note ?? undefined }).catch(() => {});
    return result;
  }

  /** Checks the patch against the org's merged basic-data template; returns normalized values. */
  private async validate(orgId: string, patch: Record<string, unknown>) {
    const form = await this.fields.resolved(orgId, BASICDATA_FORM.id);
    if (!form) return { ok: true as const, patch };
    const { errors, values } = validateFields(form, patch);
    if (errors.length > 0) return { ok: false as const, error: 'invalid-field', fields: errors };
    return { ok: true as const, patch: values };
  }

  @Get('organizations/:orgId/basicdata/pending')
  async pendingForOrg(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgHrOrAdmin(db, orgId, callerId))) return [];
    return this.basicData.pendingForOrg(orgId);
  }
}
