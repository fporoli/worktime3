export interface TimeRange {
  startTime: string;
  endTime: string;
}

/** Whole minutes across every entry. */
export function minutesOf(entries: TimeRange[]): number {
  return entries.reduce(
    (sum, e) => sum + (new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 60000,
    0,
  );
}

/** Daily / weekly / monthly minute buckets, keyed by the bucket's start date. */
export function bucket(entries: TimeRange[], mode: 'daily' | 'weekly' | 'monthly'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    const d = new Date(e.startTime);
    let key: string;
    if (mode === 'daily') key = d.toISOString().slice(0, 10);
    else if (mode === 'monthly') key = d.toISOString().slice(0, 7);
    else {
      const monday = new Date(d);
      const day = (d.getUTCDay() + 6) % 7;
      monday.setUTCDate(d.getUTCDate() - day);
      key = monday.toISOString().slice(0, 10);
    }
    const mins = (new Date(e.endTime).getTime() - d.getTime()) / 60000;
    out[key] = (out[key] ?? 0) + mins;
  }
  return out;
}
