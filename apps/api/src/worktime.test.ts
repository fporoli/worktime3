import { strict as assert } from 'node:assert';
import { test } from 'node:test';

function bucket(entries: Array<{ startTime: string; endTime: string }>, mode: 'daily' | 'weekly' | 'monthly') {
  const out: Record<string, number> = {};
  for (const e of entries) {
    const d = new Date(e.startTime);
    let key: string;
    if (mode === 'daily') key = d.toISOString().slice(0, 10);
    else if (mode === 'monthly') key = d.toISOString().slice(0, 7);
    else {
      const m = new Date(d);
      m.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      key = m.toISOString().slice(0, 10);
    }
    out[key] = (out[key] ?? 0) + (new Date(e.endTime).getTime() - d.getTime()) / 60000;
  }
  return out;
}

test('daily/weekly/monthly buckets', () => {
  const entries = [
    { startTime: '2026-09-01T08:00:00Z', endTime: '2026-09-01T09:00:00Z' },
    { startTime: '2026-09-02T08:00:00Z', endTime: '2026-09-02T08:30:00Z' },
  ];
  assert.deepEqual(bucket(entries, 'daily'), { '2026-09-01': 60, '2026-09-02': 30 });
  assert.deepEqual(bucket(entries, 'monthly'), { '2026-09': 90 });
  assert.equal(Object.keys(bucket(entries, 'weekly')).length, 1);
});
