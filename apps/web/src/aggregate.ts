export type View = 'daily' | 'weekly' | 'monthly';

export interface Entry {
  id: string;
  start_time: string;
  end_time: string;
  comment?: string;
  project_id?: string | null;
  subproject_id?: string | null;
  /** Joined by the API list endpoint so rows render without a lookup. */
  project_name?: string | null;
  subproject_name?: string | null;
}

export function minutes(e: Entry): number {
  return (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000;
}

export function bucket(entries: Entry[], view: View): { label: string; minutes: number }[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    const d = new Date(e.start_time);
    let key: string;
    if (view === 'daily') key = d.toISOString().slice(0, 10);
    else if (view === 'monthly') key = d.toISOString().slice(0, 7);
    else {
      const m = new Date(d);
      m.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      key = m.toISOString().slice(0, 10);
    }
    map.set(key, (map.get(key) ?? 0) + minutes(e));
  }
  return [...map.entries()].map(([label, mins]) => ({ label, minutes: mins })).sort((a, b) => (a.label < b.label ? -1 : 1));
}

/** A single day, a Mon-Sun week, or a calendar month — the granularity of the worktime period selector. */
export type PeriodType = 'day' | 'week' | 'month';

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Today as 'YYYY-MM-DD' in local time. */
export function todayDate(): string {
  return dateKey(new Date());
}

/** Monday of the local week containing `dateStr` ('YYYY-MM-DD' in, 'YYYY-MM-DD' out). */
export function startOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dateKey(date);
}

/** Move `anchor` ('YYYY-MM-DD') by `delta` periods of `type`, in local time. */
export function shiftPeriod(type: PeriodType, anchor: string, delta: number): string {
  const [y, m, d] = anchor.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (type === 'day') date.setDate(date.getDate() + delta);
  else if (type === 'week') date.setDate(date.getDate() + delta * 7);
  else date.setMonth(date.getMonth() + delta);
  return dateKey(date);
}

/** The [from, to) local-time instants, as ISO strings, of the period of `type` containing `anchor`. */
export function periodRange(type: PeriodType, anchor: string): { from: string; to: string } {
  const [y, m, d] = anchor.split('-').map(Number);
  let start: Date;
  let end: Date;
  if (type === 'day') {
    start = new Date(y, m - 1, d);
    end = new Date(y, m - 1, d + 1);
  } else if (type === 'week') {
    const [wy, wm, wd] = startOfWeek(anchor).split('-').map(Number);
    start = new Date(wy, wm - 1, wd);
    end = new Date(wy, wm - 1, wd + 7);
  } else {
    start = new Date(y, m - 1, 1);
    end = new Date(y, m, 1);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

/** A human-readable label for the period of `type` containing `anchor`. */
export function periodLabel(type: PeriodType, anchor: string): string {
  const [y, m, d] = anchor.split('-').map(Number);
  if (type === 'month') {
    return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  }
  if (type === 'day') {
    return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  const [wy, wm, wd] = startOfWeek(anchor).split('-').map(Number);
  const weekStart = new Date(wy, wm - 1, wd);
  const weekEnd = new Date(wy, wm - 1, wd + 6);
  const fmt = (dt: Date) => dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${fmt(weekStart)} – ${fmt(weekEnd)}, ${weekEnd.getFullYear()}`;
}
