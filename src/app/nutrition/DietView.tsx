import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localDateAt, localeSchema } from '../../domain/primitives.ts';
import { effectiveTimezone } from '../../domain/time.ts';
import type { ProfileSnapshot } from '../../domain/profile.ts';
import type { LocalLedger } from '../../domain/local-ledger.ts';
import type { Meal, MealDraft } from '../../domain/nutrition.ts';
import { emptyNutrients, mealInputSchema, nutrientKeys, rawNutrientKeys } from '../../domain/nutrition.ts';
import type { ManualMutation, QueuedCommand } from '../../domain/manual-commands.ts';
import { observed } from '../../domain/manual-commands.ts';
import { formatNumber } from '../../i18n/locale.ts';
import { commandFor } from '../workspace-state.ts';
import type { WorkspaceRuntime } from '../workspace-state.ts';
import { commitEditingRegions, serializeEdits } from '../save-coordinator.ts';
import { NumericText } from '../NumericText.tsx';
import { SaveStatus } from '../SaveStatus.tsx';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { NoteEditor } from './NoteEditor.tsx';
import { dietProjection, isDietCommand, pendingCommand } from './diet-state.ts';

export function DietView({ runtime, ledger, profile, commands, date, navigate }: {
  runtime: WorkspaceRuntime; ledger: LocalLedger; profile: ProfileSnapshot; commands: QueuedCommand[]; date: string; navigate: (path: string) => Promise<void>;
}) {
  const { t, i18n } = useTranslation(), locale = localeSchema.parse(i18n.resolvedLanguage);
  const timezone = effectiveTimezone(profile.timezone, profile.pendingTimezone, profile.timezoneEffectiveDate, new Date()), today = localDateAt(new Date(), timezone);
  const model = useMemo(() => dietProjection(ledger, commands, date), [ledger, commands, date]);
  const [extraIds, setExtraIds] = useState<string[]>([]), [loaded, setLoaded] = useState(false), [focusId, setFocusId] = useState<string | null>(null), [hasDraft, setHasDraft] = useState(false);
  const [message, setMessage] = useState<string | null>(null), [lastId, setLastId] = useState<string | null>(null), [deleting, setDeleting] = useState<Meal | MealDraft | null>(null), [zero, setZero] = useState(false), [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    let alive = true, reading = Promise.resolve();
    const read = () => {
      reading = reading.catch(() => undefined).then(async () => {
        const drafts = await runtime.database.listDrafts(); if (!alive) return;
        const local = drafts.filter(draft => draft.kind === 'meal' && draft.localDate === date && draft.rawFields.dirty === 'yes');
        setHasDraft(local.some(draft => !!draft.rawFields.targetBinding || !!draft.rawFields.description?.trim() || rawNutrientKeys.some(key => draft.rawFields[key])));
        const ids = local.filter(draft => draft.id.startsWith('diet-note:' + date + ':')).map(draft => draft.id.split(':').at(-1)!);
        setExtraIds(previous => [...new Set([...previous, ...ids])]); setLoaded(true);
      }).catch(() => { if (alive) { setMessage('storageFailed'); setLoaded(true); } });
    };
    read(); const unsubscribe = runtime.database.subscribe(read);
    const network = () => setOnline(navigator.onLine); window.addEventListener('online', network); window.addEventListener('offline', network);
    return () => { alive = false; unsubscribe(); window.removeEventListener('online', network); window.removeEventListener('offline', network); };
  }, [runtime, date]);
  useEffect(() => { const saved = new Set(model.records.map(record => record.id)); setExtraIds(previous => previous.filter(id => !saved.has(id))); }, [model.records.map(record => record.id).join(',')]);
  const relevant = commands.filter(command => command.localDate === date && isDietCommand(command, commands));
  const pending = relevant.some(command => pendingCommand(command, ledger));
  const issues = relevant.filter(command => ['conflict','needs_review','rejected'].includes(command.state) && (command.mutation.kind.startsWith('day-claim.') || command.mutation.kind === 'operation.undo' || command.mutation.kind.startsWith('meal-draft.') || (command.mutation.kind === 'meal.delete' && model.records.some(record => record.id === command.clientEntityId && !record.note))));
  const latest = commands.find(command => command.operationId === lastId);
  const ids = [...new Set([...model.records.map(record => record.id), ...extraIds])];
  const removeLocal = (id: string) => setExtraIds(previous => previous.filter(value => value !== id));
  async function add() {
    try { await commitEditingRegions(); const id = crypto.randomUUID(); setExtraIds(previous => [...previous, id]); setFocusId(id); }
    catch { setMessage('storageFailed'); }
  }
  async function declareComplete(explicitZero = false) {
    const seen = model.claim;
    try {
      await commitEditingRegions();
      await serializeEdits(runtime.database, async () => {
        const fresh = await runtime.database.readLedger(), queue = await runtime.database.listCommands(), drafts = await runtime.database.listDrafts(); if (!fresh) throw Error();
        if (!navigator.onLine || queue.some(command => command.localDate === date && isDietCommand(command, queue) && pendingCommand(command, fresh)) || drafts.some(draft => draft.kind === 'meal' && draft.localDate === date && draft.rawFields.dirty === 'yes' && (draft.rawFields.targetBinding || draft.rawFields.description?.trim() || rawNutrientKeys.some(key => draft.rawFields[key])))) { setMessage('nutrition:pendingReview'); return; }
        const input = { id: seen?.id ?? crypto.randomUUID(), entryTimezone: seen?.entryTimezone ?? timezone, nutritionCompleteness: 'complete' as const, expectedNutritionContentRevision: seen?.nutritionContentRevision ?? 0, explicitZeroIntake: explicitZero };
        const mutation: ManualMutation = seen ? { kind: 'day-claim.update', localDate: date, target: observed({ type: 'day_claim', id: seen.id, revision: seen.revision }), input } : { kind: 'day-claim.create', localDate: date, input };
        const command = commandFor(fresh, mutation, input.id, date, input.entryTimezone);
        await runtime.database.enqueueCommand(command); setLastId(command.operationId); setMessage(null); setZero(false); void runtime.queue.flush();
      });
    } catch { setMessage('storageFailed'); }
  }
  async function keep(candidate: MealDraft) {
    try {
      const fresh = await runtime.database.readLedger(); if (!fresh) throw Error();
      const id = crypto.randomUUID(), input = mealInputSchema.parse({ id, localDate: candidate.localDate, entryTimezone: candidate.entryTimezone, occurredAt: candidate.occurredAt, timePrecision: candidate.timePrecision, mealType: candidate.mealType, note: { description: candidate.description, nutrients: emptyNutrients }, draftRef: { id: candidate.id, revision: candidate.revision } });
      const command = commandFor(fresh, { kind: 'meal.create', input }, id, date, candidate.entryTimezone);
      await runtime.database.enqueueCommand(command); setLastId(command.operationId); void runtime.queue.flush();
    } catch { setMessage('storageFailed'); }
  }
  async function remove() {
    if (!deleting) return;
    try {
      const fresh = await runtime.database.readLedger(); if (!fresh) throw Error();
      const mutation: ManualMutation = 'description' in deleting ? { kind: 'meal-draft.delete', target: observed({ type: 'import_draft', id: deleting.id, revision: deleting.revision }) } : { kind: 'meal.delete', target: observed({ type: 'meal', id: deleting.id, revision: deleting.revision }) };
      const command = commandFor(fresh, mutation, deleting.id, date, deleting.entryTimezone);
      await runtime.database.enqueueCommand(command); setLastId(command.operationId); setDeleting(null); void runtime.queue.flush();
    } catch { setMessage('storageFailed'); }
  }
  const canReview = !pending && !hasDraft && online && !model.drafts.length;
  return <div className="diet-view" data-diet-date={date} data-draft-ready={loaded}>
    <div className="daily-heading"><h1>{t('nutrition:title')}</h1><input aria-label={t('date')} type="date" value={date} max={today} onChange={event => { if (event.target.value && event.target.value <= today) void navigate('/nutrition?date=' + event.target.value); }}/></div>
    <div className="diet-toolbar"><span className="muted"><NumericText>{model.records.length ? t('nutrition:count', { count: model.records.length }) : t('nutrition:empty')}</NumericText></span><button disabled={!loaded} onClick={() => { void add(); }} data-testid="add-note">{t('nutrition:add')}</button></div>
    <div className="diet-notes">{ids.map(id => {
      const record = model.records.find(record => record.id === id);
      return record && !record.note ? <article className="diet-note panel" key={id} data-legacy-meal={id}><h2>{record.title ?? t('nutrition:legacyItems')}</h2><ul>{model.items.filter(item => item.mealId === id).map(item => <li key={item.id}>{item.snapshot.originalName} <span className="numeric">{item.snapshot.quantityDecimal}</span> {item.snapshot.unit}</li>)}</ul><button className="quiet danger" onClick={() => setDeleting(record)}>{t('remove')}</button></article>
        : <NoteEditor key={id} id={id} record={record} date={date} timezone={timezone} runtime={runtime} ledger={ledger} commands={commands} onRemoved={removeLocal} focus={id === focusId}/>;
    })}</div>
    {model.drafts.length > 0 && <section className="diet-candidates"><h2>{t('nutrition:legacy')}</h2>{model.drafts.map(candidate => <article className="panel" key={candidate.id}><p className="diet-text">{candidate.description || t('nutrition:legacy')}</p>{candidate.sourceIds.length === 0 && candidate.description.trim() && <button className="quiet" disabled={pending} onClick={() => { void keep(candidate); }}>{t('nutrition:keep')}</button>}<button className="quiet danger" disabled={pending} onClick={() => setDeleting(candidate)}>{t('discard')}</button></article>)}</section>}
    {(model.facts.length > 0 || model.claim?.explicitZeroIntake) && <section className="diet-summary" aria-label={t('nutrition:known')}>
      {nutrientKeys.some(key => model.summary.knownSum[key] !== null) ? <><h2>{t('nutrition:known')}</h2><dl className="diet-totals">{nutrientKeys.map((key, index) => { const value = model.summary.knownSum[key], unknown = Object.values(model.summary.unknownCounts)[index]; return <div key={key}><dt>{t('nutrition:' + rawNutrientKeys[index])}</dt><dd className="numeric">{value === null ? '—' : formatNumber(value / 1000, locale)}</dd>{unknown > 0 && <p className="muted">{t('nutrition:unknown', { count: unknown })}</p>}</div>; })}</dl></> : <p className="muted">{t('nutrition:noNutrition')}</p>}
    </section>}
    <div className="diet-review">
      {(model.records.length > 0 || model.claim) && <span className="muted">{t('nutrition:' + (model.claim?.nutritionCompleteness === 'complete' ? 'completeStatus' : model.claim?.nutritionCompleteness ?? 'unreviewed'))}</span>}
      {model.records.length > 0 && model.claim?.nutritionCompleteness !== 'complete' && <button className="quiet" data-testid="diet-complete" disabled={!canReview} onClick={() => { void declareComplete(); }}>{t('nutrition:complete')}</button>}
      {pending && <span className="muted">{t('nutrition:pendingReview')}</span>}
      {model.drafts.length > 0 && <span className="muted">{t('nutrition:resolveCandidates')}</span>}
      {!model.records.length && !model.drafts.length && model.claim?.nutritionCompleteness !== 'complete' && <details><summary>{t('details')}</summary><button className="quiet" disabled={!canReview} onClick={() => setZero(true)}>{t('nutrition:zero')}</button></details>}
      <SaveStatus command={latest} dataRevision={ledger.dataRevision}/>
    </div>
    {message && <p role="alert">{t(message)}</p>}
    {issues.map(command => <div className="row-status" role="alert" key={command.operationId}><span>{t(command.mutation.kind === 'operation.undo' ? 'weight:undoBlocked' : command.mutation.kind.startsWith('day-claim.') ? 'nutrition:reviewChanged' : 'errors:recordChanged')}</span><button className="quiet" onClick={() => { void runtime.database.resolveCommand(command.operationId, command.localRevision).catch(() => setMessage('storageFailed')); }}>{t('discard')}</button></div>)}
    {deleting && <ConfirmDialog title={t('description' in deleting ? 'nutrition:discardCandidate' : 'nutrition:deleteNote')} onCancel={() => setDeleting(null)}><p className="diet-text">{'description' in deleting ? deleting.description : deleting.title}</p><button className="danger" onClick={() => { void remove(); }}>{t('remove')}</button><button className="quiet" onClick={() => setDeleting(null)}>{t('cancel')}</button></ConfirmDialog>}
    {zero && <ConfirmDialog title={t('nutrition:zeroConfirm')} onCancel={() => setZero(false)}><button onClick={() => { void declareComplete(true); }}>{t('nutrition:zero')}</button><button className="quiet" onClick={() => setZero(false)}>{t('cancel')}</button></ConfirmDialog>}
  </div>;
}
