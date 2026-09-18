import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalLedger } from '../../domain/local-ledger.ts';
import type { ProfileSnapshot } from '../../domain/profile.ts';
import type { WorkoutSession, SessionExercise } from '../../domain/training.ts';
import { customExerciseInputSchema, equipmentSchema, setupInputSchema } from '../../domain/training.ts';
import { defaultSetup } from '../../domain/training-defaults.ts';
import { localeSchema } from '../../domain/primitives.ts';
import type { CommandInput } from '../../domain/manual-commands.ts';
import { commandFor } from '../workspace-state.ts';
import type { WorkspaceRuntime } from '../workspace-state.ts';
import { useDraft } from '../use-draft.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { nextOrdinal, trainingProjection, versionFor, localExercise } from './training-state.ts';
import type { TrainingProjection } from './training-state.ts';
import { serializeTraining } from './save-coordinator.ts';

export function ExercisePicker({ runtime, ledger, model, session, profile, onAdded, onClose, onDraft }: {
  runtime: WorkspaceRuntime; ledger: LocalLedger; model: TrainingProjection; session: WorkoutSession; profile: ProfileSnapshot; onAdded: (id: string) => void; onClose: () => void; onDraft: (exercise: SessionExercise) => Promise<void>;
}) {
  const { t, i18n } = useTranslation(), locale = localeSchema.parse(i18n.resolvedLanguage);
  const draft = useDraft(runtime.database, 'training:' + session.id + ':exercise', 'set', { exerciseId: '', name: '', equipment: 'unspecified', angle: 'unspecified', grip: 'unspecified', laterality: 'unspecified' }, session.entryTimezone);
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(false), [custom, setCustom] = useState(false);
  const definitions = model.definitions.filter(item => item.status === 'active' && !item.deletedAt && (item.scope === 'personal' || item.catalogReview?.status === 'approved'));
  const recent = [...model.exercises].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(item => item.displaySnapshot.exerciseId);
  const choices = definitions.filter(item => [item.personalName, ...Object.values(model.labels.get(item.id) ?? {})].some(value => value?.normalize('NFKC').toLowerCase().includes(query.normalize('NFKC').toLowerCase()))).sort((a,b) => (recent.indexOf(a.id) < 0 ? 999 : recent.indexOf(a.id)) - (recent.indexOf(b.id) < 0 ? 999 : recent.indexOf(b.id)));
  async function add(selected: string) {
    if (busy) return; setBusy(true); setError(false);
    try { await serializeTraining(runtime.database, async () => {
      const current = await runtime.database.readLedger(); if (!current || current.ownerId !== ledger.ownerId) throw Error('Storage');
      const previous = await runtime.database.listCommands(), projection = trainingProjection(current, previous), root = projection.sessions.find(item => item.id === session.id) ?? session;
      if (!root || !['draft', 'in_progress', 'paused', 'completed', 'recorded'].includes(root.status)) throw Error('Gone');
      const batch: CommandInput[] = [], dependencies: string[] = [];
      let exerciseId = selected;
      if (selected === 'custom') {
        exerciseId = crypto.randomUUID();
        const input = customExerciseInputSchema.parse({ id: exerciseId, name: draft.read().name, locale, equipmentType: draft.read().equipment, variant: { schemaVersion: 1, angle: draft.read().angle, grip: draft.read().grip, laterality: draft.read().laterality, note: null }, muscles: { schemaVersion: 1, primary: [], secondary: [] } });
        const command = commandFor(current, { kind: 'exercise.create', input }, exerciseId, root.localDate, root.entryTimezone); batch.push(command); dependencies.push(command.operationId);
      }
      const latest = [...projection.exercises].filter(item => item.displaySnapshot.exerciseId === exerciseId).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
      const setup = projection.setups.find(item => item.id === latest?.setupId) ?? projection.setups.filter(item => item.exerciseId === exerciseId).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
      const setupId = setup?.id ?? crypto.randomUUID();
      if (!setup) {
        const definition = projection.definitions.find(item => item.id === exerciseId);
        const input = definition ? defaultSetup(definition, profile.defaultLoadUnit, setupId) : setupInputSchema.parse({ id: setupId, exerciseId, loadSemantics: 'unspecified', loadUnit: profile.defaultLoadUnit });
        const command = commandFor(current, { kind: 'setup.create', input }, setupId, root.localDate, root.entryTimezone);
        command.dependencies.push(...dependencies); batch.push(command); dependencies.push(command.operationId);
      } else {
        const binding = versionFor({ type: 'exercise_setup', id: setup.id, revision: setup.revision }, previous);
        if (binding.source.kind === 'receipt') dependencies.push(binding.source.operationId);
      }
      const id = crypto.randomUUID();
      if (batch.length) await runtime.database.enqueueCommands(batch, await draft.flush());
      const fresh = trainingProjection(current, await runtime.database.listCommands());
      const selectedSetup = fresh.setups.find(item => item.id === setupId), definition = fresh.definitions.find(item => item.id === exerciseId);
      if (!selectedSetup || !definition) throw Error('Missing setup');
      await onDraft(localExercise(root, selectedSetup, definition, fresh.labels, id, nextOrdinal(model.exercises.filter(item => item.sessionId === root.id))));
      onAdded(id); void runtime.queue.flush();
    }); } catch { setError(true); } finally { setBusy(false); }
  }
  return <ConfirmDialog title={t('training:addExercise')} onCancel={onClose}>
    <fieldset disabled={busy || !draft.ready}>
      {custom ? <><label>{t('training:customName')}<input maxLength={120} value={draft.fields.name} onChange={event => draft.change('name', event.target.value)}/></label>
        <details><summary>{t('training:configurationOptions')}</summary><label>{t('training:equipment')}<select value={draft.fields.equipment} onChange={event => draft.change('equipment', event.target.value)}>{equipmentSchema.options.map(item => <option key={item} value={item}>{t('training:equipment_' + item)}</option>)}</select></label></details>
        <button onClick={() => { void add('custom'); }}>{t('training:addExercise')}</button></> : <>
        <label className="sr-only" htmlFor="training-search">{t('training:search')}</label><input id="training-search" placeholder={t('training:search')} value={query} onChange={event => setQuery(event.target.value)}/>
        <div className="exercise-choices">{choices.map(item => <button className="exercise-choice secondary" key={item.id} onClick={() => { void add(item.id); }}>{item.personalName ?? model.labels.get(item.id)?.[locale] ?? model.labels.get(item.id)?.en}</button>)}</div>
        <button className="quiet" onClick={() => setCustom(true)}>{t('training:custom')}</button>
      </>}
      {error && <p role="alert">{t('training:saveError')}</p>}
      <button className="secondary" onClick={onClose}>{t('cancel')}</button>
    </fieldset>
  </ConfirmDialog>;
}
