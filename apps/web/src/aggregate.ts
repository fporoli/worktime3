export type View = 'daily' | 'weekly' | 'monthly';

export interface Entry {
  id: string;
  start_time: string;
  end_time: string;
  comment?: string;
  project_id?: string | null;
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
