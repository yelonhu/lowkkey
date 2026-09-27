import type { Entry, LocalDate, SessionEntry, SetEntry, WeightEntry } from '@lowkkey/protocol';

/** 被撤销的条目 id 集合。 */
export function revertedIds(entries: Entry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) if (e.kind === 'revert') out.add(e.targetId);
  return out;
}

/** 有效条目：未被撤销，且不含 revert 本身。 */
export function active(entries: Entry[]): Exclude<Entry, { kind: 'revert' }>[] {
  const gone = revertedIds(entries);
  return entries.filter((e): e is Exclude<Entry, { kind: 'revert' }> => e.kind !== 'revert' && !gone.has(e.id));
}

export function weights(entries: Entry[]): WeightEntry[] {
  return active(entries)
    .filter((e): e is WeightEntry => e.kind === 'weight')
    .sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
}

/** 每天只取最后一次称重（同日多条时以最后写入为准）。 */
export function dailyWeights(entries: Entry[]): WeightEntry[] {
  const byDate = new Map<LocalDate, WeightEntry>();
  for (const w of weights(entries)) byDate.set(w.date, w);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 某日当天或之前最近一次体重（kg）。 */
export function bodyweightOn(entries: Entry[], date: LocalDate): WeightEntry | null {
  let hit: WeightEntry | null = null;
  for (const w of dailyWeights(entries)) if (w.date <= date) hit = w;
  return hit;
}

export type Session = {
  id: string;
  date: LocalDate;
  dayId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  sets: SetEntry[];
};

/** 把 session 事件与组聚合成训练。没有 start 事件的组（如事后补录）也会成组。 */
export function sessions(entries: Entry[]): Session[] {
  const map = new Map<string, Session>();
  const ensure = (id: string, date: LocalDate) => {
    let s = map.get(id);
    if (!s) {
      s = { id, date, dayId: null, startedAt: null, endedAt: null, sets: [] };
      map.set(id, s);
    }
    return s;
  };
  for (const e of active(entries)) {
    if (e.kind === 'session') {
      const s = ensure(e.sessionId, e.date);
      const ev = e as SessionEntry;
      if (ev.event === 'start') {
        s.startedAt = ev.createdAt;
        s.dayId = ev.dayId;
      } else s.endedAt = ev.createdAt;
    } else if (e.kind === 'set') {
      ensure(e.sessionId, e.date).sets.push(e);
    }
  }
  return [...map.values()]
    .filter((s) => s.sets.length > 0 || s.startedAt)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
}

export function openSession(entries: Entry[]): Session | null {
  const list = sessions(entries);
  const last = list[list.length - 1];
  return last && last.startedAt && !last.endedAt ? last : null;
}
