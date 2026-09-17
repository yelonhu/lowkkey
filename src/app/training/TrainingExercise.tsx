import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalLedger } from '../../domain/local-ledger.ts';
import type { QueuedCommand, ManualMutation, CommandInput } from '../../domain/manual-commands.ts';
import { newQueuedCommand, observed, versionBindingSchema } from '../../domain/manual-commands.ts';
import { normalizeManualDecimal, normalizeMass } from '../../domain/numbers.ts';
import type { ExerciseSetup, SessionExercise, WorkoutSession, WorkoutSet } from '../../domain/training.ts';
import { setTypeSchema, trainingSetInputSchema } from '../../domain/training.ts';
import { localeSchema } from '../../domain/primitives.ts';
import { commandFor } from '../workspace-state.ts';
import type { WorkspaceRuntime } from '../workspace-state.ts';
import { useDraft } from '../use-draft.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { NumericText } from '../NumericText.tsx';
import { latestHistory, nextOrdinal, observedDraftRefs, trainingProjection, versionFor } from './training-state.ts';
import type { Binding, TrainingProjection } from './training-state.ts';

export function TrainingExercise({ runtime, ledger, model, session, exercise, setup, commands, blocked, review, onReviewed, onRemove }: {
  runtime: WorkspaceRuntime; ledger: LocalLedger; model: TrainingProjection; session: WorkoutSession; exercise: SessionExercise; setup: ExerciseSetup;
  commands: QueuedCommand[]; blocked: boolean; review: QueuedCommand | null; onReviewed: () => void; onRemove: () => void;
}) {
  const { t, i18n } = useTranslation(), locale = localeSchema.parse(i18n.resolvedLanguage);
  const defaults = { load: '', unit: setup.loadUnit, reps: '', rpe: '', setType: 'unknown', note: '', targetId: '', rootBinding: '', targetBinding: '', replacementOperation: '', newId: '', unitChosen: '' };
  const draftId = 'training:' + session.id + ':' + exercise.id + ':set';
  const draft = useDraft(runtime.database, draftId, 'set', defaults, session.entryTimezone, fields => ({ baseRefs: observedDraftRefs(fields), localDate: session.localDate }));
  const fields = draft.fields, [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [deleting, setDeleting] = useState<{ row: WorkoutSet; root: Binding; target: Binding } | null>(null);
  const lastSubmitted = useRef<QueuedCommand | null>(null);
  const submitting = useRef(false), initialized = useRef(false), form = useRef<HTMLFormElement>(null), appliedReview = useRef<string | null>(null);
  const rows = model.sets.filter(item => item.sessionExerciseId === exercise.id);
  const history = latestHistory(ledger, session.id, setup.id, session);
  const name = model.labels.get(exercise.displaySnapshot.exerciseId)?.[locale] ?? exercise.displaySnapshot.name;
  const bodyweight = exercise.displaySnapshot.loadSemantics === 'bodyweight_only';
  const prefix = 'set-' + exercise.id;
  const editable = ['in_progress', 'paused', 'completed'].includes(session.status);
  function rootVersion() {
    const latest = lastSubmitted.current;
    const known = latest && !commands.some(command => command.operationId === latest.operationId) ? [...commands, latest] : commands;
    return versionFor({ type: 'workout_session', id: session.id, revision: session.revision }, known);
  }
  function change(key: keyof typeof fields, value: string) {
    const baseline = fields.rootBinding || JSON.stringify(rootVersion());
    draft.replace({ ...fields, [key]: value, ...(key === 'unit' ? { unitChosen: 'yes' } : {}), rootBinding: baseline }); setMessage(null);
  }
  function edit(row: WorkoutSet) {
    draft.replace({ ...defaults, load: row.loadDecimal ?? '', unit: row.unit ?? setup.loadUnit, reps: String(row.reps), rpe: row.rpeHalfUnits === null ? '' : String(row.rpeHalfUnits / 2), setType: row.setType, note: row.note ?? '', targetId: row.id, rootBinding: JSON.stringify(rootVersion()), targetBinding: JSON.stringify(versionFor({ type: 'workout_set', id: row.id, revision: row.revision }, [...model.pending.values()])) });
    setMessage(null); form.current?.scrollIntoView({ block: 'start' }); form.current?.querySelector<HTMLInputElement>('input[inputmode=numeric]')?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!review || !draft.ready || appliedReview.current === review.operationId) return;
    const mutation = review.mutation;
    if (mutation.kind !== 'set.create' && mutation.kind !== 'set.update') return;
    appliedReview.current = review.operationId;
    const current = mutation.kind === 'set.update' ? model.sets.find(row => row.id === mutation.target.id) : null;
    if (mutation.kind === 'set.update' && !current) { setMessage('training:recordGone'); return; }
    const input = mutation.input, load = input.load === undefined ? current?.loadDecimal ? { value: current.loadDecimal, unit: current.unit! } : null : input.load;
    draft.replace({ ...defaults, load: load?.value ?? '', unit: load?.unit ?? setup.loadUnit, reps: String(input.reps ?? current?.reps ?? ''), rpe: input.rpe === undefined ? current?.rpeHalfUnits == null ? '' : String(current.rpeHalfUnits / 2) : input.rpe === null ? '' : String(input.rpe), setType: input.setType ?? current?.setType ?? 'unknown', note: input.note ?? current?.note ?? '', targetId: current?.id ?? '', rootBinding: JSON.stringify(observed({ type: 'workout_session', id: session.id, revision: session.revision })), targetBinding: current ? JSON.stringify(observed({ type: 'workout_set', id: current.id, revision: current.revision })) : '', replacementOperation: review.operationId, newId: mutation.kind === 'set.create' ? mutation.input.id : '' });
    form.current?.scrollIntoView({ block: 'start' });
  }, [review, draft.ready, model.sets, session.id, session.revision, setup.loadUnit, defaults, draft]);
  useEffect(() => {
    if (!draft.ready || initialized.current) return;
    initialized.current = true;
    if (!draft.saved && !fields.load && !fields.reps && !fields.targetId && history) {
      const row = history.sets[Math.min(rows.length, history.sets.length - 1)];
      draft.replace({ ...defaults, load: row.loadDecimal ?? '', unit: row.unit ?? setup.loadUnit, reps: String(row.reps) });
    }
  }, [draft, defaults, fields, history, rows.length, setup.loadUnit]);
  async function save() {
    if (submitting.current) return; submitting.current = true; setBusy(true); setMessage(null);
    try {
      const current = await runtime.database.readLedger(); if (!current) throw Error('Storage');
      const commands = await runtime.database.listCommands(), projection = trainingProjection(current, commands);
      const root = projection.sessions.find(row => row.id === session.id); if (!root) throw Error('Storage');
      const rootBinding = versionBindingSchema.parse(JSON.parse(fields.rootBinding || JSON.stringify(versionFor({ type: 'workout_session', id: root.id, revision: root.revision }, commands))));
      if (rootBinding.type !== 'workout_session') throw Error('Invalid fields');
      const load = bodyweight ? null : { value: normalizeManualDecimal(fields.load), unit: fields.unit, semantics: exercise.displaySnapshot.loadSemantics };
      if (load) normalizeMass(load.value, load.unit === 'lb' ? 'lb' : 'kg');
      const id = fields.targetId || fields.newId || crypto.randomUUID();
      const input = trainingSetInputSchema.parse({ id, sessionExerciseId: exercise.id, ordinal: nextOrdinal(projection.sets.filter(row => row.sessionExerciseId === exercise.id)), reps: Number(normalizeManualDecimal(fields.reps)), load, rpe: fields.rpe.trim() ? Number(normalizeManualDecimal(fields.rpe)) : null, setType: fields.setType, note: fields.note || null });
      let mutation: ManualMutation;
      if (fields.targetId) {
        const target = versionBindingSchema.parse(JSON.parse(fields.targetBinding));
        if (target.type !== 'workout_set') throw Error('Invalid fields');
        mutation = { kind: 'set.update', session: { ...rootBinding, type: 'workout_session' }, target: { ...target, type: 'workout_set' }, input: { reps: input.reps, load: input.load, rpe: input.rpe, setType: input.setType, note: input.note } };
      } else mutation = { kind: 'set.create', session: { ...rootBinding, type: 'workout_session' }, input };
      const command = commandFor(current, mutation, id, root.localDate, root.entryTimezone), submitted = await draft.flush();
      if (fields.replacementOperation) {
        const previous = await runtime.database.readCommand(fields.replacementOperation); if (!previous) throw Error('Storage');
        await runtime.database.resolveCommand(previous.operationId, previous.localRevision, command, submitted);
      } else {
        const batch: CommandInput[] = [];
        if (fields.unitChosen === 'yes' && !bodyweight && fields.unit !== setup.loadUnit) {
          const target = versionFor({ type: 'exercise_setup', id: setup.id, revision: setup.revision }, commands);
          const preference = commandFor(current, { kind: 'setup.update', target: { ...target, type: 'exercise_setup' }, input: { loadUnit: input.load!.unit } }, setup.id, root.localDate, root.entryTimezone);
          batch.push(preference); command.dependencies.push(preference.operationId);
        }
        await runtime.database.enqueueCommands([...batch, command], submitted);
      }
      lastSubmitted.current = newQueuedCommand(command);
      draft.resetAfterSubmit({ ...defaults, unit: fields.unit }); onReviewed(); void runtime.queue.flush();
    } catch (failure) { setMessage(failure instanceof Error && (failure.name === 'ZodError' || /DECIMAL|MASS_|Invalid fields/.test(failure.message)) ? 'training:invalid' : 'training:saveError'); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function remove() {
    if (!deleting || submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      const { root, target, row } = deleting;
      await runtime.database.enqueueCommand(commandFor(ledger, { kind: 'set.delete', session: { ...root, type: 'workout_session' }, target: { ...target, type: 'workout_set' } }, row.id, session.localDate, session.entryTimezone));
      setDeleting(null); void runtime.queue.flush();
    } catch { setMessage('training:saveError'); }
    finally { submitting.current = false; setBusy(false); }
  }
  function rememberScene() {
    void runtime.database.saveScene({ ownerId: ledger.ownerId, view: 'session', sessionId: session.id, localDate: session.localDate, currentGroupId: fields.targetId || exercise.id, draftId, timerStartedAt: session.startedAt, scrollY: window.scrollY, updatedAt: new Date().toISOString() }).catch(() => setMessage('storageFailed'));
  }
  return <section className="panel training-exercise" data-exercise-id={exercise.id}>
    <div className="section-heading"><div><h2>{name}</h2><p className="muted">{t('training:semantics_' + exercise.displaySnapshot.loadSemantics)} · {setup.loadUnit}{setup.equipmentInstance ? ' · ' + setup.equipmentInstance : ''}</p></div><button className="quiet danger" disabled={!editable || blocked} onClick={onRemove}>{t('training:remove')}</button></div>
    {!setup.equipmentInstance && !bodyweight && <p className="muted">{t('training:unspecifiedEquipment')}</p>}
    {exercise.displaySnapshot.includesBar && <p className="muted">{t('training:barRule')} <NumericText>{exercise.displaySnapshot.barWeightDecimal ?? ''}</NumericText> {exercise.displaySnapshot.barUnit}</p>}
    {exercise.displaySnapshot.loadSemantics === 'per_side' && <p className="muted">{t('training:perSideRule')}</p>}
    {exercise.targetSnapshot && <p><NumericText>{t('training:target', { sets: exercise.targetSnapshot.plannedSets ?? '—', min: exercise.targetSnapshot.repMin ?? '—', max: exercise.targetSnapshot.repMax ?? '—' })}</NumericText></p>}
    <div className="training-history"><p>{history ? <NumericText>{t('training:lastTime', { date: history.session.localDate })}</NumericText> : t('training:noHistory')}</p>
      {history && <><p className="numeric">{history.sets.map(row => (row.loadDecimal === null ? t('training:bodyweight') : row.loadDecimal + ' ' + row.unit) + ' × ' + row.reps).join(' · ')}</p><button type="button" className="quiet" disabled={!draft.ready || busy} onClick={() => { const row = history.sets[Math.min(rows.length, history.sets.length - 1)]; draft.replace({ ...defaults, reps: String(row.reps), load: row.loadDecimal ?? '', unit: row.unit ?? setup.loadUnit, rootBinding: JSON.stringify(rootVersion()) }); }}>{t('training:prefill')}</button><p className="muted">{t('training:previousUnit')}</p></>}
    </div>
    <ul className="record-list training-sets">{rows.map(row => <li key={row.id} data-set-id={row.id} data-pending={model.pending.has(row.id) ? 'true' : 'false'}>
      <div><p><NumericText>{t('training:setNumber', { number: row.ordinal })}</NumericText> · {t('training:type_' + row.setType)}</p><p className="record-value"><span className="numeric">{row.loadDecimal === null ? t('training:bodyweight') : row.loadDecimal}</span> <span className="unit">{row.unit}</span> × <span className="numeric">{row.reps}</span></p><p className="muted">RPE <span className="numeric">{row.rpeHalfUnits === null ? '—' : row.rpeHalfUnits / 2}</span>{row.note ? ' · ' + row.note : ''}</p>{model.pending.has(row.id) && <p role="status">{t('savedLocally')}</p>}</div>
      <div className="actions"><button className="quiet" disabled={!draft.ready || busy || !editable} onClick={() => edit(row)}>{t('training:edit')}</button><button className="quiet danger" disabled={!editable || busy || blocked} onClick={() => {
        const exerciseIds = new Set(model.exercises.filter(item => item.sessionId === session.id).map(item => item.id));
        if (session.status === 'completed' && model.sets.filter(item => exerciseIds.has(item.sessionExerciseId)).length <= 1) { setMessage('training:deleteCompleted'); return; }
        setDeleting({ row, root: rootVersion(), target: versionFor({ type: 'workout_set', id: row.id, revision: row.revision }, commands) });
      }}>{t('training:remove')}</button></div>
    </li>)}</ul>
    {!rows.length && <p className="muted">{t('training:noSets')}</p>}
    {editable && <form ref={form} data-training-draft={draftId} onFocus={rememberScene} onSubmit={event => { event.preventDefault(); void save(); }}>
      <h3>{t(fields.targetId ? 'training:editSet' : 'training:newSet')}</h3>
      <fieldset disabled={!draft.ready || busy || (blocked && !fields.replacementOperation)}>
        <div className="training-fields">
          {!bodyweight && <label htmlFor={prefix + '-load'}>{t('training:load')}<div className="joined-input"><input id={prefix + '-load'} inputMode="decimal" required autoComplete="off" value={fields.load} onChange={event => change('load', event.target.value)}/><select aria-label={t('training:unit')} value={fields.unit} onChange={event => change('unit', event.target.value)}><option>kg</option><option>lb</option></select></div></label>}
          <label htmlFor={prefix + '-reps'}>{t('training:reps')}<input id={prefix + '-reps'} inputMode="numeric" required autoComplete="off" value={fields.reps} onChange={event => change('reps', event.target.value)}/></label>
          <label htmlFor={prefix + '-rpe'}>{t('training:rpe')}<input id={prefix + '-rpe'} inputMode="decimal" autoComplete="off" value={fields.rpe} onChange={event => change('rpe', event.target.value)}/></label>
        </div>
        <label htmlFor={prefix + '-type'}>{t('training:setType')}</label><select id={prefix + '-type'} value={fields.setType} onChange={event => change('setType', event.target.value)}>{setTypeSchema.options.map(value => <option key={value} value={value}>{t('training:type_' + value)}</option>)}</select>
        <label htmlFor={prefix + '-note'}>{t('training:note')}</label><textarea id={prefix + '-note'} maxLength={500} value={fields.note} onChange={event => change('note', event.target.value)}/>
        <div className="actions"><button type="submit">{t('training:saveSet')}</button>{(fields.targetId || fields.replacementOperation) && <button className="quiet" type="button" onClick={() => { void draft.clear(defaults).then(onReviewed).catch(() => setMessage('storageFailed')); }}>{t('cancel')}</button>}</div>
      </fieldset>
      <p role="status" className={draft.error ? 'error' : 'muted'}>{draft.error ? t('storageFailed') : draft.saved ? t('savedDraft') : ''}</p>
    </form>}
    {message && <p role="alert">{t(message)}</p>}
    {deleting && <ConfirmDialog title={t('training:confirmDeleteSet')} onCancel={() => { if (!busy) setDeleting(null); }}>
      <p><NumericText>{t('training:setNumber', { number: deleting.row.ordinal }) + ' · ' + (deleting.row.loadDecimal ?? '—') + ' ' + (deleting.row.unit ?? '') + ' × ' + deleting.row.reps}</NumericText></p><p>{t('training:deleteImpact')}</p>
      <div className="actions"><button className="quiet" disabled={busy} onClick={() => setDeleting(null)}>{t('cancel')}</button><button className="danger" disabled={busy} onClick={() => { void remove(); }}>{t('training:remove')}</button></div>
    </ConfirmDialog>}
  </section>;
}
