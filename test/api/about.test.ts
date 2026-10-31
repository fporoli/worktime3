import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AboutController, buildInfo, databaseInfo } from '../../apps/api/src/about.controller';
import type { DbService } from '../../apps/api/src/db.service';

test('buildInfo reads the values baked into the image', () => {
  const info = buildInfo({ BUILD_RELEASE: 'v1.2.0', BUILD_COMMIT: 'abc123', BUILD_DATE: '2026-10-31T08:00:00+01:00' });
  assert.deepEqual(info, { release: 'v1.2.0', commit: 'abc123', date: '2026-10-31T08:00:00+01:00' });
});

test('buildInfo treats unset and empty build args as unknown', () => {
  // A Dockerfile `ENV X=$X` with no build arg yields an empty string, not an unset variable.
  assert.deepEqual(buildInfo({ BUILD_RELEASE: '', BUILD_COMMIT: '' }), { release: null, commit: null, date: null });
});

test('databaseInfo reports the last applied changeset', async () => {
  const db = { execute: async () => ({ rows: [{ filename: 'changelog/040-example.sql' }] }) };
  assert.deepEqual(await databaseInfo(db as never), { status: 'ok', lastChangeset: 'changelog/040-example.sql' });
});

test('databaseInfo distinguishes offline mode from a failing database', async () => {
  assert.deepEqual(await databaseInfo(null), { status: 'offline', lastChangeset: null });
  const db = { execute: async () => { throw new Error('connection refused'); } };
  assert.deepEqual(await databaseInfo(db as never), { status: 'unavailable', lastChangeset: null });
});

test('about still answers in offline mode and exposes no configuration', async () => {
  const controller = new AboutController({ getDb: () => null } as unknown as DbService);
  const result = await controller.about();
  assert.equal(result.ok, true);
  assert.equal(result.database.status, 'offline');
  assert.deepEqual(Object.keys(result.server).sort(), ['environment', 'hostname', 'nodeVersion', 'startedAt', 'time', 'timeZone']);
});
