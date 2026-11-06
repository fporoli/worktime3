import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { and, asc, eq, getTableColumns, gte, lt, sql, type SQL } from 'drizzle-orm';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { DbService, type Db } from './db.service';
import { VersionsService } from './versions.service';
import { callerUserId, isManagerOf, isOrgAdmin, isOrgMember, isOwnerAdminOrManagerOf } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { expenses, expense_report_items, expense_reports, projects, subprojects } from './db/schema';
import { DocumentsService, DOCUMENTS_ROOT, MAX_DOCUMENT_BYTES } from './documents.service';
import { FieldsService } from './fields.service';
import { EXPENSE_FORM, mergeForm, validateFields, type ResolvedForm } from '@worktime3/shared/fields';

type ExpenseColumns = Partial<typeof expenses.$inferInsert>;

/**
 * Maps validated form values (keyed like the registry, which matches the request body) to
 * `expenses` columns. Only keys present in `values` are mapped; empty values become NULL.
 */
export function expenseColumns(values: Record<string, unknown>): ExpenseColumns {
  const out: Record<string, unknown> = {};
  for (const field of EXPENSE_FORM.fields) {
    if (field.storage.kind !== 'column' || !(field.key in values)) continue;
    const v = values[field.key];
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    out[field.storage.column] = empty ? null : field.type === 'number' ? String(v) : v;
  }
  return out as ExpenseColumns;
}

/** Values of the template's custom fields, for `expenses.data`; empty values become null. */
export function expenseCustomData(form: ResolvedForm, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of form.fields) {
    if (!field.custom || field.retired || !(field.key in values)) continue;
    const v = values[field.key];
    out[field.key] = v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v;
  }
  return out;
}

/**
 * The form's fields present in the body (all of them when `all`, so a create checks required
 * ones). Retired custom fields are left out, so they are never written.
 */
function pickFields(form: ResolvedForm, body: Record<string, unknown>, all: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of form.fields) {
    if (field.retired) continue;
    if (all || field.key in body) out[field.key] = body[field.key];
  }
  return out;
}

@Controller()
export class ExpensesController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
    private readonly documents: DocumentsService,
    private readonly fields: FieldsService,
  ) {}

  /**
   * Checks the body against the org's merged expense template (code fields and custom fields);
   * returns the columns to write and the custom values for `expenses.data`.
   */
  private async validate(orgId: string, body: Record<string, unknown>, all: boolean) {
    const form = (await this.fields.resolved(orgId, EXPENSE_FORM.id)) ?? mergeForm(EXPENSE_FORM);
    const { errors, values } = validateFields(form, pickFields(form, body, all));
    if (errors.length > 0) return { ok: false as const, error: 'invalid-field', fields: errors };
    return { ok: true as const, columns: expenseColumns(values), data: expenseCustomData(form, values) };
  }

  @Post('organizations/:orgId/expenses')
  async create(
    @Param('orgId') orgId: string,
    @Body()
    body: {
      expenseDate: string;
      category: string;
      subCategory?: string;
      billingType?: string;
      originalValue?: number;
      originalCurrency?: string;
      currency: string;
      value?: number;
      quantity?: number;
      comment?: string;
      projectId?: string;
      subprojectId?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    // The expense always belongs to the caller — never trust a client-supplied user id.
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'forbidden' };
    const checked = await this.validate(orgId, body ?? {}, true);
    if (!checked.ok) return checked;
    const values = {
      ...checked.columns,
      data: checked.data,
      user_id: userId,
      organization_id: orgId,
      billing_type: body.billingType ?? null,
    } as typeof expenses.$inferInsert;
    const [row] = await db.insert(expenses).values(values).returning({ id: expenses.id });
    void this.versions.record('expenses', row.id, 'insert', userId, { id: row.id, ...values }).catch(() => {});
    return { ok: true, id: row.id };
  }

  @Get('organizations/:orgId/expenses')
  async list(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return { entries: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { entries: [] };

    const isAdmin = await isOrgAdmin(db, orgId, callerId);
    let targetUserId = userId;
    if (targetUserId && targetUserId !== callerId) {
      if (!isAdmin && !(await isManagerOf(db, orgId, callerId, targetUserId))) {
        return { entries: [] };
      }
    } else if (!targetUserId && !isAdmin) {
      targetUserId = callerId;
    }

    const conditions: SQL[] = [eq(expenses.organization_id, orgId)];
    if (targetUserId) conditions.push(eq(expenses.user_id, targetUserId));
    if (from) conditions.push(gte(expenses.expense_date, from));
    if (to) conditions.push(lt(expenses.expense_date, to));

    // Names + report mapping come along so the UI can list expenses (and whether/where
    // each is attached) without a lookup per row.
    const rows = await db
      .select({
        ...getTableColumns(expenses),
        project_name: projects.name,
        subproject_name: subprojects.name,
        expense_report_id: expense_report_items.expense_report_id,
        expense_report_status: expense_reports.status,
      })
      .from(expenses)
      .leftJoin(projects, eq(projects.id, expenses.project_id))
      .leftJoin(subprojects, eq(subprojects.id, expenses.subproject_id))
      .leftJoin(expense_report_items, eq(expense_report_items.expense_id, expenses.id))
      .leftJoin(expense_reports, eq(expense_reports.id, expense_report_items.expense_report_id))
      .where(and(...conditions))
      .orderBy(asc(expenses.expense_date));

    return { entries: rows };
  }

  @Patch('expenses/:id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      projectId?: string | null;
      subprojectId?: string | null;
      expenseDate?: string;
      category?: string;
      subCategory?: string | null;
      billingType?: string | null;
      originalValue?: number | null;
      originalCurrency?: string | null;
      currency?: string;
      value?: number;
      quantity?: number | null;
      comment?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableExpense(db, id, req);
    if ('error' in owned) return owned;

    const checked = await this.validate(owned.entry.organization_id as string, body ?? {}, false);
    if (!checked.ok) return checked;
    const delta: Record<string, unknown> = { ...checked.columns };
    if (body.billingType !== undefined) delta.billing_type = body.billingType;
    const hasData = Object.keys(checked.data).length > 0;
    if (Object.keys(delta).length === 0 && !hasData) return { ok: true };
    // Custom values merge into `data` key by key; the history records only what changed.
    const set = hasData ? { ...delta, data: sql`${expenses.data} || ${JSON.stringify(checked.data)}::jsonb` } : delta;
    await db.update(expenses).set(set).where(eq(expenses.id, id));
    void this.versions.record('expenses', id, 'update_delta', owned.userId, hasData ? { ...delta, data: checked.data } : delta).catch(() => {});
    return { ok: true };
  }

  @Delete('expenses/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableExpense(db, id, req);
    if ('error' in owned) return owned;
    // An expense attached to a report isn't silently unmapped by ON DELETE CASCADE —
    // the caller must detach it first (see ExpenseReportsController's item endpoints).
    const [mapped] = await db
      .select({ id: expense_report_items.id })
      .from(expense_report_items)
      .where(eq(expense_report_items.expense_id, id));
    if (mapped) return { ok: false, error: 'expense-mapped' };
    await db.delete(expenses).where(eq(expenses.id, id));
    void this.versions.record('expenses', id, 'delete', owned.userId, owned.entry).catch(() => {});
    return { ok: true };
  }

  /** Evidence upload for an expense (e.g. a pay slip) — the expense's own owner. Replaces any existing one. */
  @Post('expenses/:id/document')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async uploadDocument(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableExpense(db, id, req);
    if ('error' in owned) return owned;
    if (!file) return { ok: false, error: 'file-required' };

    const organizationId = owned.entry.organization_id as string;
    const previousDocId = owned.entry.document_id as string | null;
    const newDocId = await this.documents.upload(db, organizationId, owned.userId, file, { table: 'expenses', id });
    await db.update(expenses).set({ document_id: newDocId }).where(eq(expenses.id, id));
    if (previousDocId) await this.documents.remove(db, previousDocId);
    void this.versions.record('expenses', id, 'update_delta', owned.userId, { document_id: newDocId }).catch(() => {});
    return { ok: true, id: newDocId };
  }

  @Get('expenses/:id/document/meta')
  async getDocumentMeta(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return null;
    const [row] = await db.select({ user_id: expenses.user_id, organization_id: expenses.organization_id, document_id: expenses.document_id }).from(expenses).where(eq(expenses.id, id));
    if (!row?.document_id) return null;
    if (!(await isOwnerAdminOrManagerOf(db, row.organization_id, callerId, row.user_id))) return null;

    const doc = await this.documents.get(db, row.document_id);
    if (!doc) return null;
    return { id: doc.id, file_name: doc.file_name, mime_type: doc.mime_type, size_bytes: doc.size_bytes, created_at: doc.created_at };
  }

  @Get('expenses/:id/document')
  async downloadDocument(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const db = this.db.getDb();
    const callerId = db && req.user ? await callerUserId(db, req.user) : null;
    if (!db || !callerId) {
      res.status(401).json({ ok: false, error: 'unauthenticated' });
      return;
    }
    const [row] = await db.select({ user_id: expenses.user_id, organization_id: expenses.organization_id, document_id: expenses.document_id }).from(expenses).where(eq(expenses.id, id));
    if (!row?.document_id) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    if (!(await isOwnerAdminOrManagerOf(db, row.organization_id, callerId, row.user_id))) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    const doc = await this.documents.get(db, row.document_id);
    if (!doc) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    res.set({ 'Content-Type': doc.mime_type, 'Content-Disposition': `attachment; filename="${doc.file_name.replace(/"/g, '')}"` });
    createReadStream(join(DOCUMENTS_ROOT, doc.storage_path)).pipe(res);
  }

  @Delete('expenses/:id/document')
  async deleteDocument(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableExpense(db, id, req);
    if ('error' in owned) return owned;
    const documentId = owned.entry.document_id as string | null;
    if (!documentId) return { ok: false, error: 'not-found' };

    await db.update(expenses).set({ document_id: null }).where(eq(expenses.id, id));
    await this.documents.remove(db, documentId);
    void this.versions.record('expenses', id, 'update_delta', owned.userId, { document_id: null }).catch(() => {});
    return { ok: true };
  }

  /**
   * Expenses are only editable by the user they belong to. Returns `{error}`
   * when disallowed, or the entry (plus caller id) when the edit may proceed.
   */
  private async assertEditableExpense(
    db: Db,
    id: string,
    req: AuthenticatedRequest,
  ): Promise<
    | { ok: false; error: string }
    | { userId: string; entry: Record<string, unknown> }
  > {
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    const [row] = await db.select().from(expenses).where(eq(expenses.id, id));
    if (!row) return { ok: false, error: 'not-found' };
    if (row.user_id !== userId) return { ok: false, error: 'forbidden' };
    return { userId, entry: row };
  }
}
