import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { and, asc, eq, getTableColumns, gte, lt, type SQL } from 'drizzle-orm';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { DbService, type Db } from './db.service';
import { VersionsService } from './versions.service';
import { callerUserId, isManagerOf, isOrgAdmin, isOrgMember, isOwnerAdminOrManagerOf } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { expenses, expense_report_items, expense_reports, projects, subprojects } from './db/schema';
import { DocumentsService, DOCUMENTS_ROOT, MAX_DOCUMENT_BYTES } from './documents.service';

@Controller()
export class ExpensesController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
    private readonly documents: DocumentsService,
  ) {}

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
    const values = {
      user_id: userId,
      organization_id: orgId,
      project_id: body.projectId ?? null,
      subproject_id: body.subprojectId ?? null,
      expense_date: body.expenseDate,
      category: body.category,
      sub_category: body.subCategory ?? null,
      billing_type: body.billingType ?? null,
      original_value: body.originalValue !== undefined ? String(body.originalValue) : null,
      original_currency: body.originalCurrency ?? null,
      currency: body.currency,
      value: body.value !== undefined ? String(body.value) : undefined,
      quantity: body.quantity !== undefined ? String(body.quantity) : null,
      comment: body.comment ?? null,
    };
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

    const patch: Partial<typeof expenses.$inferInsert> = {};
    if (body.projectId !== undefined) patch.project_id = body.projectId || null;
    if (body.subprojectId !== undefined) patch.subproject_id = body.subprojectId || null;
    if (body.expenseDate !== undefined) patch.expense_date = body.expenseDate;
    if (body.category !== undefined) patch.category = body.category;
    if (body.subCategory !== undefined) patch.sub_category = body.subCategory;
    if (body.billingType !== undefined) patch.billing_type = body.billingType;
    if (body.originalValue !== undefined) patch.original_value = body.originalValue === null ? null : String(body.originalValue);
    if (body.originalCurrency !== undefined) patch.original_currency = body.originalCurrency;
    if (body.currency !== undefined) patch.currency = body.currency;
    if (body.value !== undefined) patch.value = String(body.value);
    if (body.quantity !== undefined) patch.quantity = body.quantity === null ? null : String(body.quantity);
    if (body.comment !== undefined) patch.comment = body.comment;
    if (Object.keys(patch).length === 0) return { ok: true };
    await db.update(expenses).set(patch).where(eq(expenses.id, id));
    void this.versions.record('expenses', id, 'update_delta', owned.userId, patch).catch(() => {});
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
