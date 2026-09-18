import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkoutSession, SessionExercise, ExerciseSetup, WorkoutSet } from '../../domain/training.ts';
import { setTypeSchema, trainingSetInputSchema } from '../../domain/training.ts';
import { normalizeManualDecimal, normalizeMass } from '../../domain/numbers.ts';
import { observed, versionBindingSchema } from '../../domain/manual-commands.ts';
import type { QueuedCommand } from '../../domain/manual-commands.ts';
import type { WorkspaceRuntime } from '../workspace-state.ts';
import { commandFor } from '../workspace-state.ts';
import { useDraft } from '../use-draft.ts';
import { SaveStatus } from '../SaveStatus.tsx';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import type { Binding } from './training-state.ts';
import { trainingProjection, versionFor, observedDraftRefs } from './training-state.ts';
import { advanceOwnBinding, serializeTraining } from './save-coordinator.ts';

export function SetRow({ runtime, session, exercise, setup, rowId, ordinal, record, draftId, initialLoad = '', initialUnit, issue, pending, dataRevision, onRemoved }: {
  runtime: WorkspaceRuntime; session: WorkoutSession; exercise: SessionExercise; setup: ExerciseSetup; rowId: string; ordinal: number;
  record?: WorkoutSet; draftId: string; initialLoad?: string; initialUnit?: 'kg' | 'lb'; issue?: QueuedCommand; pending?: QueuedCommand; dataRevision: number; onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const candidate = issue?.mutation.kind === 'set.create' || issue?.mutation.kind === 'set.update' || issue?.mutation.kind === 'day-set.create' || issue?.mutation.kind === 'day-set.update' ? issue.mutation.input : null;
  const values = () => ({ rowId, load: candidate?.load?.value ?? record?.loadDecimal ?? initialLoad, unit: candidate?.load?.unit ?? record?.unit ?? initialUnit ?? setup.loadUnit,
    reps: String(candidate?.reps ?? record?.reps ?? ''), rpe: candidate?.rpe === null ? '' : candidate?.rpe !== undefined ? String(candidate.rpe) : record?.rpeHalfUnits == null ? '' : String(record.rpeHalfUnits / 2),
    setType: candidate?.setType ?? record?.setType ?? 'unknown', note: candidate?.note ?? record?.note ?? '', targetId: record?.id ?? '', rootBinding: '', targetBinding: '', dirty: 'no', ordinal: String(ordinal) });
  const draft = useDraft(runtime.database, draftId, 'set', values(), session.entryTimezone, fields => ({ baseRefs: observedDraftRefs(fields), localDate: session.localDate }));
  const [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false), [more, setMore] = useState(false), [confirmDelete, setConfirmDelete] = useState(false), [reviewing, setReviewing] = useState(false);
  const handler = useRef<() => Promise<unknown>>(async () => undefined), legacy = useRef(false);
  const deletionBaseline = useRef<{ root: Binding; target: Binding | null } | null>(null);
  const rowElement = useRef<HTMLDivElement>(null);
  const pointerHeld = useRef(false), deferredExit = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const down = () => { pointerHeld.current = true; };
    const up = () => { pointerHeld.current = false; if (deferredExit.current) { deferredExit.current = false; timer = setTimeout(() => { void handler.current().catch(() => undefined); }, 0); } };
    const cancel = () => { pointerHeld.current = false; deferredExit.current = false; };
    document.addEventListener('pointerdown', down, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', cancel, true);
    return () => { clearTimeout(timer); document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', cancel, true); };
  }, []);
  function rowExit() { if (pointerHeld.current) deferredExit.current = true; else void handler.current().catch(() => undefined); }
  const bodyweight = exercise.displaySnapshot.loadSemantics === 'bodyweight_only';
  const signature = record ? JSON.stringify([record.revision, record.operationId, record.loadDecimal, record.reps, record.rpeHalfUnits, record.setType, record.note]) : '';
  useEffect(() => {
    if (draft.ready && draft.read().dirty !== 'yes') draft.resetAfterSubmit(values());
    // Confirmed or projected facts can refresh only an untouched row.
  }, [signature]);
  useEffect(() => {
    if (!draft.ready || legacy.current) return; legacy.current = true;
    if (draft.saved && draftId.endsWith(':set') && [draft.read().load, draft.read().reps, draft.read().note].some(Boolean)) draft.change('dirty', 'yes');
  }, [draft.ready]);
  useEffect(() => { if (!record && !draft.read().load && !draft.read().reps && draft.read().dirty !== 'yes') draft.resetAfterSubmit({ ...draft.read(), unit: setup.loadUnit }); }, [setup.loadUnit]);
  function change(key: keyof ReturnType<typeof values>, value: string) {
    const fields = draft.read();
    draft.replace({ ...fields, [key]: value, dirty: 'yes',
      rootBinding: fields.rootBinding || JSON.stringify(observed({ type: 'workout_session', id: session.id, revision: session.revision })),
      targetBinding: fields.targetBinding || (record ? JSON.stringify(observed({ type: 'workout_set', id: record.id, revision: record.revision })) : '') });
    setMessage(null);
  }
  async function save(acceptedReview = false) {
    return serializeTraining(runtime.database, async () => {
      if (!draft.ready) return;
      const fields = { ...draft.read() };
      if (fields.dirty !== 'yes' && !acceptedReview) return;
      const inputResult = trainingSetInputSchema.safeParse({ id: rowId, sessionExerciseId: exercise.id, ordinal: Number(fields.ordinal),
        reps: Number(fields.reps), load: bodyweight ? null : { value: fields.load, unit: fields.unit, semantics: exercise.displaySnapshot.loadSemantics }, rpe: fields.rpe.trim() ? Number(fields.rpe) : null, setType: fields.setType, note: fields.note || null });
      // Normalization is shared with every manual number input; never guess comma meaning.
      let input;
      try { input = trainingSetInputSchema.parse({ ...(inputResult.success ? inputResult.data : { id: rowId, sessionExerciseId: exercise.id, ordinal: Number(fields.ordinal), setType: fields.setType, note: fields.note || null }),
        reps: Number(normalizeManualDecimal(fields.reps)), load: bodyweight ? null : { value: normalizeManualDecimal(fields.load), unit: fields.unit, semantics: exercise.displaySnapshot.loadSemantics },
        rpe: fields.rpe.trim() ? Number(normalizeManualDecimal(fields.rpe)) : null }); if (input.load) normalizeMass(input.load.value, input.load.unit); }
      catch { await draft.flush(); setMessage('training:rowIncomplete'); return; }
      setBusy(true);
      try {
        // Capture the exact submitted draft before yielding to ledger reads. Later edits keep their own token.
        const token = await draft.flush();
        const ledger = await runtime.database.readLedger(); if (!ledger) throw Error('Storage');
        const commands = await runtime.database.listCommands(), model = trainingProjection(ledger, commands);
        const root = (acceptedReview && issue?.mutation.kind === 'day-set.create' && issue.mutation.input.createSession ? model.sessions.find(item => item.localDate === session.localDate && item.status === 'recorded') : null) ?? model.sessions.find(item => item.id === session.id) ?? session;
        if (!root || !['draft', 'in_progress', 'paused', 'completed', 'recorded'].includes(root.status)) throw Error('Gone');
        const problem = commands.find(command => ['conflict', 'needs_review', 'rejected'].includes(command.state) && 'session' in command.mutation && command.mutation.session.id === root.id);
        if (problem && !acceptedReview) { await draft.flush(); setMessage('training:blocked'); return; }
        const current = model.sets.find(item => item.id === rowId);
        if ((fields.targetId || issue?.mutation.kind === 'set.update' || issue?.mutation.kind === 'day-set.update') && !current) throw Error('Gone');
        if (current && !acceptedReview && current.loadDecimal === (input.load?.value ?? null) && current.unit === (input.load?.unit ?? null) && current.reps === input.reps && current.rpeHalfUnits === (input.rpe === null ? null : input.rpe * 2) && current.setType === input.setType && current.note === input.note) {
          if (JSON.stringify(draft.read()) === JSON.stringify(fields)) await draft.clear({ ...fields, dirty: 'no' });
          setMessage(null); return;
        }
        const rootBase = acceptedReview ? observed({ type: 'workout_session', id: root.id, revision: root.revision }) : fields.rootBinding ? advanceOwnBinding(versionBindingSchema.parse(JSON.parse(fields.rootBinding)), commands) : versionFor({ type: 'workout_session', id: root.id, revision: root.revision }, commands);
        const target = current ? acceptedReview ? observed({ type: 'workout_set', id: rowId, revision: current.revision }) : fields.targetBinding ? advanceOwnBinding(versionBindingSchema.parse(JSON.parse(fields.targetBinding)), commands) : versionFor({ type: 'workout_set', id: rowId, revision: current.revision }, commands) : null;
        const mutation = target ? { kind: 'day-set.update' as const, localDate: root.localDate, session: { ...rootBase, type: 'workout_session' as const }, target: { ...target, type: 'workout_set' as const },
          input: { reps: input.reps, load: input.load, rpe: input.rpe, setType: input.setType, note: input.note } }
          : { kind: 'day-set.create' as const, session: { ...rootBase, type: 'workout_session' as const }, input: { ...input, completedAt: null, localDate: root.localDate, entryTimezone: root.entryTimezone, createSession: !model.sessions.some(item => item.id === root.id), exercise: { id: exercise.id, setupId: exercise.setupId, ordinal: exercise.ordinal, target: exercise.targetSnapshot } } };
        const command = commandFor(ledger, mutation, rowId, root.localDate, root.entryTimezone);
        const setupBinding = versionFor({ type: 'exercise_setup', id: setup.id, revision: setup.revision }, commands);
        if (setupBinding.source.kind === 'receipt' && !command.dependencies.includes(setupBinding.source.operationId)) command.dependencies.push(setupBinding.source.operationId);
        if (acceptedReview && issue) {
          const previous = await runtime.database.readCommand(issue.operationId); if (!previous) throw Error('Gone');
          await runtime.database.resolveCommand(previous.operationId, previous.localRevision, command, token);
        } else await runtime.database.enqueueCommand(command, token);
        const next = { ...draft.read(), targetId: rowId, rootBinding: JSON.stringify({ type: 'workout_session', id: session.id, source: { kind: 'receipt', operationId: command.operationId } }),
          targetBinding: JSON.stringify({ type: 'workout_set', id: rowId, source: { kind: 'receipt', operationId: command.operationId } }) };
        if (JSON.stringify(draft.read()) === JSON.stringify(fields)) draft.resetAfterSubmit({ ...next, dirty: 'no' }); else draft.replace(next);
        setMessage(null); setReviewing(false); void runtime.queue.flush();
      } catch (error) { setMessage(error instanceof Error && error.message === 'Gone' ? 'training:recordGone' : 'training:saveError'); throw error; }
      finally { setBusy(false); }
    });
  }
  handler.current = () => save();
  useEffect(() => {
    const commit = (event: Event) => (event as CustomEvent<Array<() => Promise<unknown>>>).detail.push(() => handler.current());
    window.addEventListener('lowkkey:commit-editing', commit);
    return () => window.removeEventListener('lowkkey:commit-editing', commit);
  }, []);
  async function remove(acceptedReview = false) {
    try {
      await serializeTraining(runtime.database, async () => {
        const ledger = await runtime.database.readLedger(); if (!ledger) throw Error('Storage');
        const commands = await runtime.database.listCommands(), model = trainingProjection(ledger, commands);
        const root = model.sessions.find(item => item.id === session.id) ?? session, actual = model.sets.find(item => item.id === rowId);
        if (!root) throw Error('Gone');
        if (issue && !acceptedReview) { setMessage('training:blocked'); return; }
        if (actual) {
          const parent = acceptedReview ? observed({ type: 'workout_session', id: root.id, revision: root.revision }) : deletionBaseline.current ? advanceOwnBinding(deletionBaseline.current.root, commands) : versionFor({ type: 'workout_session', id: root.id, revision: root.revision }, commands);
          const target = acceptedReview ? observed({ type: 'workout_set', id: actual.id, revision: actual.revision }) : deletionBaseline.current?.target ? advanceOwnBinding(deletionBaseline.current.target, commands) : versionFor({ type: 'workout_set', id: actual.id, revision: actual.revision }, commands);
          const command = commandFor(ledger, { kind: 'day-set.delete', localDate: root.localDate, session: { ...parent, type: 'workout_session' }, target: { ...target, type: 'workout_set' } }, rowId, root.localDate, root.entryTimezone);
          if (acceptedReview && issue) await runtime.database.resolveCommand(issue.operationId, issue.localRevision, command); else await runtime.database.enqueueCommand(command);
        }
        await draft.clear(); setMore(false); setReviewing(false); onRemoved(); void runtime.queue.flush();
      });
    } catch { setMessage('training:saveError'); }
  }
  function remember() {
    void runtime.database.saveScene({ ownerId: runtime.database.ownerId, view: 'session', sessionId: session.id, currentGroupId: rowId, draftId, localDate: session.localDate, timerStartedAt: session.startedAt, scrollY: window.scrollY, updatedAt: new Date().toISOString() }).catch(() => setMessage('storageFailed'));
  }
  const syncFailed = pending?.state === 'uncertain';
  const label = (field: string) => t('training:setNumber', { number: ordinal }) + ' · ' + t('training:' + field);
  return <div className={'set-row-wrap' + (issue ? ' has-issue' : '')} data-set-id={rowId} data-recorded={!!record}>
    <div role="row" ref={rowElement} className="set-row" aria-busy={busy} onFocus={remember} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !document.hidden && document.hasFocus() && !more && !reviewing) rowExit();
    }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) { event.preventDefault(); void save().then(() => (event.target as HTMLInputElement).blur()).catch(() => undefined); } }}>
      <div role="cell"><button type="button" className="set-number quiet numeric" aria-label={label('rowOptions')} onClick={() => { deletionBaseline.current = { root: observed({ type: 'workout_session', id: session.id, revision: session.revision }), target: record ? observed({ type: 'workout_set', id: record.id, revision: record.revision }) : null }; setMore(true); }}>{ordinal}<span aria-hidden="true">···</span></button></div>
      <div role="cell" className="row-load">{bodyweight ? <span className="bodyweight-mark" aria-label={t('training:bodyweight')}>—</span> : <input aria-label={label('load')} inputMode="decimal" autoComplete="off" placeholder="—" disabled={!draft.ready} value={draft.fields.load} onChange={event => change('load', event.target.value)} />}{!bodyweight && draft.fields.unit !== setup.loadUnit && <span className="row-original-unit">{draft.fields.unit}</span>}</div>
      <div role="cell"><input aria-label={label('reps')} inputMode="numeric" autoComplete="off" placeholder="—" disabled={!draft.ready} value={draft.fields.reps} onChange={event => change('reps', event.target.value)}/></div>
      <div role="cell"><input aria-label={label('rpe')} inputMode="decimal" autoComplete="off" placeholder="—" disabled={!draft.ready} value={draft.fields.rpe} onChange={event => change('rpe', event.target.value)}/></div>
    </div>
    <SaveStatus command={pending} dataRevision={dataRevision}/>
    {(message || draft.error || issue || syncFailed) && <div className="row-status" role={message || draft.error || issue ? 'alert' : 'status'}>
      {t(draft.error ? 'storageFailed' : message ?? (issue ? 'conflict' : syncFailed ? 'syncFailed' : 'syncing'))}
      {syncFailed && <button className="quiet" onClick={() => { void runtime.queue.retry(); }}>{t('retry')}</button>}
      {issue && <><button className="quiet" onClick={() => setReviewing(true)}>{t('training:review')}</button><button className="quiet" onClick={() => { void runtime.database.resolveCommand(issue.operationId, issue.localRevision).then(() => setMessage(null)).catch(() => setMessage('storageFailed')); }}>{t('discard')}</button></>}
      {message === 'training:saveError' && <button className="quiet" onClick={() => { void save().catch(() => undefined); }}>{t('retry')}</button>}
    </div>}
    {more && <ConfirmDialog title={label('rowOptions')} onCancel={() => { setMore(false); void save().catch(() => undefined); }}>
      {confirmDelete ? <><p>{t('training:confirmDeleteSet')}</p><button className="danger" onClick={() => { void remove(); }}>{t('training:remove')}</button></> : <>
        <label>{t('training:unit')}<select aria-label={t('training:unit')} value={draft.fields.unit} onChange={event => change('unit', event.target.value)}><option>kg</option><option>lb</option></select></label>
        <label>{t('training:setType')}<select aria-label={t('training:setType')} value={draft.fields.setType} onChange={event => change('setType', event.target.value)}>{setTypeSchema.options.map(type => <option key={type} value={type}>{t('training:type_' + type)}</option>)}</select></label>
        <label>{t('training:note')}<textarea maxLength={500} value={draft.fields.note} onChange={event => change('note', event.target.value)}/></label>
        <button className="quiet danger" onClick={() => setConfirmDelete(true)}>{t('training:remove')}</button>
      </>}
      <button className="secondary" onClick={() => { setMore(false); setConfirmDelete(false); void save().catch(() => undefined); }}>{t('training:done')}</button>
    </ConfirmDialog>}
    {reviewing && <ConfirmDialog title={t('training:review')} onCancel={() => setReviewing(false)}>
      {issue?.mutation.kind === 'day-set.delete' || issue?.mutation.kind === 'set.delete' ? <><p>{t('training:confirmDeleteSet')} {record ? (record.loadDecimal ?? '—') + ' × ' + record.reps : '—'}</p><button className="danger" onClick={() => { void remove(true); }}>{t('training:remove')}</button></> : <><p>{t('training:reviewRow', { current: record ? (record.loadDecimal ?? '—') + ' × ' + record.reps : '—', proposed: draft.fields.load + ' × ' + draft.fields.reps })}</p><button disabled={busy} onClick={() => { void save(true).catch(() => undefined); }}>{t('training:applyEdit')}</button></>}
      <button className="secondary" onClick={() => setReviewing(false)}>{t('cancel')}</button>
    </ConfirmDialog>}
  </div>;
}
