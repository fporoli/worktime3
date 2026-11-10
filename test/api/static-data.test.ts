import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { StaticDataController, resolveEffectiveStaticData } from '../../apps/api/src/static-data.controller';
import type { DbService } from '../../apps/api/src/db.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
import type { AuthenticatedRequest } from '../../apps/api/src/types';

function sqlText(query: any): string {
  return (query.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}

function setupStaticData(opts: {
  roles?: string[];
  superdeveloper?: boolean;
  existingRow?: { id: string; organization_id: string | null } | null;
  insertError?: unknown;
}) {
  const inserted: any[] = [];
  const updated: any[] = [];
  const deleted: number[] = [];

  const selectResult = opts.existingRow ? [opts.existingRow] : [];
  const selectChain: any = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => Promise.resolve(selectResult),
    then: (resolve: (v: any) => void, reject?: (e: unknown) => void) => Promise.resolve(selectResult).then(resolve, reject),
  };

  const db = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      if (text.includes('JOIN membership_roles')) return { rows: (opts.roles ?? []).map((name) => ({ name })) };
      if (text.includes('is_superdeveloper')) return { rows: [{ is_superdeveloper: !!opts.superdeveloper }] };
      return { rows: [] };
    },
    select: () => selectChain,
    insert: () => ({
      values: (v: any) => ({
        returning: async () => {
          if (opts.insertError) throw opts.insertError;
          inserted.push(v);
          return [{ id: 'sd-new' }];
        },
      }),
    }),
    update: () => ({
      set: (patch: any) => ({
        where: async () => {
          updated.push(patch);
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        deleted.push(1);
      },
    }),
  };

  const dbService = { getDb: () => db } as unknown as DbService;
  const versions = { record: async () => {} } as unknown as VersionsService;
  const controller = new StaticDataController(dbService, versions);
  const req = { user: { kind: 'local', sub: 'user-1' } } as unknown as AuthenticatedRequest;
  return { controller, req, inserted, updated, deleted };
}

test('resolveEffectiveStaticData inherits global rows and overrides them with org rows', () => {
  const globalLocales = { id: 'g1', organization_id: null, entity: 'users', enum_name: 'locales' };
  const globalCountries = { id: 'g2', organization_id: null, entity: 'users', enum_name: 'countries' };
  const orgLocales = { id: 'o1', organization_id: 'org-1', entity: 'users', enum_name: 'locales' };
  const orgCustom = { id: 'o2', organization_id: 'org-1', entity: 'projects', enum_name: 'project_type' };

  // Test both orders (org before global, global before org)
  for (const input of [
    [globalLocales, globalCountries, orgLocales, orgCustom],
    [orgLocales, orgCustom, globalLocales, globalCountries],
  ]) {
    const effective = resolveEffectiveStaticData(input, 'org-1');
    assert.deepEqual(
      effective.map((r) => r.id).sort(),
      ['g2', 'o1', 'o2'],
    );
  }
});

test('StaticDataController.globalAccess reflects superdeveloper status', async () => {
  const admin = setupStaticData({ roles: ['admin'], superdeveloper: false });
  assert.deepEqual(await admin.controller.globalAccess('org-1', admin.req), { ok: true, canEditGlobal: false });

  const superDev = setupStaticData({ roles: ['admin'], superdeveloper: true });
  assert.deepEqual(await superDev.controller.globalAccess('org-1', superDev.req), { ok: true, canEditGlobal: true });
});

test('StaticDataController.create gates global writes to superdevelopers and handles duplicates', async () => {
  const orgAdmin = setupStaticData({ roles: ['admin'], superdeveloper: false });
  assert.deepEqual(
    await orgAdmin.controller.create('org-1', { scope: 'global', entity: 'users', enumName: 'locales', values: {} }, orgAdmin.req),
    { ok: false, error: 'forbidden' },
  );
  assert.equal(orgAdmin.inserted.length, 0);

  assert.deepEqual(
    await orgAdmin.controller.create('org-1', { entity: 'projects', enumName: 'project_type', values: { a: 'A' } }, orgAdmin.req),
    { ok: true, id: 'sd-new' },
  );
  assert.equal(orgAdmin.inserted[0].organization_id, 'org-1');

  const superDev = setupStaticData({ roles: [], superdeveloper: true });
  assert.deepEqual(
    await superDev.controller.create('org-1', { scope: 'global', entity: 'users', enumName: 'locales', values: { de: 'Deutsch' } }, superDev.req),
    { ok: true, id: 'sd-new' },
  );
  assert.equal(superDev.inserted[0].organization_id, null);

  const dup = setupStaticData({ roles: ['admin'], insertError: { code: '23505' } });
  assert.deepEqual(
    await dup.controller.create('org-1', { entity: 'projects', enumName: 'project_type', values: {} }, dup.req),
    { ok: false, error: 'duplicate-enum' },
  );
});

test('StaticDataController.update and remove enforce org vs global ownership', async () => {
  // Org admin cannot edit or delete global rows or another org's rows
  const adminGlobal = setupStaticData({ roles: ['admin'], superdeveloper: false, existingRow: { id: 'g1', organization_id: null } });
  assert.deepEqual(await adminGlobal.controller.update('org-1', 'g1', { values: { en: 'English' } }, adminGlobal.req), {
    ok: false,
    error: 'forbidden',
  });
  assert.deepEqual(await adminGlobal.controller.remove('org-1', 'g1', adminGlobal.req), { ok: false, error: 'forbidden' });

  const adminOtherOrg = setupStaticData({ roles: ['admin'], superdeveloper: false, existingRow: { id: 'o9', organization_id: 'org-9' } });
  assert.deepEqual(await adminOtherOrg.controller.update('org-1', 'o9', { values: {} }, adminOtherOrg.req), {
    ok: false,
    error: 'forbidden',
  });
  assert.deepEqual(await adminOtherOrg.controller.remove('org-1', 'o9', adminOtherOrg.req), { ok: false, error: 'forbidden' });

  // Missing row returns not-found
  const missing = setupStaticData({ roles: ['admin'], existingRow: null });
  assert.deepEqual(await missing.controller.update('org-1', 'missing', { values: {} }, missing.req), {
    ok: false,
    error: 'not-found',
  });

  // Superdeveloper can edit and delete global rows
  const superDevGlobal = setupStaticData({ roles: [], superdeveloper: true, existingRow: { id: 'g1', organization_id: null } });
  assert.deepEqual(await superDevGlobal.controller.update('org-1', 'g1', { values: { ch: 'CH' } }, superDevGlobal.req), { ok: true });
  assert.equal(superDevGlobal.updated.length, 1);
  assert.deepEqual(await superDevGlobal.controller.remove('org-1', 'g1', superDevGlobal.req), { ok: true });
  assert.equal(superDevGlobal.deleted.length, 1);
});
