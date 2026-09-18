import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db.service';
import { documents } from './db/schema';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
// Resolved relative to this compiled file (dist/documents.service.js), so storage location
// doesn't depend on the process's working directory. Override with DOCUMENTS_DIR.
export const DOCUMENTS_ROOT = process.env.DOCUMENTS_DIR ?? join(__dirname, '..', 'data', 'documents');

/**
 * Generic evidence-document storage (local disk + a `documents` metadata row), reused by any
 * record that needs at most one attachment — an absence's doctor's note, an expense's pay slip.
 * The owning record (absences/expenses) holds a nullable `document_id` FK; this service doesn't
 * know or care which table that is.
 */
@Injectable()
export class DocumentsService {
  /**
   * Writes the file to disk and inserts its metadata row; returns the new document id.
   * `sourceTable`/`sourceTableId` are a diagnostic-only reverse pointer to whatever row this
   * upload is for (e.g. `('absences', <absence id>)`) — access control still goes through that
   * row's own `document_id` FK, not through these.
   */
  async upload(
    db: Db,
    organizationId: string,
    uploadedByUserId: string,
    file: Express.Multer.File,
    source: { table: string; id: string },
  ): Promise<string> {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(-200) || 'document';
    const storedName = `${randomUUID()}-${safeName}`;
    const relativePath = join(organizationId, storedName);
    await mkdir(join(DOCUMENTS_ROOT, organizationId), { recursive: true });
    await writeFile(join(DOCUMENTS_ROOT, relativePath), file.buffer);

    const [row] = await db
      .insert(documents)
      .values({
        organization_id: organizationId,
        file_name: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        storage_path: relativePath,
        source_table: source.table,
        source_table_id: source.id,
        uploaded_by_user_id: uploadedByUserId,
      })
      .returning({ id: documents.id });
    return row.id;
  }

  async get(db: Db, documentId: string) {
    const [row] = await db.select().from(documents).where(eq(documents.id, documentId));
    return row;
  }

  /** Deletes the metadata row and best-effort removes the file. Safe to call with a stale/missing id. */
  async remove(db: Db, documentId: string): Promise<void> {
    const [row] = await db.select({ storage_path: documents.storage_path }).from(documents).where(eq(documents.id, documentId));
    await db.delete(documents).where(eq(documents.id, documentId));
    if (row) await unlink(join(DOCUMENTS_ROOT, row.storage_path)).catch(() => {});
  }
}
