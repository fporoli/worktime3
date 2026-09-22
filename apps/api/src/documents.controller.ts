import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { and, eq, gte, lt, or, sql } from 'drizzle-orm';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { DbService } from './db.service';
import { callerUserId, isOwnerAdminOrManagerOf } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { absences, documents, expenses } from './db/schema';
import { DocumentsService, DOCUMENTS_ROOT } from './documents.service';

@Controller()
export class DocumentsController {
  constructor(
    private readonly db: DbService,
    private readonly documentsService: DocumentsService,
  ) {}

  @Get('organizations/:orgId/documents')
  async list(
    @Param('orgId') orgId: string,
    @Query('kind') kind: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return [];

    const conditions = [
      eq(documents.organization_id, orgId),
      or(
        eq(documents.uploaded_by_user_id, callerId),
        eq(expenses.user_id, callerId),
        eq(absences.user_id, callerId),
      ),
    ];
    if (kind === 'expense-receipt') conditions.push(eq(documents.source_table, 'expenses'));
    if (kind === 'absence-certificate') conditions.push(eq(documents.source_table, 'absences'));
    if (from) {
      conditions.push(or(
        gte(expenses.expense_date, from),
        gte(absences.date_start, from),
        gte(documents.created_at, from),
      ));
    }
    if (to) {
      conditions.push(or(
        lt(expenses.expense_date, to),
        lt(absences.date_start, to),
        lt(documents.created_at, to),
      ));
    }

    const rows = await db
      .select({
        id: documents.id,
        file_name: documents.file_name,
        mime_type: documents.mime_type,
        size_bytes: documents.size_bytes,
        created_at: documents.created_at,
        source_table: documents.source_table,
        source_table_id: documents.source_table_id,
        uploaded_by_user_id: documents.uploaded_by_user_id,
        expense_user_id: expenses.user_id,
        expense_date: expenses.expense_date,
        expense_category: expenses.category,
        absence_user_id: absences.user_id,
        absence_start: absences.date_start,
        absence_end: absences.date_end,
        absence_type: absences.absence_type,
      })
      .from(documents)
      .leftJoin(expenses, and(eq(documents.source_table, sql`'expenses'`), eq(documents.source_table_id, expenses.id)))
      .leftJoin(absences, and(eq(documents.source_table, sql`'absences'`), eq(documents.source_table_id, absences.id)))
      .where(and(...conditions));

    return rows.map((row) => ({
      ...row,
      kind: row.source_table === 'expenses' ? 'expense-receipt' : row.source_table === 'absences' ? 'absence-certificate' : 'document',
    }));
  }

  @Get('documents/:id')
  async download(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const db = this.db.getDb();
    const callerId = db && req.user ? await callerUserId(db, req.user) : null;
    if (!db || !callerId) {
      res.status(401).json({ ok: false, error: 'unauthenticated' });
      return;
    }
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    if (!doc) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }

    let ownerId: string | null = doc.uploaded_by_user_id;
    if (doc.source_table === 'expenses' && doc.source_table_id) {
      const [row] = await db.select({ user_id: expenses.user_id, organization_id: expenses.organization_id }).from(expenses).where(eq(expenses.id, doc.source_table_id));
      if (!row || row.organization_id !== doc.organization_id) {
        res.status(404).json({ ok: false, error: 'not-found' });
        return;
      }
      ownerId = row.user_id;
    } else if (doc.source_table === 'absences' && doc.source_table_id) {
      const [row] = await db.select({ user_id: absences.user_id, organization_id: absences.organization_id }).from(absences).where(eq(absences.id, doc.source_table_id));
      if (!row || row.organization_id !== doc.organization_id) {
        res.status(404).json({ ok: false, error: 'not-found' });
        return;
      }
      ownerId = row.user_id;
    }
    if (ownerId !== callerId) {
      const allowed = doc.source_table && doc.source_table_id
        ? await this.canViewSource(db, doc.source_table, doc.source_table_id, callerId)
        : false;
      if (!allowed) {
        res.status(403).json({ ok: false, error: 'forbidden' });
        return;
      }
    }

    const file = await this.documentsService.get(db, id);
    if (!file) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    res.set({ 'Content-Type': file.mime_type, 'Content-Disposition': `attachment; filename="${file.file_name.replace(/"/g, '')}"` });
    createReadStream(join(DOCUMENTS_ROOT, file.storage_path)).pipe(res);
  }

  private async canViewSource(db: NonNullable<ReturnType<DbService['getDb']>>, sourceTable: string, sourceId: string, callerId: string) {
    if (sourceTable === 'expenses') {
      const [row] = await db.select({ user_id: expenses.user_id, organization_id: expenses.organization_id }).from(expenses).where(eq(expenses.id, sourceId));
      return !!row && isOwnerAdminOrManagerOf(db, row.organization_id, callerId, row.user_id);
    }
    if (sourceTable === 'absences') {
      const [row] = await db.select({ user_id: absences.user_id, organization_id: absences.organization_id }).from(absences).where(eq(absences.id, sourceId));
      return !!row && isOwnerAdminOrManagerOf(db, row.organization_id, callerId, row.user_id);
    }
    return false;
  }
}
