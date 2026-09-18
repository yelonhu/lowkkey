import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Meal } from '../../domain/nutrition.ts';
import { rawNutrientKeys } from '../../domain/nutrition.ts';
import { compareDecimal } from '../../domain/numbers.ts';
import { observed, versionBindingSchema } from '../../domain/manual-commands.ts';
import type { ManualMutation, QueuedCommand } from '../../domain/manual-commands.ts';
import type { LocalLedger } from '../../domain/local-ledger.ts';
import { commandFor } from '../workspace-state.ts';
import type { WorkspaceRuntime } from '../workspace-state.ts';
import { useDraft } from '../use-draft.ts';
import { advanceOwnBinding, serializeEdits } from '../save-coordinator.ts';
import { observedDraftRefs } from '../training/training-state.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { SaveStatus } from '../SaveStatus.tsx';
import { dietProjection } from './diet-state.ts';
import { noteFields, noteOccurrence, parseNote } from './note-input.ts';

export function NoteEditor({ id, record, date, timezone, runtime, ledger, commands, onRemoved, focus }: {
  id: string; record?: Meal; date: string; timezone: string; runtime: WorkspaceRuntime; ledger: LocalLedger; commands: QueuedCommand[]; onRemoved: (id: string) => void; focus: boolean;
}) {
  const { t } = useTranslation(), entryTimezone = record?.entryTimezone ?? timezone;
  const draft = useDraft(runtime.database, 'diet-note:' + date + ':' + id, 'meal', noteFields(record), entryTimezone, fields => ({ localDate: date, baseRefs: observedDraftRefs(fields) }));
  const [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false), [deleting, setDeleting] = useState(false), [large, setLarge] = useState(false);
  const [review, setReview] = useState<{ command: QueuedCommand; current?: Meal } | null>(null), [lastId, setLastId] = useState<string | null>(null), [undoId, setUndoId] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null), region = useRef<HTMLElement>(null), handler = useRef<() => Promise<unknown>>(async () => undefined), undoShown = useRef<string | null>(null), focused = useRef(false);
  const related = commands.filter(command => command.clientEntityId === id && command.state !== 'discarded');
  const problems = related.filter(command => ['conflict','needs_review','rejected'].includes(command.state));
  const action = commands.find(command => command.operationId === lastId) ?? related.at(-1);

  useEffect(() => {
    if (draft.ready && draft.read().dirty !== 'yes' && !region.current?.contains(document.activeElement) && !problems.length) draft.resetAfterSubmit(noteFields(record));
  }, [record?.revision, record?.note, draft.ready]);
  useEffect(() => { if (draft.ready && focus && !focused.current) { focused.current = true; textarea.current?.focus(); } }, [draft.ready, focus]);
  function fitText() { const element = textarea.current; if (element) { element.style.height = 'auto'; element.style.height = Math.max(76, element.scrollHeight) + 'px'; } }
  useEffect(fitText, [draft.fields.description, draft.ready]);
  useEffect(() => {
    const observer = new ResizeObserver(fitText); if (region.current) observer.observe(region.current);
    window.addEventListener('resize', fitText); document.fonts.addEventListener('loadingdone', fitText);
    return () => { observer.disconnect(); window.removeEventListener('resize', fitText); document.fonts.removeEventListener('loadingdone', fitText); };
  }, []);
  useEffect(() => {
    const commit = (event: Event) => (event as CustomEvent<Array<() => Promise<unknown>>>).detail.push(() => handler.current());
    window.addEventListener('lowkkey:commit-editing', commit); return () => window.removeEventListener('lowkkey:commit-editing', commit);
  }, []);
  useEffect(() => {
    if (!lastId || action?.state !== 'committed' || action.mutation.kind !== 'meal.create' || (action.receipt?.dataRevision ?? Infinity) > ledger.dataRevision || undoShown.current === action.operationId) return;
    undoShown.current = action.operationId; setUndoId(action.operationId);
    const timer = setTimeout(() => setUndoId(null), 10000); return () => clearTimeout(timer);
  }, [lastId, action?.state, (action?.receipt?.dataRevision ?? Infinity) <= ledger.dataRevision]);
  function change(key: string, value: string) {
    const fields = draft.read();
    draft.replace({ ...fields, [key]: value, dirty: 'yes', targetBinding: fields.targetBinding || (record ? JSON.stringify(observed({ type: 'meal', id, revision: record.revision })) : '') });
    setMessage(null); setLarge(false);
  }
  async function save(confirmed = false, reviewed = review) {
    return serializeEdits(runtime.database, async () => {
      if (!draft.ready || (draft.read().dirty !== 'yes' && !reviewed)) return;
      const fields = { ...draft.read() };
      if (!fields.description.trim()) { await draft.flush(); if (record || rawNutrientKeys.some(key => fields[key])) setMessage('nutrition:invalidText'); return; }
      let note: ReturnType<typeof parseNote>, occurrence: ReturnType<typeof noteOccurrence>;
      try { note = parseNote(fields, confirmed); } catch { await draft.flush(); setMessage('nutrition:invalidNumber'); return; }
      try { occurrence = noteOccurrence(date, fields.time, entryTimezone, record); } catch { await draft.flush(); setMessage('nutrition:invalidTime'); return; }
      if (note.nutrients.energyKcal !== null && compareDecimal(note.nutrients.energyKcal, '3000') > 0 && !confirmed) { setLarge(true); return; }
      if (problems.length && !reviewed) return;
      setBusy(true);
      try {
        const token = await draft.flush(), fresh = await runtime.database.readLedger(); if (!fresh) throw Error();
        const queued = await runtime.database.listCommands(), current = dietProjection(fresh, [], date).facts.find(row => row.id === id);
        if (reviewed && !reviewed.current) { setMessage('nutrition:remoteDeleted'); return; }
        const binding = reviewed?.current ? observed({ type: 'meal', id, revision: reviewed.current.revision }) : fields.targetBinding ? advanceOwnBinding(versionBindingSchema.parse(JSON.parse(fields.targetBinding)), queued) : null;
        const input = { note, ...occurrence, mealType: fields.mealType as Meal['mealType'] };
        if (binding && current?.note && current.note.description === note.description && JSON.stringify(current.note.nutrients) === JSON.stringify(note.nutrients) && current.note.nutrientSnapshot.estimated === note.estimated && current.mealType === input.mealType && current.occurredAt === input.occurredAt && !reviewed && !queued.some(command => command.clientEntityId === id && !['committed','discarded'].includes(command.state))) {
          if (JSON.stringify(draft.read()) === JSON.stringify(fields)) await draft.clear(noteFields(current));
          return;
        }
        const mutation: ManualMutation = binding ? { kind: 'meal.update', target: { ...binding, type: 'meal' }, input } :
          { kind: 'meal.create', input: { id, ...input, localDate: date, entryTimezone, title: null, items: [], draftRef: null } };
        const command = commandFor(fresh, mutation, id, date, entryTimezone);
        if (reviewed) {
          const pending = await runtime.database.readCommand(reviewed.command.operationId); if (!pending) throw Error();
          await runtime.database.resolveCommand(pending.operationId, pending.localRevision, command, token);
        } else await runtime.database.enqueueCommand(command, token);
        const next = { ...draft.read(), targetBinding: JSON.stringify({ type: 'meal', id, source: { kind: 'receipt', operationId: command.operationId } }) };
        if (JSON.stringify(draft.read()) === JSON.stringify(fields)) draft.resetAfterSubmit({ ...next, dirty: 'no' }); else draft.replace(next);
        setLastId(command.operationId); setMessage(null); setLarge(false); setReview(null); void runtime.queue.flush();
      } catch { setMessage('storageFailed'); throw Error('Diet note save failed'); }
      finally { setBusy(false); }
    });
  }
  handler.current = () => save(false, null);
  async function remove() {
    if (busy) return; setBusy(true);
    try { await serializeEdits(runtime.database, async () => {
      const target = review?.current ?? record;
      if (target) {
        const fresh = await runtime.database.readLedger(); if (!fresh) throw Error();
        const queued = await runtime.database.listCommands();
        const binding = review ? observed({ type: 'meal', id, revision: target.revision }) : advanceOwnBinding(observed({ type: 'meal', id, revision: target.revision }), queued);
        const command = commandFor(fresh, { kind: 'meal.delete', target: { ...binding, type: 'meal' } }, id, date, entryTimezone);
        if (review) { const previous = await runtime.database.readCommand(review.command.operationId); if (!previous) throw Error(); await runtime.database.resolveCommand(previous.operationId, previous.localRevision, command); }
        else await runtime.database.enqueueCommand(command); void runtime.queue.flush();
      }
      await draft.clear(noteFields()); onRemoved(id); setDeleting(false); setReview(null);
    }); } catch { setMessage('storageFailed'); } finally { setBusy(false); }
  }
  async function inspect(command: QueuedCommand) {
    await runtime.synchronizer.refresh();
    const fresh = await runtime.database.readLedger(); if (!fresh) return;
    setReview({ command, current: dietProjection(fresh, [], date).facts.find(row => row.id === id) });
  }
  async function discard(command: QueuedCommand) {
    try {
      const pending = await runtime.database.readCommand(command.operationId); if (!pending) return;
      await runtime.database.resolveCommand(pending.operationId, pending.localRevision);
      const fresh = await runtime.database.readLedger();
      const current = fresh ? dietProjection(fresh, [], date).facts.find(row => row.id === id) : undefined;
      await draft.clear(noteFields(current)); setReview(null);
      if (!current) onRemoved(id);
    } catch { setMessage('storageFailed'); }
  }
  async function undo() {
    if (!undoId) return;
    try { const command = commandFor(ledger, { kind: 'operation.undo', originalId: undoId }, undoId, date, entryTimezone); await runtime.database.enqueueCommand(command); setUndoId(null); setLastId(command.operationId); void runtime.queue.flush(); }
    catch { setMessage('storageFailed'); }
  }
  return <article ref={region} className="diet-note panel" data-note-id={id} data-draft-ready={draft.ready}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !document.hidden && document.hasFocus() && !deleting && !large && !review) void save(false, null).catch(() => undefined); }}>
    <textarea ref={textarea} aria-label={t('nutrition:description')} placeholder={t('nutrition:placeholder')} value={draft.fields.description} disabled={!draft.ready} maxLength={2000} rows={2} onChange={event => change('description', event.target.value)} aria-invalid={message === 'nutrition:invalidText'}/>
    <div className="diet-note-tools">
      <details className="diet-nutrients"><summary>{t('nutrition:nutrition')}</summary>
        <p className="muted">{t('nutrition:actualPortion')}</p>
        <div className="diet-nutrient-grid">{rawNutrientKeys.map(key => <label key={key}>{t('nutrition:' + key)}<input aria-label={t('nutrition:' + key)} inputMode="decimal" autoComplete="off" value={draft.fields[key]} onChange={event => change(key, event.target.value)} aria-invalid={message === 'nutrition:invalidNumber'}/></label>)}</div>
      </details>
      <details className="diet-details"><summary>{t('nutrition:details')}</summary>
        <div className="diet-detail-fields"><label>{t('nutrition:mealType')}<select value={draft.fields.mealType} onChange={event => change('mealType', event.target.value)}>{['unspecified','breakfast','lunch','dinner','snack'].map(value => <option key={value} value={value}>{t('nutrition:' + value)}</option>)}</select></label>
        <label>{t('nutrition:time')}<input type="time" value={draft.fields.time} onChange={event => change('time', event.target.value)}/><span className="muted">{entryTimezone}</span></label>
        <label className="diet-estimated"><input type="checkbox" checked={draft.fields.estimated === 'yes'} onChange={event => change('estimated', event.target.checked ? 'yes' : 'no')}/>{t('nutrition:estimated')}</label></div>
        <button className="quiet danger" disabled={busy || problems.length > 0} onClick={() => setDeleting(true)}>{t(record ? 'remove' : 'nutrition:cancelDraft')}</button>
      </details>
    </div>
    <div className="diet-feedback"><SaveStatus command={action} dataRevision={ledger.dataRevision}/>{undoId && <button className="quiet" data-testid="diet-undo" onClick={() => { void undo(); }}>{t('undo')}</button>}</div>
    {(message || draft.error) && <p role="alert">{t(draft.error ? 'storageFailed' : message!)}</p>}
    {problems.map(command => <div key={command.operationId} className="row-status" data-command-state={command.state}><span>{t('conflict')}</span><button className="quiet" onClick={() => { void inspect(command).catch(() => setMessage('storageFailed')); }}>{t('review')}</button><button className="quiet" onClick={() => { void discard(command); }}>{t('discard')}</button></div>)}
    {large && <ConfirmDialog title={t('nutrition:large')} onCancel={() => setLarge(false)}><p>{t('nutrition:largeBody')}</p><button onClick={() => { void save(true).catch(() => undefined); }}>{t('nutrition:confirmValue')}</button></ConfirmDialog>}
    {deleting && <ConfirmDialog title={t(record ? 'nutrition:deleteNote' : 'nutrition:cancelDraft')} onCancel={() => setDeleting(false)}><p className="diet-text">{draft.fields.description}</p><button className="danger" disabled={busy} onClick={() => { void remove(); }}>{t('remove')}</button><button className="quiet" onClick={() => setDeleting(false)}>{t('cancel')}</button></ConfirmDialog>}
    {review && <ConfirmDialog title={t('review')} onCancel={() => setReview(null)}><h3>{t('nutrition:current')}</h3><p className="diet-text">{review.current?.note?.description ?? t('nutrition:remoteDeleted')}</p><p className="numeric">{review.current?.note ? rawNutrientKeys.map(key => t('nutrition:' + key) + ': ' + (review.current!.note!.nutrients[key] ?? '—')).join(' · ') : ''}</p><h3>{t('nutrition:candidate')}</h3><p className="diet-text">{draft.fields.description}</p><p className="numeric">{rawNutrientKeys.map(key => t('nutrition:' + key) + ': ' + (draft.fields[key] || '—')).join(' · ')}</p>{review.current && <button disabled={busy} onClick={() => { if (review.command.mutation.kind === 'meal.delete') void remove(); else void save(false, review).catch(() => undefined); }}>{t(review.command.mutation.kind === 'meal.delete' ? 'remove' : 'nutrition:apply')}</button>}<button className="quiet" onClick={() => { void discard(review.command); }}>{t('discard')}</button></ConfirmDialog>}
  </article>;
}
