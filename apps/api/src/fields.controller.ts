import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common';
import { FORMS, GROUPS_KEY, checkFieldOverride, checkGroupsOverride, mergeForm } from '@worktime3/shared/fields';
import { DbService, type Db } from './db.service';
import { callerUserId, isOrgDeveloper, isOrgMember, isSuperDeveloper } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { FieldsService, loadLayers } from './fields.service';

/**
 * Form templates (docs/FIELD_CONFIG.md): every member reads the merged template of their org;
 * an org's developer (or a superdeveloper) edits the org layer; only a superdeveloper edits the
 * global layer. Every write is checked against the code registry, so no layer can loosen a rule
 * the code sets.
 */
@Controller()
export class FieldsController {
  constructor(
    private readonly db: DbService,
    private readonly fields: FieldsService,
    private readonly audit: AuditService,
    private readonly versionsService: VersionsService,
  ) {}

  /** Whether the caller may use design mode in this org, and whether they may edit the global template. */
  @Get('organizations/:orgId/form-design-access')
  async designAccess(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, canDesign: false, canEditGlobal: false };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: true, canDesign: false, canEditGlobal: false };
    const [canDesign, canEditGlobal] = await Promise.all([isOrgDeveloper(db, orgId, callerId), isSuperDeveloper(db, callerId)]);
    return { ok: true, canDesign, canEditGlobal };
  }

  @Get('organizations/:orgId/forms/:formId')
  async get(@Param('orgId') orgId: string, @Param('formId') formId: string, @Req() req: AuthenticatedRequest) {
    const form = FORMS[formId];
    if (!form) return { ok: false, error: 'unknown-form' };
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, form: mergeForm(form) };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    return { ok: true, form: await this.fields.resolved(orgId, formId) };
  }

  /** The code defaults and both layers separately, so the design panel can show where each value comes from. */
  @Get('organizations/:orgId/forms/:formId/layers')
  async layers(@Param('orgId') orgId: string, @Param('formId') formId: string, @Req() req: AuthenticatedRequest) {
    const form = FORMS[formId];
    if (!form) return { ok: false, error: 'unknown-form' };
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, code: form, global: { fields: {}, groups: {} }, org: { fields: {}, groups: {} }, canEditGlobal: false };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgDeveloper(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const layers = await loadLayers(db, orgId, formId);
    return { ok: true, code: form, ...layers, canEditGlobal: await isSuperDeveloper(db, callerId) };
  }

  @Put('organizations/:orgId/forms/:formId/fields/:fieldKey')
  async putOrg(
    @Param('orgId') orgId: string,
    @Param('formId') formId: string,
    @Param('fieldKey') fieldKey: string,
    @Body() body: { config?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgDeveloper(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const result = await this.save(db, orgId, formId, fieldKey, body?.config, callerId);
    if (result.ok) void this.audit.record(orgId, callerId, 'fields.update', 'form', formId, { field: fieldKey }).catch(() => {});
    return result;
  }

  @Delete('organizations/:orgId/forms/:formId/fields/:fieldKey')
  async deleteOrg(
    @Param('orgId') orgId: string,
    @Param('formId') formId: string,
    @Param('fieldKey') fieldKey: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgDeveloper(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const result = await this.remove(db, orgId, formId, fieldKey, callerId);
    if (result.ok) void this.audit.record(orgId, callerId, 'fields.reset', 'form', formId, { field: fieldKey }).catch(() => {});
    return result;
  }

  @Put('forms/:formId/fields/:fieldKey')
  async putGlobal(
    @Param('formId') formId: string,
    @Param('fieldKey') fieldKey: string,
    @Body() body: { config?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isSuperDeveloper(db, callerId))) return { ok: false, error: 'forbidden' };
    return this.save(db, null, formId, fieldKey, body?.config, callerId);
  }

  @Delete('forms/:formId/fields/:fieldKey')
  async deleteGlobal(@Param('formId') formId: string, @Param('fieldKey') fieldKey: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isSuperDeveloper(db, callerId))) return { ok: false, error: 'forbidden' };
    return this.remove(db, null, formId, fieldKey, callerId);
  }

  /** Checks a layer's config for one field (or `$groups`) against the code registry and stores it. */
  private async save(db: Db, orgId: string | null, formId: string, fieldKey: string, config: unknown, callerId: string) {
    const form = FORMS[formId];
    if (!form) return { ok: false, error: 'unknown-form' };
    const check = fieldKey === GROUPS_KEY ? checkGroupsOverride(form, config) : checkFieldOverride(form, fieldKey, config);
    if (!check.ok) return { ok: false, error: 'field-config-invalid', reason: check.reason, property: check.property };
    if (Object.keys(check.value).length === 0) return this.remove(db, orgId, formId, fieldKey, callerId);

    const stored = fieldKey === GROUPS_KEY ? { groups: check.value } : check.value;
    const id = await this.fields.saveOverride(db, orgId, formId, fieldKey, stored);
    void this.versionsService
      .record('field_config', id, 'update', callerId, { organization_id: orgId, form_id: formId, field_key: fieldKey, config: stored })
      .catch(() => {});
    return { ok: true, config: stored };
  }

  private async remove(db: Db, orgId: string | null, formId: string, fieldKey: string, callerId: string) {
    if (!FORMS[formId]) return { ok: false, error: 'unknown-form' };
    const id = await this.fields.removeOverride(db, orgId, formId, fieldKey);
    if (id) {
      void this.versionsService
        .record('field_config', id, 'delete', callerId, { organization_id: orgId, form_id: formId, field_key: fieldKey })
        .catch(() => {});
    }
    return { ok: true };
  }
}
