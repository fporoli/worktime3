import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { FORMS, GROUPS_KEY, mergeForm, type FormLayer, type GroupOverride, type FieldOverride, type ResolvedForm } from '@worktime3/shared/fields';
import { DbService, type Db } from './db.service';
import type { Executor } from './access';

/** The layers of one form as stored, for the design panel and for merging. */
export interface FormLayers {
  global: FormLayer;
  org: FormLayer;
}

function emptyLayer(): FormLayer {
  return { fields: {}, groups: {} };
}

/** Reads the global and the org layer of a form from `field_config`. */
export async function loadLayers(db: Executor, organizationId: string | null, formId: string): Promise<FormLayers> {
  const rows = await db.execute(
    sql`SELECT organization_id, field_key, config FROM field_config
        WHERE form_id = ${formId} AND (organization_id IS NULL OR organization_id = ${organizationId})`,
  );
  const layers: FormLayers = { global: emptyLayer(), org: emptyLayer() };
  for (const row of rows.rows as Record<string, unknown>[]) {
    const layer = row.organization_id ? layers.org : layers.global;
    const key = row.field_key as string;
    if (key === GROUPS_KEY) layer.groups = ((row.config as { groups?: Record<string, GroupOverride> }).groups ?? {});
    else layer.fields[key] = row.config as FieldOverride;
  }
  return layers;
}

/**
 * Merged form templates (code defaults, global template, org template), cached per org and form.
 * Writes go through `saveOverride` / `removeOverride`, which clear the cache.
 */
@Injectable()
export class FieldsService {
  private readonly cache = new Map<string, ResolvedForm>();

  constructor(private readonly db: DbService) {}

  /** The merged form for an org; the code defaults when offline. Null for an unknown form. */
  async resolved(organizationId: string, formId: string): Promise<ResolvedForm | null> {
    const form = FORMS[formId];
    if (!form) return null;
    const cacheKey = `${organizationId}/${formId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const db = this.db.getDb();
    if (!db) return mergeForm(form);
    const layers = await loadLayers(db, organizationId, formId);
    const merged = mergeForm(form, layers.global, layers.org);
    this.cache.set(cacheKey, merged);
    return merged;
  }

  /** Inserts or replaces one layer's config for a field (or `$groups`). Returns the row id. */
  async saveOverride(db: Db, organizationId: string | null, formId: string, fieldKey: string, config: unknown): Promise<string> {
    const json = JSON.stringify(config);
    const rows = await db.execute(
      sql`INSERT INTO field_config (organization_id, form_id, field_key, config)
          VALUES (${organizationId}, ${formId}, ${fieldKey}, ${json}::jsonb)
          ON CONFLICT ((COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)), form_id, field_key)
          DO UPDATE SET config = EXCLUDED.config
          RETURNING id`,
    );
    this.invalidate(organizationId, formId);
    return rows.rows[0].id as string;
  }

  /** Deletes one layer's config for a field, so it inherits again. Returns the deleted row id, if any. */
  async removeOverride(db: Db, organizationId: string | null, formId: string, fieldKey: string): Promise<string | null> {
    const rows = await db.execute(
      sql`DELETE FROM field_config
          WHERE COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
                = COALESCE(${organizationId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
            AND form_id = ${formId} AND field_key = ${fieldKey}
          RETURNING id`,
    );
    this.invalidate(organizationId, formId);
    return (rows.rows[0]?.id as string) ?? null;
  }

  /** Drops cached merges: one org's for an org write, every org's for a global write. */
  invalidate(organizationId: string | null, formId: string) {
    if (organizationId) {
      this.cache.delete(`${organizationId}/${formId}`);
      return;
    }
    for (const key of [...this.cache.keys()]) if (key.endsWith(`/${formId}`)) this.cache.delete(key);
  }
}
