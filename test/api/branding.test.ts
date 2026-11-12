import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateBranding } from '@worktime3/shared/branding';
import { OrgsController, brandingForLog } from '../../apps/api/src/orgs.controller';
import type { DbService } from '../../apps/api/src/db.service';
import type { AuditService } from '../../apps/api/src/audit.service';
import type { VersionsService } from '../../apps/api/src/versions.service';
import type { AuthenticatedRequest } from '../../apps/api/src/jwt.guard';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function sqlText(query: any): string {
  return (query.queryChunks ?? []).map((c: any) => (Array.isArray(c?.value) ? c.value.join('') : '?')).join('');
}

/**
 * OrgsController over a fake db. `permissions` are the caller's permission ids in the org
 * (an empty list = not a member); `settings` is the stored organizations.settings.
 */
function setup(opts: { permissions?: string[]; member?: boolean; settings?: Record<string, unknown>; offline?: boolean }) {
  const updates: any[] = [];
  const audits: any[] = [];
  const member = opts.member ?? true;
  const rows = member ? (opts.permissions?.length ? opts.permissions : [null]).map((permission_id) => ({ name: 'member', permission_id })) : [];
  const selectChain: any = {
    from: () => selectChain,
    where: () => Promise.resolve([{ settings: opts.settings ?? {} }]),
  };
  const db = {
    execute: async (q: unknown) => (sqlText(q).includes('JOIN membership_roles') ? { rows } : { rows: [] }),
    select: () => selectChain,
    update: () => ({
      set: (patch: any) => ({
        where: () => ({
          returning: async () => {
            updates.push(patch);
            return [{ id: 'org-1' }];
          },
        }),
      }),
    }),
  };
  const dbService = { getDb: () => (opts.offline ? null : db) } as unknown as DbService;
  const audit = { record: async (...args: unknown[]) => void audits.push(args) } as unknown as AuditService;
  const versions = { record: async () => {} } as unknown as VersionsService;
  const controller = new OrgsController(dbService, audit, versions);
  const req = { user: { kind: 'local', sub: 'user-1' } } as unknown as AuthenticatedRequest;
  return { controller, req, updates, audits };
}

test('getBranding returns the stored branding to members, dropping invalid fields', async () => {
  const { controller, req } = setup({ settings: { branding: { headerColor: '#AA0000', sidebarColor: 'red', logo: PNG } } });
  assert.deepEqual(await controller.getBranding('org-1', req), { ok: true, branding: { headerColor: '#aa0000', logo: PNG } });
});

test('getBranding is empty for non-members and offline', async () => {
  const outsider = setup({ member: false, settings: { branding: { headerColor: '#aa0000' } } });
  assert.deepEqual(await outsider.controller.getBranding('org-1', outsider.req), { ok: true, branding: {} });
  const offline = setup({ offline: true });
  assert.deepEqual(await offline.controller.getBranding('org-1', offline.req), { ok: true, offline: true, branding: {} });
});

test('setBranding needs Organization settings edit', async () => {
  const { controller, req, updates } = setup({ permissions: ['nav.orgSettings:see:all'] });
  assert.deepEqual(await controller.setBranding('org-1', { headerColor: '#112233' }, req), { ok: false, error: 'forbidden' });
  assert.equal(updates.length, 0);
});

test('setBranding validates before writing', async () => {
  const { controller, req, updates } = setup({ permissions: ['nav.orgSettings:edit:all'] });
  assert.deepEqual(await controller.setBranding('org-1', { headerColor: 'blue' }, req), { ok: false, error: 'invalid-color' });
  assert.deepEqual(await controller.setBranding('org-1', { logo: 'https://x/logo.png' }, req), { ok: false, error: 'invalid-logo' });
  assert.equal(updates.length, 0);
});

test('setBranding saves the normalized branding and logs the logo by size only', async () => {
  const { controller, req, updates, audits } = setup({ permissions: ['nav.orgSettings:edit:all'] });
  const result = await controller.setBranding('org-1', { headerColor: '#ABCDEF', backgroundColor: '', logo: PNG }, req);
  assert.deepEqual(result, { ok: true, branding: { headerColor: '#abcdef', logo: PNG } });
  assert.equal(updates.length, 1);
  await new Promise((r) => setImmediate(r));
  assert.equal(audits.length, 1);
  assert.equal(audits[0][2], 'organization.branding');
  assert.doesNotMatch(JSON.stringify(audits[0][5]), /base64/);
});

test('brandingForLog replaces the logo by its length', () => {
  assert.deepEqual(brandingForLog({ headerColor: '#000000', logo: PNG }), { headerColor: '#000000', logo: `<image, ${PNG.length} chars>` });
  assert.deepEqual(brandingForLog({}), {});
});

test('seeded branding is valid and its logos match infra/postgres/seeds/branding/*.svg', () => {
  const seedDir = join(__dirname, '../../infra/postgres/seeds');
  const seed = readFileSync(join(seedDir, 'seed.sql'), 'utf8');
  const rows = [...seed.matchAll(/\('([0-9a-f-]{36})', '(\{"headerColor".*?\})'\)/g)];
  assert.equal(rows.length, 2, 'Acme and Globx branding rows');
  const logos: Record<string, string> = { 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': 'acme.svg', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee': 'globx.svg' };
  for (const [, orgId, json] of rows) {
    const result = validateBranding(JSON.parse(json));
    assert.ok(result.ok, `${orgId}: ${JSON.stringify(result)}`);
    const svg = readFileSync(join(seedDir, 'branding', logos[orgId]), 'utf8');
    assert.equal(result.branding.logo, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, `${logos[orgId]} changed: regenerate its data URL in seed.sql`);
  }
});
