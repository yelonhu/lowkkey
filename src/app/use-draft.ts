import { useEffect, useRef, useState } from 'react';
import type { LocalDatabase, LocalDraft } from '../client/local-database.ts';
import { localDateSchema, revisionSchema, uuidSchema } from '../domain/primitives.ts';

/** Raw input is independent of submitted commands and the shared entity cache.
 * Serialize saves so a slow earlier edit cannot overwrite newer input. */
export function useDraft<T extends Record<string, string>>(database: LocalDatabase, id: string, kind: LocalDraft['kind'], defaults: T, timezone: string) {
  const [fields, setFields] = useState(defaults), [ready, setReady] = useState(false), [error, setError] = useState(false), [saved, setSaved] = useState(false);
  const current = useRef(defaults), initial = useRef(defaults), timer = useRef<ReturnType<typeof setTimeout> | null>(null), writing = useRef<Promise<void>>(Promise.resolve()), dirty = useRef(false), alive = useRef(true);
  const persist = useRef<() => Promise<{ id: string; updatedAt: string } | undefined>>(async () => undefined);
  const lastSaved = useRef<{ id: string; updatedAt: string } | undefined>(undefined);
  persist.current = async () => {
    if (timer.current !== null) clearTimeout(timer.current); timer.current = null;
    if (!dirty.current) { await writing.current; return lastSaved.current; }
    const rawFields = { ...current.current }, updatedAt = new Date().toISOString(); dirty.current = false;
    const targetId = uuidSchema.safeParse(rawFields.targetId), revision = revisionSchema.safeParse(Number(rawFields.targetRevision));
    const draft: LocalDraft = { id, ownerId: database.ownerId, kind, rawFields, baseRefs: kind === 'weight' && targetId.success && revision.success ? [{ type: 'weight_entry', id: targetId.data, revision: revision.data }] : [], localDate: localDateSchema.safeParse(rawFields.date).success ? rawFields.date : null, entryTimezone: timezone, updatedAt };
    const save = writing.current.catch(() => { /* The previous failure is already visible; retry the newest input. */ }).then(() => database.saveDraft(draft));
    writing.current = save;
    try { await save; lastSaved.current = { id, updatedAt }; if (alive.current) { setError(false); setSaved(true); } return lastSaved.current; }
    catch (failure) { dirty.current = true; if (alive.current) { setError(true); setSaved(false); } throw failure; }
  };
  useEffect(() => {
    alive.current = true; let cancelled = false;
    void database.readDraft(id).then(draft => {
      if (cancelled) return;
      if (draft) { const value = Object.fromEntries(Object.keys(initial.current).map(key => [key, draft.rawFields[key] ?? initial.current[key]])) as T; current.current = value; lastSaved.current = { id, updatedAt: draft.updatedAt }; setFields(value); setSaved(true); }
      setReady(true);
    }).catch(() => { if (!cancelled) { setError(true); setReady(true); } });
    const blur = () => { void persist.current().catch(() => { /* The hook presents the storage failure. */ }); };
    const flush = (event: Event) => { (event as CustomEvent<Array<Promise<unknown>>>).detail.push(persist.current()); };
    window.addEventListener('blur', blur); window.addEventListener('pagehide', blur); window.addEventListener('lowkkey:flush-drafts', flush); document.addEventListener('visibilitychange', blur);
    return () => { cancelled = true; alive.current = false; window.removeEventListener('blur', blur); window.removeEventListener('pagehide', blur); window.removeEventListener('lowkkey:flush-drafts', flush); document.removeEventListener('visibilitychange', blur); void persist.current().catch(() => { /* Explicit navigation already presents storage failures. */ }); };
  }, [database, id]);
  function replace(value: T) {
    current.current = value; dirty.current = true; setFields(value); setSaved(false);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist.current().catch(() => { /* The hook presents the storage failure. */ }); }, 300);
  }
  async function clear(value: T = initial.current) {
    await persist.current(); await database.removeDraft(id); current.current = value; dirty.current = false; lastSaved.current = undefined; setFields(value); setSaved(false);
  }
  function resetAfterSubmit(value: T = initial.current) { current.current = value; dirty.current = false; lastSaved.current = undefined; setFields(value); setSaved(false); }
  return { fields, ready, error, saved, replace, change: (key: keyof T, value: string) => replace({ ...current.current, [key]: value }), flush: () => persist.current(), clear, resetAfterSubmit };
}
export async function flushDrafts() {
  const tasks: Array<Promise<unknown>> = [];
  window.dispatchEvent(new CustomEvent('lowkkey:flush-drafts', { detail: tasks }));
  await Promise.all(tasks);
}
