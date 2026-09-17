import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalLedger } from '../../domain/local-ledger.ts';
import type { ProfileSnapshot } from '../../domain/profile.ts';
import type { ManualMutation, QueuedCommand } from '../../domain/manual-commands.ts';
import { manualMutationSchema, observed } from '../../domain/manual-commands.ts';
import type { SessionExercise, WorkoutSession } from '../../domain/training.ts';
import { sessionInputSchema } from '../../domain/training.ts';
import { localDateAt } from '../../domain/primitives.ts';
import { effectiveTimezone } from '../../domain/time.ts';
import type { WorkspaceRuntime } from '../workspace-state.ts';
import { commandFor } from '../workspace-state.ts';
import { flushDrafts, useDraft } from '../use-draft.ts';
import { NumericText } from '../NumericText.tsx';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { commitTrainingRows } from './save-coordinator.ts';
import { ExercisePicker } from './ExercisePicker.tsx';
import { TrainingExercise } from './TrainingExercise.tsx';
import { sessionIdFor, trainingKinds, trainingProjection, versionFor } from './training-state.ts';
import type { Binding } from './training-state.ts';

type Dialog = { kind: 'finish' | 'cancel' | 'delete'; root: Binding; hasDraft: boolean }
  | { kind: 'exercise'; root: Binding; target: Binding; exercise: SessionExercise }
  | { kind: 'review'; command: QueuedCommand; mutation: ManualMutation };
const stateText: Record<QueuedCommand['state'], string> = { queued: 'savedLocally', sending: 'syncing', uncertain: 'syncFailed', committed: 'synced', conflict: 'conflict', needs_review: 'needsReview', rejected: 'rejected', discarded: 'discard' };
const terminal = ['conflict', 'needs_review', 'rejected'];

export function TrainingView({ runtime, ledger, profile, commands, sessionId, navigate }: {
  runtime: WorkspaceRuntime; ledger: LocalLedger; profile: ProfileSnapshot; commands: QueuedCommand[]; sessionId: string | null; navigate: (path: string) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const timezone = effectiveTimezone(profile.timezone, profile.pendingTimezone, profile.timezoneEffectiveDate, new Date()), today = localDateAt(new Date(), timezone);
  const draft = useDraft(runtime.database, 'training:new-session', 'set', { title: '', date: today }, timezone);
  const model = trainingProjection(ledger, commands), session = model.sessions.find(row => row.id === sessionId);
  const active = model.sessions.find(row => row.status === 'in_progress');
  const exercises = model.exercises.filter(row => row.sessionId === sessionId);
  const ids = new Set(exercises.map(row => row.id)), sets = model.sets.filter(row => ids.has(row.sessionExerciseId));
  const pending = commands.filter(command => trainingKinds.has(command.mutation.kind) && !['committed', 'discarded'].includes(command.state) && (!sessionId || sessionIdFor(command.mutation) === sessionId || sessionIdFor(command.mutation) === null));
  const blocked = pending.some(command => terminal.includes(command.state));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [dialog, setDialog] = useState<Dialog | null>(null), [expanded, setExpanded] = useState<string | null>(null), [picker, setPicker] = useState(false), [clock, setClock] = useState(Date.now());
  const submitting = useRef(false), restored = useRef<string | null>(null);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!sessionId || restored.current === sessionId) return;
    restored.current = sessionId;
    void runtime.database.readScene().then(scene => { if (scene?.view === 'session' && scene.sessionId === sessionId) { const match = exercises.find(ex => ex.id === scene.currentGroupId || model.sets.some(row => row.id === scene.currentGroupId && row.sessionExerciseId === ex.id) || scene.draftId?.startsWith('training:' + sessionId + ':' + ex.id)); if (match) setExpanded(match.id); requestAnimationFrame(() => window.scrollTo(0, scene.scrollY)); } }).catch(() => setMessage('storageFailed'));
  }, [runtime, sessionId]);
  async function start() {
    if (submitting.current) return; submitting.current = true; setBusy(true); setMessage(null);
    try {
      if (draft.fields.date > today) throw Error('Invalid date');
      const id = crypto.randomUUID(), input = sessionInputSchema.parse({ id, localDate: draft.fields.date, entryTimezone: timezone, timePrecision: draft.fields.date === today ? 'instant' : 'date', title: draft.fields.title.trim() || null });
      const command = commandFor(ledger, { kind: 'session.create', input }, id, input.localDate, timezone);
      await runtime.database.enqueueCommand(command, await draft.flush());
      draft.resetAfterSubmit({ title: '', date: today }); void runtime.queue.flush(); await navigate('/training/sessions/' + id);
    } catch (failure) { setMessage(failure instanceof Error && (failure.name === 'ZodError' || failure.message === 'Invalid date') ? 'training:invalid' : 'training:saveError'); }
    finally { submitting.current = false; setBusy(false); }
  }
  function rootBinding(root: WorkoutSession) { return versionFor({ type: 'workout_session', id: root.id, revision: root.revision }, commands); }
  async function lifecycle(kind: 'finish' | 'cancel' | 'delete') {
    if (!session) return;
    try {
      await commitTrainingRows(); await flushDrafts();
      const current = await runtime.database.readLedger(); if (!current) throw Error();
      const allCommands = await runtime.database.listCommands(), fresh = trainingProjection(current, allCommands), root = fresh.sessions.find(item => item.id === session.id); if (!root) throw Error();
      const freshBinding = versionFor({ type: 'workout_session', id: root.id, revision: root.revision }, allCommands);
      if (kind === 'finish' && !fresh.sets.some(row => fresh.exercises.some(ex => ex.id === row.sessionExerciseId && ex.sessionId === root.id))) { setMessage('training:noSets'); return; }
      const drafts = await runtime.database.listDrafts();
      const hasDraft = drafts.some(draft => draft.id.startsWith('training:' + session.id + ':') && (draft.rawFields.dirty === 'yes' || draft.id.endsWith(':set')) && ['load', 'reps', 'rpe', 'note'].some(key => draft.rawFields[key]?.trim()));
      if (kind === 'finish' && !hasDraft) { transition('finish', freshBinding); return; }
      setDialog({ kind, root: freshBinding, hasDraft });
    } catch { setMessage('storageFailed'); }
  }
  async function enqueue(mutation: ManualMutation, id: string) {
    if (submitting.current || !session) return; submitting.current = true; setBusy(true); setMessage(null);
    try {
      await runtime.database.enqueueCommand(commandFor(ledger, mutation, id, session.localDate, session.entryTimezone));
      setDialog(null); void runtime.queue.flush();
    } catch { setMessage('training:saveError'); }
    finally { submitting.current = false; setBusy(false); }
  }
  function transition(action: 'pause' | 'resume' | 'finish' | 'cancel' | 'delete', binding?: Binding) {
    if (!session) return;
    const target = binding ?? rootBinding(session);
    void enqueue({ kind: 'session.transition', target: { ...target, type: 'workout_session' }, action }, session.id);
  }
  async function beginReview(command: QueuedCommand) {
    setMessage(null);
    try {
      await runtime.synchronizer.refresh();
      const current = await runtime.database.readLedger(); if (!current) throw Error();
      const mutation = command.mutation;
      if (mutation.kind === 'set.create' || mutation.kind === 'set.update') {
        const targetSession = mutation.session.id;
        await navigate('/training/sessions/' + targetSession); const id = mutation.kind === 'set.create' ? mutation.input.sessionExerciseId : model.sets.find(row => row.id === mutation.target.id)?.sessionExerciseId; if (id) setExpanded(id); return;
      }
      const binding = (ref: Binding): Binding => {
        const item = current.items.get(ref.type + ':' + ref.id);
        if (!item || !('revision' in item.value) || !('deletedAt' in item.value) || item.value.deletedAt !== null) throw Error('Missing');
        return observed({ type: ref.type, id: ref.id, revision: item.value.revision });
      };
      const replacement = manualMutationSchema.parse({ ...mutation, ...('session' in mutation ? { session: binding(mutation.session) } : {}), ...('target' in mutation ? { target: binding(mutation.target) } : {}) });
      setDialog({ kind: 'review', command, mutation: replacement });
    } catch { setMessage('training:recordGone'); }
  }
  async function commitReview() {
    if (dialog?.kind !== 'review' || submitting.current) return; submitting.current = true; setBusy(true);
    try {
      const next = commandFor(ledger, dialog.mutation, dialog.command.clientEntityId, dialog.command.localDate, dialog.command.entryTimezone);
      // Explicitly reviewed replacements never inherit an unresolved dependency.
      const dependencies = commands.filter(command => dialog.command.dependencies.includes(command.operationId));
      if (dependencies.some(command => command.state !== 'committed')) throw Error();
      next.dependencies = [...new Set([...next.dependencies, ...dependencies.map(command => command.operationId)])];
      await runtime.database.resolveCommand(dialog.command.operationId, dialog.command.localRevision, next);
      setDialog(null); void runtime.queue.flush();
    } catch { setMessage('training:blocked'); }
    finally { submitting.current = false; setBusy(false); }
  }
  function candidate(command: QueuedCommand) {
    const mutation = command.mutation;
    if ((mutation.kind === 'set.create' || mutation.kind === 'set.update')) return (mutation.input.load?.value ?? '—') + ' ' + (mutation.input.load?.unit ?? '') + ' × ' + (mutation.input.reps ?? '—');
    if (mutation.kind === 'exercise.create') return mutation.input.name;
    if (mutation.kind === 'setup.create') return (mutation.input.equipmentInstance ?? t('training:unknown')) + ' · ' + t('training:semantics_' + mutation.input.loadSemantics);
    if (mutation.kind === 'session.create') return mutation.input.title ?? t('training:unnamed');
    if (mutation.kind === 'session.transition') return t('training:' + (mutation.action === 'cancel' ? 'cancelWorkout' : mutation.action === 'delete' ? 'deleteWorkout' : mutation.action));
    return t(mutation.kind.endsWith('.delete') ? 'training:remove' : 'training:edit');
  }
  const pendingFinish = session?.status === 'completed' && model.pending.get(session.id)?.mutation.kind === 'session.transition' && model.pending.get(session.id)?.state !== 'committed';
  const currentExercise = exercises.find(item => item.id === expanded) ?? exercises[0];
  const currentName = currentExercise ? model.labels.get(currentExercise.displaySnapshot.exerciseId)?.[i18n.resolvedLanguage ?? 'en'] ?? currentExercise.displaySnapshot.name : t('training:addExercise');
  async function chooseExercise(id: string) { try { await commitTrainingRows(); setExpanded(id); } catch { setMessage('training:saveError'); } }
  async function pauseResume(action: 'pause' | 'resume') {
    try { await commitTrainingRows(); const current = await runtime.database.readLedger(); if (!current || !session) throw Error();
      const commands = await runtime.database.listCommands(), root = trainingProjection(current, commands).sessions.find(item => item.id === session.id); if (!root) throw Error();
      transition(action, versionFor({ type: 'workout_session', id: root.id, revision: root.revision }, commands));
    } catch { setMessage('training:saveError'); }
  }
  return <div className="training-view">
    {!sessionId && <div className="page-heading"><h1>{t('training:title')}</h1></div>}
    {message && <p role="alert">{t(message)}</p>}
    {!sessionId ? <>
      {active && <section className="panel"><p>{t('training:status_in_progress')}</p><button onClick={() => { void navigate('/training/sessions/' + active.id); }}>{t('training:resumeSession')}</button></section>}
      <section className="panel"><h2>{t('training:start')}</h2><form onSubmit={event => { event.preventDefault(); void start(); }}><fieldset disabled={!draft.ready || busy || !!active}>
        <details><summary>{t('training:sessionOptions')}</summary><label htmlFor="training-title">{t('training:name')}</label><input id="training-title" maxLength={120} value={draft.fields.title} onChange={event => draft.change('title', event.target.value)}/>
        <label htmlFor="training-date">{t('date')}</label><input id="training-date" type="date" max={today} required value={draft.fields.date} onChange={event => draft.change('date', event.target.value)}/>
        </details><button type="submit">{t('training:start')}</button></fieldset><p role="status">{draft.error ? t('storageFailed') : draft.saved ? t('savedDraft') : ''}</p></form></section>
      <section className="panel"><h2>{t('training:recent')}</h2>{!model.sessions.length && <p>{t('training:noSessions')}</p>}<ul className="record-list">{model.sessions.filter(row => row.status !== 'deleted').sort((a,b) => b.localDate.localeCompare(a.localDate) || b.createdAt.localeCompare(a.createdAt)).map(row => <li key={row.id}><div><p>{row.title ?? t('training:unnamed')}</p><p><time dateTime={row.localDate}>{row.localDate}</time> · {t('training:status_' + row.status)}</p></div><button className="quiet" onClick={() => { void navigate('/training/sessions/' + row.id); }}>{t('training:resumeSession')}</button></li>)}</ul></section>
    </> : !session || session.status === 'deleted' ? <section className="panel"><p>{t('training:recordGone')}</p><button onClick={() => { void navigate('/training'); }}>{t('training:back')}</button></section> : <>
      <section className="panel training-session" data-session-id={session.id} data-session-state={pendingFinish ? 'completed_pending_sync' : session.status}>
        <div className="training-hero-main"><div><p className="eyebrow">{t(pendingFinish ? 'training:pendingFinish' : 'training:status_' + session.status)}</p><h1>{session.status === 'completed' ? t('training:result') : currentName}</h1></div>
          {['in_progress', 'paused'].includes(session.status) && <button disabled={busy || blocked} onClick={() => { void lifecycle('finish'); }}>{t('training:finish')}</button>}
        </div>
        <div className="training-metrics"><span className="numeric">{session.startedAt ? Math.max(0, Math.floor(((session.endedAt ? Date.parse(session.endedAt) : clock) - Date.parse(session.startedAt)) / 60000)) : '—'} <span className="unit">{t('training:minutes')}</span></span><span><NumericText>{t('training:totalSets', { count: sets.length })}</NumericText></span></div>
        {session.status === 'paused' && <button disabled={busy || blocked} onClick={() => { void pauseResume('resume'); }}>{t('training:resume')}</button>}
        <details className="session-options"><summary>{t('training:sessionOptions')}</summary><p>{session.title ?? t('training:unnamed')} · <time dateTime={session.localDate}>{session.localDate}</time></p><div className="actions">
          <button className="quiet" onClick={() => { void navigate('/training'); }}>{t('training:back')}</button>
          {session.status === 'in_progress' && <button className="quiet" disabled={busy || blocked} onClick={() => { void pauseResume('pause'); }}>{t('training:pause')}</button>}
          {['in_progress', 'paused', 'draft'].includes(session.status) && <button className="quiet" disabled={busy || blocked} onClick={() => { void lifecycle('cancel'); }}>{t('training:cancelWorkout')}</button>}
          {['completed', 'cancelled'].includes(session.status) && <button className="quiet danger" disabled={busy || blocked} onClick={() => { void lifecycle('delete'); }}>{t('training:deleteWorkout')}</button>}
        </div></details>
      </section>
      {blocked && <p className="notice warning">{t('training:blocked')}</p>}
      {exercises.map(exercise => {
        const setup = model.setups.find(row => row.id === exercise.setupId);
        return setup ? <TrainingExercise key={ledger.ownerId + ':' + exercise.id} runtime={runtime} ledger={ledger} model={model} session={session} exercise={exercise} setup={setup} commands={commands} blocked={blocked} expanded={exercise.id === currentExercise?.id} onExpand={() => { void chooseExercise(exercise.id); }} onAdded={id => setExpanded(id)} onRemove={() => {
          if (session.status === 'completed' && sets.every(row => row.sessionExerciseId === exercise.id)) { setMessage('training:deleteCompleted'); return; }
          setDialog({ kind: 'exercise', root: rootBinding(session), target: versionFor({ type: 'session_exercise', id: exercise.id, revision: exercise.revision }, commands), exercise });
        }}/> : <p key={exercise.id} role="alert">{t('training:recordGone')}</p>;
      })}
      {['in_progress', 'paused'].includes(session.status) && !blocked && <button className="secondary add-exercise" onClick={() => { void commitTrainingRows().then(() => setPicker(true)).catch(() => setMessage('training:saveError')); }}>＋ {t('training:addExercise')}</button>}
      {picker && <ExercisePicker key={session.id} runtime={runtime} ledger={ledger} model={model} session={session} profile={profile} onAdded={id => { setExpanded(id); setPicker(false); }} onClose={() => setPicker(false)}/>}
    </>}
    {pending.some(command => terminal.includes(command.state) || command.state === 'uncertain') && <section className="panel pending-list"><h2>{t('training:pending')}</h2>{pending.filter(command => terminal.includes(command.state) || command.state === 'uncertain').map(command => <article key={command.operationId} data-command-state={command.state}>
      <p>{t(stateText[command.state])}</p><p><NumericText>{candidate(command)}</NumericText></p>{command.issue?.params.reason === 'deleteCompletedSessionInstead' && <p>{t('training:deleteCompleted')}</p>}
      {terminal.includes(command.state) && <><p>{t('training:conflictHelp')}</p><div className="actions"><button className="quiet" onClick={() => { void beginReview(command); }}>{t('training:review')}</button><button className="quiet" onClick={() => { void runtime.database.resolveCommand(command.operationId, command.localRevision).catch(() => setMessage('storageFailed')); }}>{t('discard')}</button></div></>}
      {command.state === 'uncertain' && <button className="quiet" onClick={() => { void runtime.queue.retry(); }}>{t('retry')}</button>}
    </article>)}</section>}
    {dialog && <ConfirmDialog title={t(dialog.kind === 'finish' ? 'training:finishTitle' : dialog.kind === 'exercise' ? 'training:confirmDeleteExercise' : dialog.kind === 'review' ? 'training:review' : dialog.kind === 'delete' ? 'training:deleteWorkout' : sets.length ? 'training:cancelHasSets' : 'training:cancelEmpty')} onCancel={() => { if (!busy) setDialog(null); }}>
      {dialog.kind === 'review' ? <><p><NumericText>{candidate(dialog.command)}</NumericText></p><p>{t('training:conflictHelp')}</p><div className="actions"><button className="quiet" disabled={busy} onClick={() => setDialog(null)}>{t('cancel')}</button><button disabled={busy} onClick={() => { void commitReview(); }}>{t('save')}</button></div></> : <>
        {dialog.kind === 'finish' && <p>{t('training:finishDescription')}</p>}
        {'hasDraft' in dialog && dialog.hasDraft && <p>{t('training:halfDraft')}</p>}
        {dialog.kind === 'exercise' && <p>{dialog.exercise.displaySnapshot.name} · <NumericText>{t('training:totalSets', { count: model.sets.filter(row => row.sessionExerciseId === dialog.exercise.id).length })}</NumericText></p>}
        <div className="actions"><button className="quiet" disabled={busy} onClick={() => setDialog(null)}>{t('cancel')}</button>
          {dialog.kind === 'exercise' ? <button className="danger" disabled={busy} onClick={() => { void enqueue({ kind: 'session-exercise.delete', session: { ...dialog.root, type: 'workout_session' }, target: { ...dialog.target, type: 'session_exercise' } }, dialog.target.id); }}>{t('training:remove')}</button> :
            <>{dialog.kind === 'finish' || (dialog.kind === 'cancel' && sets.length > 0) ? <button disabled={busy} onClick={() => transition('finish', dialog.root)}>{t('training:keepAndFinish')}</button> : null}
              {dialog.kind === 'delete' || dialog.kind === 'cancel' ? <button className="danger" disabled={busy} onClick={() => transition(dialog.kind === 'cancel' && sets.length === 0 ? 'cancel' : 'delete', dialog.root)}>{t(dialog.kind === 'cancel' && sets.length === 0 ? 'training:cancelWorkout' : 'training:deleteWorkout')}</button> : null}</>}
        </div>
      </>}
    </ConfirmDialog>}
  </div>;
}
