import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalLedger } from '../../domain/local-ledger.ts';
import type { QueuedCommand } from '../../domain/manual-commands.ts';
import type { ExerciseSetup, SessionExercise, WorkoutSession } from '../../domain/training.ts';
import { setupInputSchema } from '../../domain/training.ts';
import type { z } from 'zod';
import type { WorkspaceRuntime } from '../workspace-state.ts';
import { commandFor } from '../workspace-state.ts';
import { latestHistory, nextOrdinal, trainingProjection, versionFor, localExercise } from './training-state.ts';
import type { TrainingProjection } from './training-state.ts';
import { SetRow } from './SetRow.tsx';
import { SetupEditor } from './SetupEditor.tsx';
import { commitTrainingRows, serializeTraining } from './save-coordinator.ts';

type LocalRow = { id: string; draftId: string; ordinal: number; load?: string; unit?: 'kg' | 'lb' };
export function TrainingExercise({ runtime, ledger, model, session, exercise, setup, commands, blocked, expanded, onExpand, onRemove, onAdded, onDraft }: {
  runtime: WorkspaceRuntime; ledger: LocalLedger; model: TrainingProjection; session: WorkoutSession; exercise: SessionExercise; setup: ExerciseSetup;
  commands: QueuedCommand[]; blocked: boolean; expanded: boolean; onExpand: () => void; onRemove: () => void; onAdded: (id: string) => void; onDraft: (exercise: SessionExercise) => Promise<void>;
}) {
  const { t, i18n } = useTranslation(), [local, setLocal] = useState<LocalRow[]>([]), [ready, setReady] = useState(false), [settings, setSettings] = useState<ExerciseSetup | null>(null), [message, setMessage] = useState<string | null>(null);
  const adding = useRef(false);
  const rows = model.sets.filter(item => item.sessionExerciseId === exercise.id);
  const issues = commands.filter(command => { const mutation = command.mutation; return ['conflict', 'needs_review', 'rejected'].includes(command.state) && (((mutation.kind === 'set.create' || mutation.kind === 'day-set.create') && mutation.input.sessionExerciseId === exercise.id) || ((mutation.kind === 'set.update' || mutation.kind === 'day-set.update' || mutation.kind === 'set.delete' || mutation.kind === 'day-set.delete') && rows.some(row => row.id === mutation.target.id))); });
  const prefix = 'training:' + session.id + ':' + exercise.id, history = latestHistory(ledger, session.id, setup.id, session);
  const name = model.labels.get(exercise.displaySnapshot.exerciseId)?.[i18n.resolvedLanguage ?? 'en'] ?? exercise.displaySnapshot.name;
  useEffect(() => {
    let cancelled = false;
    void runtime.database.listDrafts().then(drafts => {
      if (cancelled) return;
      const restored = drafts.filter(item => item.id.startsWith(prefix + ':row:') || item.id === prefix + ':set').map(item => ({ id: item.rawFields.targetId || item.rawFields.rowId || item.rawFields.newId || crypto.randomUUID(), draftId: item.id, ordinal: Number(item.rawFields.ordinal) || nextOrdinal(rows) }));
      if (!restored.length && !rows.length) { const id = crypto.randomUUID(); restored.push({ id, draftId: prefix + ':row:' + id, ordinal: 1 }); }
      setLocal(restored); setReady(true);
    }).catch(() => setMessage('storageFailed'));
    return () => { cancelled = true; };
    // Mount once for this exercise. Live facts are projected independently.
  }, [runtime, prefix]);
  const merged = new Map<string, LocalRow>(rows.map(row => [row.id, { id: row.id, draftId: prefix + ':row:' + row.id, ordinal: row.ordinal }]));
  for (const row of local) merged.set(row.id, row);
  for (const command of issues) if ((command.mutation.kind === 'set.create' || command.mutation.kind === 'day-set.create') && !merged.has(command.mutation.input.id)) merged.set(command.mutation.input.id, { id: command.mutation.input.id, draftId: prefix + ':row:' + command.mutation.input.id, ordinal: command.mutation.input.ordinal });
  const presented = [...merged.values()].sort((a,b) => a.ordinal - b.ordinal);
  async function addRow() {
    if (adding.current) return; adding.current = true;
    try {
      await commitTrainingRows();
      const current = await runtime.database.readLedger(); if (!current) throw Error(); const fresh = trainingProjection(current, await runtime.database.listCommands());
      const id = crypto.randomUUID(), last = fresh.sets.filter(item => item.sessionExerciseId === exercise.id).at(-1), ordinal = nextOrdinal(presented);
      // Only the previous load carries forward. Reps/RPE are always new observations.
      const next = { id, draftId: prefix + ':row:' + id, ordinal, load: last?.loadDecimal ?? '', unit: last?.unit ?? setup.loadUnit };
      await runtime.database.saveDraft({ id: next.draftId, ownerId: ledger.ownerId, kind: 'set', rawFields: { rowId: id, load: next.load, unit: next.unit, ordinal: String(ordinal), dirty: 'no' }, baseRefs: [], localDate: session.localDate, entryTimezone: session.entryTimezone, updatedAt: new Date().toISOString() });
      setLocal(current => [...current, next]);
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-set-id="' + id + '"] input')?.focus());
    } catch { setMessage('training:saveError'); } finally { adding.current = false; }
  }
  async function applySetup(input: z.infer<typeof setupInputSchema>) {
    const original = settings; if (!original) throw Error('Missing settings');
    await commitTrainingRows();
    await serializeTraining(runtime.database, async () => {
      const current = await runtime.database.readLedger(); if (!current) throw Error('Storage');
      const commands = await runtime.database.listCommands(), projection = trainingProjection(current, commands), root = projection.sessions.find(item => item.id === session.id) ?? session;
      if (!root) throw Error('Gone');
      const critical = (['equipmentInstance', 'loadSemantics', 'includesBar', 'barWeightDecimal', 'barUnit'] as const).some(key => input[key] !== original[key]);
      if (!critical) {
        const target = versionFor({ type: 'exercise_setup', id: original.id, revision: original.revision }, commands);
        await runtime.database.enqueueCommand(commandFor(current, { kind: 'setup.update', target: { ...target, type: 'exercise_setup' }, input: { loadUnit: input.loadUnit, incrementDecimal: input.incrementDecimal, incrementUnit: input.incrementUnit, availableLoads: input.availableLoads } }, setup.id, root.localDate, root.entryTimezone));
      } else {
        const setupId = crypto.randomUUID(), id = crypto.randomUUID();
        const create = commandFor(current, { kind: 'setup.create', input: { ...input, id: setupId } }, setupId, root.localDate, root.entryTimezone);
        await runtime.database.enqueueCommand(create);
        const fresh = trainingProjection(current, await runtime.database.listCommands()), selected = fresh.setups.find(item => item.id === setupId);
        const definition = fresh.definitions.find(item => item.id === input.exerciseId);
        if (!selected || !definition) throw Error('Missing setup');
        await onDraft(localExercise(root, selected, definition, fresh.labels, id, nextOrdinal(model.exercises.filter(item => item.sessionId === root.id))));
        onAdded(id);
      }
      void runtime.queue.flush();
    });
  }
  return <section className="panel training-exercise" data-exercise-id={exercise.id}>
    <button className="exercise-heading quiet" aria-expanded={expanded} onClick={onExpand}><span>{name}</span><span className="numeric">{rows.length}</span></button>
    <div hidden={!expanded}>
      <div className="exercise-tools"><button className="quiet setup-chip" disabled={blocked} onClick={() => { void commitTrainingRows().then(() => setSettings({ ...setup })).catch(() => setMessage('training:saveError')); }}>{t('training:short_' + setup.loadSemantics)} · {setup.loadUnit}</button><button className="quiet" onClick={onRemove} aria-label={t('training:remove') + ' ' + name}>···</button></div>
      {history && <p className="training-reference"><span>{t('training:lastTime', { date: history.session.localDate })}</span> <span className="numeric">{history.sets.map(row => (row.loadDecimal ?? '—') + ' ' + (row.unit ?? '') + ' × ' + row.reps).join(' · ')}</span></p>}
      {exercise.targetSnapshot && <p className="training-reference">{t('training:target', { sets: exercise.targetSnapshot.plannedSets ?? '—', min: exercise.targetSnapshot.repMin ?? '—', max: exercise.targetSnapshot.repMax ?? '—' })}</p>}
      <div role="table" aria-label={name + ' · ' + t('training:sets')} className="set-table">
        <div role="row" className="set-row set-table-head"><span role="columnheader">{t('training:rowNumber')}</span><span role="columnheader">{t('training:load')}</span><span role="columnheader">{t('training:repsShort')}</span><span role="columnheader">RPE</span></div>
        {ready && presented.map(row => <SetRow key={row.id} runtime={runtime} session={session} exercise={exercise} setup={setup} rowId={row.id} ordinal={row.ordinal} record={rows.find(item => item.id === row.id)} draftId={row.draftId} initialLoad={row.load} initialUnit={row.unit} issue={issues.find(command => command.clientEntityId === row.id)} pending={model.pending.get(row.id) ?? commands.findLast(command => command.clientEntityId === row.id && command.state === 'committed')} dataRevision={ledger.dataRevision} onRemoved={() => setLocal(current => current.filter(item => item.id !== row.id))}/>)}
      </div>
      {<button className="add-set quiet" disabled={!ready || blocked} onClick={() => { void addRow(); }}>＋ {t('training:addSet')}</button>}
      {message && <p role="alert">{t(message)}</p>}
    </div>
    {settings && <SetupEditor initial={setupInputSchema.parse(Object.fromEntries(Object.keys(setupInputSchema.shape).map(key => [key, settings[key as keyof ExerciseSetup]])))} onApply={applySetup} onClose={() => setSettings(null)}/>}
  </section>;
}
