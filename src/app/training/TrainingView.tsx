import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalLedger } from '../../domain/local-ledger.ts';
import type { ProfileSnapshot } from '../../domain/profile.ts';
import { observed } from '../../domain/manual-commands.ts';
import type { QueuedCommand } from '../../domain/manual-commands.ts';
import type { SessionExercise } from '../../domain/training.ts';
import { sessionExerciseSchema } from '../../domain/training.ts';
import { localDateAt } from '../../domain/primitives.ts';
import { effectiveTimezone } from '../../domain/time.ts';
import type { WorkspaceRuntime } from '../workspace-state.ts';
import { commandFor } from '../workspace-state.ts';
import { useDraft } from '../use-draft.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { ExercisePicker } from './ExercisePicker.tsx';
import { TrainingExercise } from './TrainingExercise.tsx';
import type { Binding } from './training-state.ts';
import { dailySession, trainingProjection, versionFor } from './training-state.ts';
import { advanceOwnBinding, commitTrainingRows } from './save-coordinator.ts';

export function TrainingView({ runtime, ledger, profile, commands, date, navigate }: {
  runtime: WorkspaceRuntime; ledger: LocalLedger; profile: ProfileSnapshot; commands: QueuedCommand[]; date: string; navigate: (path: string) => Promise<void>;
}) {
  const { t } = useTranslation(), timezone = effectiveTimezone(profile.timezone, profile.pendingTimezone, profile.timezoneEffectiveDate, new Date()), today = localDateAt(new Date(), timezone);
  const model = useMemo(() => trainingProjection(ledger, commands), [ledger, commands]);
  const draft = useDraft(runtime.database, 'training-day:' + date, 'set', { sessionId: crypto.randomUUID(), groups: '[]' }, timezone, () => ({ baseRefs: [], localDate: date }));
  const [picker, setPicker] = useState(false), [expanded, setExpanded] = useState<string | null>(null), [remove, setRemove] = useState<SessionExercise | null>(null), [removeRoot, setRemoveRoot] = useState<Binding | null>(null), [removeIssue, setRemoveIssue] = useState<QueuedCommand | null>(null), [error, setError] = useState(false);
  const localGroups = useMemo(() => { try { return sessionExerciseSchema.array().parse(JSON.parse(draft.fields.groups)); } catch { return []; } }, [draft.fields.groups]);
  const roots = model.sessions.filter(item => item.localDate === date && !item.deletedAt && !['cancelled','deleted'].includes(item.status));
  const root = roots.find(item => item.status === 'recorded') ?? dailySession(ledger.ownerId, date, timezone, draft.fields.sessionId);
  const rootIds = new Set(roots.map(item => item.id));
  const groups = [...model.exercises.filter(item => rootIds.has(item.sessionId))];
  for (const group of localGroups) if (!groups.some(item => item.id === group.id) && !ledger.items.has('session_exercise:' + group.id)) groups.push(group);
  const full = { ...model, exercises: [...model.exercises, ...localGroups.filter(item => !model.exercises.some(value => value.id === item.id))] };
  const actual = model.sets.filter(item => groups.some(group => group.id === item.sessionExerciseId));
  const count = new Set(actual.map(item => item.sessionExerciseId)).size;
  useEffect(() => { if (!expanded && groups.length) setExpanded(groups[0].id); }, [groups.length, expanded]);
  async function addDraft(group: SessionExercise) {
    const previous = sessionExerciseSchema.array().parse(JSON.parse(draft.read().groups));
    draft.replace({ ...draft.read(), groups: JSON.stringify([...previous.filter(item => item.id !== group.id), group]) }); await draft.flush();
  }
  const issues = commands.filter(command => command.localDate === date && (command.mutation.kind === 'day-exercise.delete' || command.mutation.kind === 'session-exercise.delete') && ['conflict','needs_review','rejected'].includes(command.state));
  function beginRemove(group: SessionExercise, issue: QueuedCommand | null = null) {
    const parent = roots.find(item => item.id === group.sessionId) ?? root;
    setRemove(group); setRemoveRoot(observed({ type: 'workout_session', id: parent.id, revision: parent.revision })); setRemoveIssue(issue);
  }
  async function removeGroup() {
    if (!remove) return;
    try {
      await commitTrainingRows();
      const current = await runtime.database.readLedger(); if (!current) throw Error();
      const queued = await runtime.database.listCommands(), fresh = trainingProjection(current, queued), saved = fresh.exercises.find(item => item.id === remove.id);
      if (saved) {
        const parent = fresh.sessions.find(item => item.id === saved.sessionId)!;
        const candidates = queued.filter(item => item.operationId !== removeIssue?.operationId);
        const binding = removeRoot ? advanceOwnBinding(removeRoot, candidates) : versionFor({ type: 'workout_session', id: parent.id, revision: parent.revision }, candidates);
        const target = advanceOwnBinding(observed({ type: 'session_exercise', id: remove.id, revision: remove.revision }), candidates);
        const command = commandFor(current, { kind: 'day-exercise.delete', localDate: date, session: { ...binding, type: 'workout_session' }, target: { ...target, type: 'session_exercise' } }, saved.id, date, parent.entryTimezone);
        if (removeIssue) await runtime.database.resolveCommand(removeIssue.operationId, removeIssue.localRevision, command); else await runtime.database.enqueueCommand(command);
      }
      draft.replace({ ...draft.read(), groups: JSON.stringify(localGroups.filter(item => item.id !== remove.id)) }); await draft.flush();
      for (const value of await runtime.database.listDrafts()) if (value.id.startsWith('training:' + remove.sessionId + ':' + remove.id + ':')) await runtime.database.removeDraft(value.id);
      setRemove(null); setRemoveIssue(null); void runtime.queue.flush();
    } catch { setError(true); }
  }
  return <div className="training-view daily-training" data-training-date={date}>
    <div className="daily-heading"><h1>{t('today:training')}</h1><input aria-label={t('date')} type="date" value={date} max={today} onChange={event => { if (event.target.value && event.target.value <= today) void navigate('/training?date=' + event.target.value); }}/></div>
    <p className="day-summary">{t('daily:trainingSummary', { actions: count, sets: actual.length })}</p>
    {groups.map(exercise => { const session = roots.find(item => item.id === exercise.sessionId) ?? dailySession(ledger.ownerId, date, timezone, exercise.sessionId), setup = model.setups.find(item => item.id === exercise.setupId); return setup ? <TrainingExercise key={exercise.id} runtime={runtime} ledger={ledger} model={full} session={session} exercise={exercise} setup={setup} commands={commands} blocked={false} expanded={expanded === exercise.id} onExpand={() => { void commitTrainingRows().then(() => setExpanded(exercise.id)).catch(() => setError(true)); }} onRemove={() => beginRemove(exercise)} onAdded={setExpanded} onDraft={addDraft}/> : null; })}
    {issues.map(command => <div className="row-status" role="alert" data-exercise-issue key={command.operationId}><span>{t('conflict')}</span>{'target' in command.mutation && groups.some(group => group.id === ('target' in command.mutation ? command.mutation.target.id : null)) && <button className="quiet" onClick={() => { const group = groups.find(item => item.id === ('target' in command.mutation ? command.mutation.target.id : null)); if (group) beginRemove(group, command); }}>{t('review')}</button>}<button className="quiet" onClick={() => { void runtime.database.resolveCommand(command.operationId, command.localRevision).catch(() => setError(true)); }}>{t('discard')}</button></div>)}
    <button className={groups.length ? 'secondary add-exercise' : 'add-exercise'} disabled={!draft.ready} onClick={() => { void commitTrainingRows().then(() => setPicker(true)).catch(() => setError(true)); }}>＋ {t('training:addExercise')}</button>
    {error && <p role="alert">{t('storageFailed')}</p>}
    {picker && <ExercisePicker runtime={runtime} ledger={ledger} model={full} session={root} profile={profile} onDraft={addDraft} onAdded={id => { setExpanded(id); setPicker(false); }} onClose={() => setPicker(false)}/>}
    {remove && <ConfirmDialog title={t('training:remove')} onCancel={() => setRemove(null)}><p>{t('daily:deleteExercise')}</p><button className="danger" onClick={() => { void removeGroup(); }}>{t('remove')}</button><button className="secondary" onClick={() => setRemove(null)}>{t('cancel')}</button></ConfirmDialog>}
  </div>;
}
