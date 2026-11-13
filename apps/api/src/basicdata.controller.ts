import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, can, isOrgMember, permissionIdsOf } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { BasicDataService, nestOrgKeys, scopeToOrg } from './basicdata.service';
import { users } from './db/schema';
import { FieldsService } from './fields.service';
import { BASICDATA_FORM, BASICDATA_NESTED_KEYS_BY_GROUP, basicdataGroupOfKey, editableKeys, mergeForm, orgCustomKeys, validateFields, type ResolvedForm } from '@worktime3/shared/fields';
import type { Executor } from './access';

/**
 * Nested objects and lists the field registry does not describe yet (docs/FIELD_CONFIG.md, "Basic
 * data specifics"). Anyone may change them via a change request.
 */
const NESTED_KEYS = ['bankAccounts', 'emergencyContacts', 'partner', 'children'] as const;

/**
 * Every key an HR/admin direct edit may set: the code's writable fields plus the nested ones. An
 * org's template adds its custom fields to these (see `allowedKeys`).
 */
const ALL_KEYS = [...editableKeys(BASICDATA_FORM, 'hr'), ...NESTED_KEYS];

/** Keys an employee may change about themselves through a change request (`editableBy: 'self'`). */
const SELF_SERVICE_KEYS = [...editableKeys(BASICDATA_FORM, 'self'), ...NESTED_KEYS];

/** The keys an editor may write under an org's merged template: its non-retired fields plus the nested lists. */
export function allowedKeys(form: ResolvedForm, editor: 'hr' | 'self'): string[] {
  return [...editableKeys(form, editor), ...NESTED_KEYS];
}

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

// ---------------------------------------------------------------------------------------------
// Section permissions: each basic-data group is `section.basicdata.<group>`. `see` shows it;
// `edit` lets the employee request changes to their own data (HR approves), while an `edit`
// grant reaching beyond `own` (HR: `all`) edits directly and approves requests.

export const BASICDATA_GROUPS = Object.keys(BASICDATA_NESTED_KEYS_BY_GROUP);

export interface SectionAccess {
  see: boolean;
  /** May ask for a change of their own data (needs approval). */
  request: boolean;
  /** May change it directly / approve change requests for it. */
  direct: boolean;
}

/** Section ids granting `edit` only on one's own data: dropped to decide direct edits. */
function withoutOwnSectionEdits(held: Set<string>): Set<string> {
  return new Set([...held].filter((id) => !(id.startsWith('section.basicdata.') && id.endsWith(':edit:own'))));
}

/** What the caller may do with each basic-data section of `targetUserId`. */
export async function basicdataSectionAccess(
  db: Executor,
  orgId: string,
  callerId: string,
  targetUserId: string,
): Promise<Record<string, SectionAccess>> {
  const held = await permissionIdsOf(db, orgId, callerId);
  const beyondOwn = withoutOwnSectionEdits(held);
  const isSelf = callerId === targetUserId;
  const out: Record<string, SectionAccess> = {};
  for (const group of BASICDATA_GROUPS) {
    const object = `section.basicdata.${group}`;
    const see = await can(db, orgId, callerId, object, 'see', targetUserId, held);
    const direct = see && (await can(db, orgId, callerId, object, 'edit', targetUserId, beyondOwn));
    const request = see && !direct && isSelf && (await can(db, orgId, callerId, object, 'edit', targetUserId, held));
    out[group] = { see, request, direct };
  }
  return out;
}

/**
 * Drops the keys of sections the caller may not see. Keys that belong to no section are kept
 * only for callers who see every section.
 */
export function filterBasicDataBySections(
  data: Record<string, unknown>,
  form: { fields: { key: string; group: string }[] },
  visible: (group: string) => boolean,
): Record<string, unknown> {
  const all = BASICDATA_GROUPS.every(visible);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const group = basicdataGroupOfKey(form, key);
    if (group ? visible(group) : all) out[key] = value;
  }
  return out;
}

/** The sections a patch touches (null when a key belongs to none). */
export function sectionsOfPatch(patch: Record<string, unknown>, form: { fields: { key: string; group: string }[] }): Set<string> | null {
  const groups = new Set<string>();
  for (const key of Object.keys(patch)) {
    if (key === 'orgs') {
      // An org's custom fields, nested by `nestOrgKeys`.
      for (const section of Object.values(patch.orgs ?? {}) as Record<string, unknown>[]) {
        const inner = sectionsOfPatch(section ?? {}, form);
        if (!inner) return null;
        for (const g of inner) groups.add(g);
      }
      continue;
    }
    const group = basicdataGroupOfKey(form, key);
    if (!group) return null;
    groups.add(group);
  }
  return groups;
}

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
    const sections = await basicdataSectionAccess(db, orgId, callerId, userId);
    if (!BASICDATA_GROUPS.some((g) => sections[g].see)) return { ok: false, error: 'forbidden' };
    const visible = (g: string) => sections[g]?.see === true;
    const form = await this.form(orgId);

    const [basicdata, pending, [account]] = await Promise.all([
      this.basicData.get(userId),
      this.basicData.pending(userId),
      db
        .select({ email: users.email, display_name: users.display_name, first_name: users.first_name, middle_name: users.middle_name, last_name: users.last_name })
        .from(users)
        .where(eq(users.id, userId)),
    ]);
    const merged = {
      ...scopeToOrg(basicdata, orgId),
      displayName: account?.display_name ?? '',
      firstName: account?.first_name ?? '',
      middleName: account?.middle_name ?? '',
      lastName: account?.last_name ?? '',
    };
    return {
      ok: true,
      basicdata: filterBasicDataBySections(merged, form, visible),
      pending: pending && { ...pending, data: filterBasicDataBySections(scopeToOrg(pending.data, orgId), form, visible) },
      sections,
      // Older clients: direct edit when every visible section is directly editable.
      canEditDirectly: BASICDATA_GROUPS.every((g) => !sections[g].see || sections[g].direct),
      companyEmail: visible('personalien') ? account?.email ?? null : null,
    };
  }

  @Get('organizations/:orgId/users/:userId/basicdata/versions')
  async versions(@Param('orgId') orgId: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, history: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const sections = await basicdataSectionAccess(db, orgId, callerId, userId);
    if (!BASICDATA_GROUPS.some((g) => sections[g].see)) return { ok: false, error: 'forbidden' };
    const form = await this.form(orgId);
    const history = await this.basicData.history(userId);
    return {
      ok: true,
      history: history.map((e) => ({ ...e, data: filterBasicDataBySections(scopeToOrg(e.data, orgId), form, (g) => sections[g]?.see === true) })),
    };
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
    const sections = await basicdataSectionAccess(db, orgId, callerId, userId);
    if (!BASICDATA_GROUPS.some((g) => sections[g].direct)) return { ok: false, error: 'forbidden' };
    const form = await this.form(orgId);
    const sanitized = sanitizePatch(body.patch, allowedKeys(form, 'hr'));
    if (!sanitized) return { ok: false, error: 'invalid-patch' };
    const touched = sectionsOfPatch(sanitized, form);
    if (!touched || [...touched].some((g) => !sections[g]?.direct)) return { ok: false, error: 'forbidden' };
    const checked = this.validate(form, sanitized);
    if (!checked.ok) return checked;
    const patch = nestOrgKeys(checked.patch, orgCustomKeys(form), orgId);

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
    const sections = await basicdataSectionAccess(db, orgId, callerId, userId);
    const form = await this.form(orgId);
    const sanitized = sanitizePatch(body.patch, allowedKeys(form, 'self'));
    if (!sanitized) return { ok: false, error: 'invalid-patch' };
    // A request may only touch sections the employee may edit (directly editable ones count too).
    const touched = sectionsOfPatch(sanitized, form);
    if (!touched || [...touched].some((g) => !sections[g]?.request && !sections[g]?.direct)) return { ok: false, error: 'forbidden' };
    const checked = this.validate(form, sanitized);
    if (!checked.ok) return checked;
    const patch = nestOrgKeys(checked.patch, orgCustomKeys(form), orgId);

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
    if (!(await this.mayResolve(db, orgId, callerId, userId))) return { ok: false, error: 'forbidden' };

    const result = await this.basicData.resolveRequest(userId, Number(versionNr), 'approved', callerId, null, orgId, USER_COLUMN_MAP);
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
    if (!(await this.mayResolve(db, orgId, callerId, userId))) return { ok: false, error: 'forbidden' };

    const note = (body.note ?? '').trim() || null;
    const result = await this.basicData.resolveRequest(userId, Number(versionNr), 'rejected', callerId, note, orgId);
    if (result.ok) void this.audit.record(orgId, callerId, 'basicdata.reject', 'user', userId, { version: Number(versionNr), note: note ?? undefined }).catch(() => {});
    return result;
  }

  /** Approving/rejecting a change request needs direct edit on every section it touches. */
  private async mayResolve(db: Executor, orgId: string, callerId: string, userId: string): Promise<boolean> {
    const pending = await this.basicData.pending(userId);
    if (!pending) return true; // resolveRequest reports the missing request itself
    const sections = await basicdataSectionAccess(db, orgId, callerId, userId);
    const touched = sectionsOfPatch(scopeToOrg(pending.data, orgId), await this.form(orgId));
    if (!touched) return BASICDATA_GROUPS.every((g) => sections[g].direct);
    return [...touched].every((g) => sections[g]?.direct);
  }

  /** The org's merged basic-data template (code defaults when it cannot be read). */
  private async form(orgId: string): Promise<ResolvedForm> {
    return (await this.fields.resolved(orgId, BASICDATA_FORM.id)) ?? mergeForm(BASICDATA_FORM);
  }

  /** Checks the patch against the org's merged basic-data template; returns normalized values. */
  private validate(form: ResolvedForm, patch: Record<string, unknown>) {
    const { errors, values } = validateFields(form, patch);
    if (errors.length > 0) return { ok: false as const, error: 'invalid-field', fields: errors };
    return { ok: true as const, patch: values };
  }

  @Get('organizations/:orgId/basicdata/pending')
  async pendingForOrg(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return [];
    // Only requests the caller may resolve (direct edit on every section a request touches).
    const rows = await this.basicData.pendingForOrg(orgId);
    const out = [];
    for (const r of rows) {
      if (await this.mayResolve(db, orgId, callerId, r.user_id)) out.push({ ...r, entry: { ...r.entry, data: scopeToOrg(r.entry.data, orgId) } });
    }
    return out;
  }
}
