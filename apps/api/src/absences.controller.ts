import { Body, Controller, Delete, Get, OnModuleInit, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { and, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { DbService, type Db } from './db.service';
import { callerUserId, directReportUserIds, isManagerOf, isOrgAdmin, isOrgMember, isOwnerAdminOrManagerOf, membershipManagerId } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { absences, static_data, users, workflows } from './db/schema';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { BalancesService } from './balances.service';
import { WorkflowsService, APPROVE_ABSENCE_WORKFLOW_NAME } from './workflows.service';
import { DEFAULT_ABSENCE_TYPES } from './absence-types';
import { DocumentsService, DOCUMENTS_ROOT, MAX_DOCUMENT_BYTES } from './documents.service';

const STATUSES = ['pending', 'approved', 'rejected'] as const;
type Status = (typeof STATUSES)[number];

/** The org's allowed absence_type keys — its own static_data override if set, else the built-in defaults. */
async function resolveAbsenceTypes(db: Db, orgId: string): Promise<Set<string>> {
  const [row] = await db
    .select({ values: static_data.values })
    .from(static_data)
    .where(and(eq(static_data.organization_id, orgId), eq(static_data.entity, 'absences'), eq(static_data.enum_name, 'absence_type')));
  if (row?.values && typeof row.values === 'object') return new Set(Object.keys(row.values as Record<string, unknown>));
  return new Set(DEFAULT_ABSENCE_TYPES);
}

@Controller()
export class AbsencesController implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
    private readonly workflowsSvc: WorkflowsService,
    private readonly balances: BalancesService,
    private readonly documents: DocumentsService,
  ) {}

  /** Absences own what "absence.*" workflow actions actually do, and how to resolve an absences row's organization. */
  onModuleInit() {
    this.workflowsSvc.registerSourceOrgResolver('absences', async (db, sourceTableUuid) => {
      const [row] = await db.select({ organization_id: absences.organization_id }).from(absences).where(eq(absences.id, sourceTableUuid));
      return row?.organization_id ?? null;
    });

    this.workflowsSvc.registerAction('absence.approve', async (db, ctx) => {
      const patch = { status: 'approved' as const, reviewed_by_user_id: ctx.actorUserId, reviewed_at: new Date().toISOString(), review_note: null };
      await db.update(absences).set(patch).where(eq(absences.id, ctx.sourceTableUuid));
      void this.versions.record('absences', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
      await this.balances.applyAbsenceApproval(db, ctx.sourceTableUuid);
    });

    this.workflowsSvc.registerAction('absence.reject', async (db, ctx) => {
      const patch = { status: 'rejected' as const, reviewed_by_user_id: ctx.actorUserId, reviewed_at: new Date().toISOString(), review_note: ctx.decisionNote };
      await db.update(absences).set(patch).where(eq(absences.id, ctx.sourceTableUuid));
      void this.versions.record('absences', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
    });
  }

  @Post('organizations/:orgId/absences')
  async submit(
    @Param('orgId') orgId: string,
    @Body() body: { dateStart: string; dateEnd: string; note?: string; absenceType?: string; halfDay?: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };

    const dateStart = (body.dateStart ?? '').trim();
    const dateEnd = (body.dateEnd ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) return { ok: false, error: 'invalid-dates' };
    if (dateEnd < dateStart) return { ok: false, error: 'invalid-dates' };
    const note = (body.note ?? '').trim();

    const halfDay = body.halfDay === true;
    if (halfDay && dateEnd !== dateStart) return { ok: false, error: 'half-day-requires-single-day' };
    const absenceType = (body.absenceType ?? 'vacation').trim() || 'vacation';
    if (!(await resolveAbsenceTypes(db, orgId)).has(absenceType)) return { ok: false, error: 'invalid-absence-type' };

    // Range overlap: an existing pending/approved request overlaps [dateStart, dateEnd] when
    // its own start is on or before our end, and its own end is on or after our start.
    const [overlap] = await db
      .select({ id: absences.id })
      .from(absences)
      .where(
        and(
          eq(absences.organization_id, orgId),
          eq(absences.user_id, callerId),
          inArray(absences.status, ['pending', 'approved']),
          lte(absences.date_start, dateEnd),
          gte(absences.date_end, dateStart),
        ),
      );
    if (overlap) return { ok: false, error: 'overlapping-request' };

    const now = new Date().toISOString();
    const managerUserId = await membershipManagerId(db, orgId, callerId);
    const autoApproved = !managerUserId;
    const reviewFields = autoApproved
      ? { status: 'approved' as const, reviewed_by_user_id: callerId, reviewed_at: now }
      : { status: 'pending' as const, reviewed_by_user_id: null, reviewed_at: null };

    const values = { organization_id: orgId, user_id: callerId, date_start: dateStart, date_end: dateEnd, absence_type: absenceType, half_day: halfDay, note: note || null, ...reviewFields };
    const [created] = await db.insert(absences).values(values).returning({ id: absences.id });
    void this.versions.record('absences', created.id, 'insert', callerId, { id: created.id, ...values }).catch(() => {});
    void this.audit
      .record(orgId, callerId, autoApproved ? 'absence.submit-auto-approved' : 'absence.submit', 'absence', created.id, { dateStart, dateEnd, absenceType, halfDay, note: note || undefined })
      .catch(() => {});

    if (autoApproved) {
      await this.balances.applyAbsenceApproval(db, created.id);
    } else if (managerUserId) {
      const definition = await this.workflowsSvc.ensureDefinition(db, orgId, APPROVE_ABSENCE_WORKFLOW_NAME, "A vacation request awaiting the employee's manager to approve or reject it.", [
        {
          key: 'manager_review',
          label: 'Manager review',
          assignTo: 'manager',
          onApprove: { action: 'absence.approve' },
          onReject: { action: 'absence.reject' },
          source: 'Vacation Request',
          source_name: 'getAbsenceTitle',
        },
      ]);
      await this.workflowsSvc.createWorkflow(db, {
        workflowDefId: definition.workflow_def_id,
        sourceTable: 'absences',
        sourceTableUuid: created.id,
        step: 'manager_review',
        assignedToUserId: [managerUserId],
        workflowData: { note: note || null },
        actorUserId: callerId,
        notification: { title: 'New vacation request to review', body: note || undefined },
      });
    }

    return { ok: true, id: created.id, autoApproved };
  }

  @Get('organizations/:orgId/absences')
  async list(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return [];

    const isAdmin = await isOrgAdmin(db, orgId, callerId);
    const conditions: SQL[] = [eq(absences.organization_id, orgId)];
    if (userId) {
      if (userId !== callerId && !isAdmin && !(await isManagerOf(db, orgId, callerId, userId))) return [];
      conditions.push(eq(absences.user_id, userId));
    } else if (!isAdmin) {
      const reportIds = await directReportUserIds(db, orgId, callerId);
      conditions.push(inArray(absences.user_id, [callerId, ...reportIds]));
    }
    if (status && (STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(absences.status, status as Status));
    }

    return db
      .select({
        id: absences.id,
        user_id: absences.user_id,
        date_start: absences.date_start,
        date_end: absences.date_end,
        status: absences.status,
        absence_type: absences.absence_type,
        half_day: absences.half_day,
        document_id: absences.document_id,
        note: absences.note,
        review_note: absences.review_note,
        reviewed_at: absences.reviewed_at,
        user_display_name: users.display_name,
        user_email: users.email,
      })
      .from(absences)
      .innerJoin(users, eq(users.id, absences.user_id))
      .where(and(...conditions))
      .orderBy(desc(absences.date_start));
  }

  /** Caller cancels their own still-pending request. */
  @Delete('absences/:id')
  async cancel(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const [row] = await db.select({ user_id: absences.user_id, status: absences.status }).from(absences).where(eq(absences.id, id));
    if (!row) return { ok: false, error: 'not-found' };
    if (row.user_id !== callerId) return { ok: false, error: 'forbidden' };
    if (row.status !== 'pending') return { ok: false, error: 'not-pending' };

    // Drop it from the manager's Approvals queue without going through resolve() — the requester
    // isn't the assignee, so resolve() would (correctly) reject them.
    const pending = await this.workflowsSvc.findPending(db, 'absences', id, APPROVE_ABSENCE_WORKFLOW_NAME);
    if (pending) {
      await db.update(workflows).set({ step_status: 'cancelled', workflow_finished: new Date().toISOString() }).where(eq(workflows.workflow_id, pending.id));
    }

    await db.delete(absences).where(eq(absences.id, id));
    void this.audit.record(row.user_id, callerId, 'absence.cancel', 'absence', id).catch(() => {});
    return { ok: true };
  }

  /** Evidence upload for an absence (e.g. a doctor's note) — the requester or an org admin. Replaces any existing one. */
  @Post('organizations/:orgId/absences/:id/document')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async uploadDocument(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!file) return { ok: false, error: 'file-required' };

    const [absence] = await db.select({ user_id: absences.user_id, organization_id: absences.organization_id, document_id: absences.document_id }).from(absences).where(eq(absences.id, id));
    if (!absence || absence.organization_id !== orgId) return { ok: false, error: 'not-found' };
    if (absence.user_id !== callerId && !(await isOrgAdmin(db, orgId, callerId))) return { ok: false, error: 'forbidden' };

    const newDocId = await this.documents.upload(db, orgId, callerId, file, { table: 'absences', id });
    await db.update(absences).set({ document_id: newDocId }).where(eq(absences.id, id));
    if (absence.document_id) await this.documents.remove(db, absence.document_id);
    void this.audit.record(orgId, callerId, 'absence.document.upload', 'absence', id, { fileName: file.originalname }).catch(() => {});
    return { ok: true, id: newDocId };
  }

  @Get('organizations/:orgId/absences/:id/document')
  async getDocument(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return null;
    const [absence] = await db.select({ user_id: absences.user_id, organization_id: absences.organization_id, document_id: absences.document_id }).from(absences).where(eq(absences.id, id));
    if (!absence || absence.organization_id !== orgId || !absence.document_id) return null;
    if (!(await isOwnerAdminOrManagerOf(db, orgId, callerId, absence.user_id))) return null;

    const doc = await this.documents.get(db, absence.document_id);
    if (!doc) return null;
    return { id: doc.id, file_name: doc.file_name, mime_type: doc.mime_type, size_bytes: doc.size_bytes, created_at: doc.created_at };
  }

  @Get('absences/:id/document')
  async downloadDocument(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const db = this.db.getDb();
    const callerId = db && req.user ? await callerUserId(db, req.user) : null;
    if (!db || !callerId) {
      res.status(401).json({ ok: false, error: 'unauthenticated' });
      return;
    }
    const [absence] = await db.select({ user_id: absences.user_id, organization_id: absences.organization_id, document_id: absences.document_id }).from(absences).where(eq(absences.id, id));
    if (!absence?.document_id) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    if (!(await isOwnerAdminOrManagerOf(db, absence.organization_id, callerId, absence.user_id))) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    const doc = await this.documents.get(db, absence.document_id);
    if (!doc) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    res.set({ 'Content-Type': doc.mime_type, 'Content-Disposition': `attachment; filename="${doc.file_name.replace(/"/g, '')}"` });
    createReadStream(join(DOCUMENTS_ROOT, doc.storage_path)).pipe(res);
  }

  /** Caller removes the evidence document: the requester while their absence is still pending, or an org admin any time. */
  @Delete('absences/:id/document')
  async deleteDocument(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };

    const [absence] = await db.select({ user_id: absences.user_id, organization_id: absences.organization_id, status: absences.status, document_id: absences.document_id }).from(absences).where(eq(absences.id, id));
    if (!absence?.document_id) return { ok: false, error: 'not-found' };
    const isOwnerPending = absence.user_id === callerId && absence.status === 'pending';
    if (!isOwnerPending && !(await isOrgAdmin(db, absence.organization_id, callerId))) return { ok: false, error: 'forbidden' };

    await db.update(absences).set({ document_id: null }).where(eq(absences.id, id));
    await this.documents.remove(db, absence.document_id);
    void this.audit.record(absence.organization_id, callerId, 'absence.document.delete', 'absence', id).catch(() => {});
    return { ok: true };
  }
}
