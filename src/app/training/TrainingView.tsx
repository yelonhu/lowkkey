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
  const { t } = useTranslation();
  const timezone = effectiveTimezone(profile.timezone, profile.pendingTimezone, profile.timezoneEffectiveDate, new Date()), today = localDateAt(new Date(), timezone);
  const draft = useDraft(runtime.database, 'training:new-session', 'set', { title: '', date: today }, timezone);
  const model = trainingProjection(ledger, commands), session = model.sessions.find(row => row.id === sessionId);
  const active = model.sessions.find(row => row.status === 'in_progress');
  const exercises = model.exercises.filter(row => row.sessionId === sessionId);
  const ids = new Set(exercises.map(row => row.id)), sets = model.sets.filter(row => ids.has(row.sessionExerciseId));
  const pending = commands.filter(command => trainingKinds.has(command.mutation.kind) && !['committed', 'discarded'].includes(command.state) && (!sessionId || sessionIdFor(command.mutation) === sessionId || sessionIdFor(command.mutation) === null));
  const blocked = pending.some(command => terminal.includes(command.state));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [dialog, setDialog] = useState<Dialog | null>(null), [review, setReview] = useState<QueuedCommand | null>(null), [clock, setClock] = useState(Date.now());
  const submitting = useRef(false), restored = useRef<string | null>(null);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!sessionId || restored.current === sessionId) return;
    restored.current = sessionId;
    void runtime.database.readScene().then(scene => { if (scene?.view === 'session' && scene.sessionId === sessionId) requestAnimationFrame(() => window.scrollTo(0, scene.scrollY)); }).catch(() => setMessage('storageFailed'));
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
      await flushDrafts();
      const drafts = await runtime.database.listDrafts();
      const hasDraft = drafts.some(draft => draft.id.startsWith('training:' + session.id + ':') && ['load', 'reps', 'rpe', 'note', 'exerciseId', 'name'].some(key => draft.rawFields[key]?.trim()));
      setDialog({ kind, root: rootBinding(session), hasDraft });
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
        await navigate('/training/sessions/' + targetSession); setReview(command); return;
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
  const summary = <><p className="metric"><NumericText>{t('training:totalSets', { count: sets.length })}</NumericText></p><p className="muted"><NumericText>{t('training:summary', { work: sets.filter(row => row.setType === 'work').length, unknown: sets.filter(row => row.setType === 'unknown').length })}</NumericText></p></>;
  const pendingFinish = session?.status === 'completed' && model.pending.get(session.id)?.mutation.kind === 'session.transition' && model.pending.get(session.id)?.state !== 'committed';
  const reviewMutation = review?.mutation;
  const reviewExerciseId = reviewMutation?.kind === 'set.create' ? reviewMutation.input.sessionExerciseId : reviewMutation?.kind === 'set.update' ? model.sets.find(row => row.id === reviewMutation.target.id)?.sessionExerciseId : null;
  return <div className="training-view">
    <div className="page-heading"><h1>{t('training:title')}</h1><p>{t('training:subtitle')}</p></div>
    {message && <p role="alert">{t(message)}</p>}
    {!sessionId ? <>
      {active && <section className="panel"><p>{t('training:status_in_progress')}</p><button onClick={() => { void navigate('/training/sessions/' + active.id); }}>{t('training:resumeSession')}</button></section>}
      <section className="panel"><h2>{t('training:start')}</h2><form onSubmit={event => { event.preventDefault(); void start(); }}><fieldset disabled={!draft.ready || busy || !!active}>
        <label htmlFor="training-title">{t('training:name')}</label><input id="training-title" maxLength={120} value={draft.fields.title} onChange={event => draft.change('title', event.target.value)}/>
        <label htmlFor="training-date">{t('date')}</label><input id="training-date" type="date" max={today} required value={draft.fields.date} onChange={event => draft.change('date', event.target.value)}/>
        <button type="submit">{t('training:start')}</button></fieldset><p role="status">{draft.error ? t('storageFailed') : draft.saved ? t('savedDraft') : ''}</p></form></section>
      <section className="panel"><h2>{t('training:recent')}</h2>{!model.sessions.length && <p>{t('training:noSessions')}</p>}<ul className="record-list">{model.sessions.filter(row => row.status !== 'deleted').sort((a,b) => b.localDate.localeCompare(a.localDate) || b.createdAt.localeCompare(a.createdAt)).map(row => <li key={row.id}><div><p>{row.title ?? t('training:unnamed')}</p><p><time dateTime={row.localDate}>{row.localDate}</time> · {t('training:status_' + row.status)}</p></div><button className="quiet" onClick={() => { void navigate('/training/sessions/' + row.id); }}>{t('training:resumeSession')}</button></li>)}</ul></section>
    </> : !session || session.status === 'deleted' ? <section className="panel"><p>{t('training:recordGone')}</p><button onClick={() => { void navigate('/training'); }}>{t('training:back')}</button></section> : <>
      <section className="panel training-session" data-session-id={session.id} data-session-state={pendingFinish ? 'completed_pending_sync' : session.status}>
        <div className="section-heading"><div><h2>{session.title ?? t('training:unnamed')}</h2><p><time dateTime={session.localDate}>{session.localDate}</time> · <span role="status">{t(pendingFinish ? 'training:pendingFinish' : 'training:status_' + session.status)}</span></p></div><button className="quiet" onClick={() => { void navigate('/training'); }}>{t('training:back')}</button></div>
        {session.startedAt && <p className="muted"><NumericText>{t('training:elapsed', { minutes: Math.max(0, Math.floor(((session.endedAt ? Date.parse(session.endedAt) : clock) - Date.parse(session.startedAt)) / 60000)) })}</NumericText></p>}
        {session.status === 'completed' && <h3>{t('training:result')}</h3>}{summary}
        {pending.length > 0 && <p className="notice">{t('training:pendingNotice')}</p>}
        <div className="actions">
          {session.status === 'in_progress' && <button className="quiet" disabled={busy || blocked} onClick={() => transition('pause')}>{t('training:pause')}</button>}
          {['paused', 'draft'].includes(session.status) && <button disabled={busy || blocked} onClick={() => transition('resume')}>{t('training:resume')}</button>}
          {['in_progress', 'paused'].includes(session.status) && <button disabled={busy || blocked || !sets.length} onClick={() => { void lifecycle('finish'); }}>{t('training:finish')}</button>}
          {['in_progress', 'paused', 'draft'].includes(session.status) && <button className="quiet" disabled={busy || blocked} onClick={() => { void lifecycle('cancel'); }}>{t('training:cancelWorkout')}</button>}
          {['completed', 'cancelled'].includes(session.status) && <button className="quiet danger" disabled={busy || blocked} onClick={() => { void lifecycle('delete'); }}>{t('training:deleteWorkout')}</button>}
        </div>
      </section>
      {blocked && <p className="notice warning">{t('training:blocked')}</p>}
      {exercises.map(exercise => {
        const setup = model.setups.find(row => row.id === exercise.setupId);
        return setup ? <TrainingExercise key={ledger.ownerId + ':' + exercise.id} runtime={runtime} ledger={ledger} model={model} session={session} exercise={exercise} setup={setup} commands={commands} blocked={blocked} review={reviewExerciseId === exercise.id ? review : null} onReviewed={() => setReview(null)} onRemove={() => {
          if (session.status === 'completed' && sets.every(row => row.sessionExerciseId === exercise.id)) { setMessage('training:deleteCompleted'); return; }
          setDialog({ kind: 'exercise', root: rootBinding(session), target: versionFor({ type: 'session_exercise', id: exercise.id, revision: exercise.revision }, commands), exercise });
        }}/> : <p key={exercise.id} role="alert">{t('training:recordGone')}</p>;
      })}
      {['in_progress', 'paused', 'completed'].includes(session.status) && !blocked && <ExercisePicker key={session.id} runtime={runtime} ledger={ledger} model={model} session={session} profile={profile} onAdded={() => setMessage(null)}/>}
    </>}
    {pending.length > 0 && <section className="panel pending-list"><h2>{t('training:pending')}</h2>{pending.map(command => <article key={command.operationId} data-command-state={command.state}>
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
