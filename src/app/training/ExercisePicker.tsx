import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalLedger } from '../../domain/local-ledger.ts';
import type { ProfileSnapshot } from '../../domain/profile.ts';
import type { WorkoutSession } from '../../domain/training.ts';
import { customExerciseInputSchema, equipmentSchema, sessionExerciseInputSchema, setupInputSchema } from '../../domain/training.ts';
import { loadSemanticsSchema, localeSchema } from '../../domain/primitives.ts';
import { normalizeManualDecimal } from '../../domain/numbers.ts';
import type { CommandInput } from '../../domain/manual-commands.ts';
import { commandFor } from '../workspace-state.ts';
import type { WorkspaceRuntime } from '../workspace-state.ts';
import { useDraft } from '../use-draft.ts';
import { nextOrdinal, trainingProjection, versionFor } from './training-state.ts';
import type { TrainingProjection } from './training-state.ts';

export function ExercisePicker({ runtime, ledger, model, session, profile, onAdded }: {
  runtime: WorkspaceRuntime; ledger: LocalLedger; model: TrainingProjection; session: WorkoutSession; profile: ProfileSnapshot; onAdded: (id: string) => void;
}) {
  const { t, i18n } = useTranslation(), locale = localeSchema.parse(i18n.resolvedLanguage);
  const defaults = { exerciseId: '', setupId: '', name: '', equipment: 'unspecified', angle: 'unspecified', grip: 'unspecified', laterality: 'unspecified', instance: '', semantics: 'unspecified', unit: profile.defaultLoadUnit, includesBar: '', barWeight: '', barUnit: 'lb', increment: '', incrementUnit: profile.defaultLoadUnit, available: '', availableUnit: profile.defaultLoadUnit };
  const draft = useDraft(runtime.database, 'training:' + session.id + ':exercise', 'set', defaults, session.entryTimezone);
  const fields = draft.fields, custom = fields.exerciseId === 'custom';
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const definitions = model.definitions.filter(item => item.status === 'active' && item.deletedAt === null && (item.scope === 'personal' || item.catalogReview?.status === 'approved'));
  const name = (id: string) => { const definition = definitions.find(item => item.id === id); return definition?.personalName ?? model.labels.get(id)?.[locale] ?? model.labels.get(id)?.en ?? ''; };
  const choices = definitions.filter(item => item.id === fields.exerciseId || [item.personalName, ...Object.values(model.labels.get(item.id) ?? {})].some(value => value?.normalize('NFKC').toLowerCase().includes(query.normalize('NFKC').toLowerCase())));
  const existing = model.setups.filter(item => item.exerciseId === fields.exerciseId);
  async function submit() {
    if (submitting.current) return; submitting.current = true; setBusy(true); setError(null);
    try {
      const current = await runtime.database.readLedger(); if (!current || current.ownerId !== ledger.ownerId) throw new Error('Storage');
      const previous = await runtime.database.listCommands(), projection = trainingProjection(current, previous);
      const root = projection.sessions.find(item => item.id === session.id);
      if (!root || !['in_progress', 'paused', 'completed'].includes(root.status)) throw new Error('ZodError');
      const batch: CommandInput[] = [], dependencies: string[] = [];
      let exerciseId = fields.exerciseId, setupId = fields.setupId;
      if (custom) {
        exerciseId = crypto.randomUUID();
        const input = customExerciseInputSchema.parse({ id: exerciseId, name: fields.name, locale, equipmentType: fields.equipment, variant: { schemaVersion: 1, angle: fields.angle, grip: fields.grip, laterality: fields.laterality, note: null }, muscles: { schemaVersion: 1, primary: [], secondary: [] } });
        const command = commandFor(current, { kind: 'exercise.create', input }, exerciseId, root.localDate, root.entryTimezone);
        batch.push(command); dependencies.push(command.operationId);
      } else {
        const definition = projection.definitions.find(item => item.id === exerciseId);
        if (!definition || definition.deletedAt || definition.status !== 'active' || (definition.scope === 'system' && definition.catalogReview?.status !== 'approved')) throw new Error('ZodError');
        const binding = versionFor({ type: 'exercise_definition', id: definition.id, revision: definition.revision }, previous);
        if (binding.source.kind === 'receipt') dependencies.push(binding.source.operationId);
      }
      if (!setupId) {
        setupId = crypto.randomUUID();
        const external = fields.semantics === 'external_total', weighted = fields.semantics !== 'bodyweight_only';
        const input = setupInputSchema.parse({
          id: setupId, exerciseId, equipmentInstance: fields.instance.trim() || null, loadSemantics: fields.semantics, loadUnit: fields.unit,
          includesBar: external && fields.includesBar ? fields.includesBar === 'yes' : null,
          barWeightDecimal: external && fields.barWeight ? normalizeManualDecimal(fields.barWeight) : null, barUnit: external && fields.barWeight ? fields.barUnit : null,
          incrementDecimal: weighted && fields.increment ? normalizeManualDecimal(fields.increment) : null, incrementUnit: weighted && fields.increment ? fields.incrementUnit : null,
          availableLoads: weighted && fields.available.trim() ? { schemaVersion: 1, unit: fields.availableUnit, values: fields.available.trim().split(/\n+/).map(normalizeManualDecimal) } : null,
        });
        const command = commandFor(current, { kind: 'setup.create', input }, setupId, root.localDate, root.entryTimezone);
        command.dependencies.push(...dependencies); batch.push(command); dependencies.push(command.operationId);
      } else {
        const setup = projection.setups.find(item => item.id === setupId && item.exerciseId === exerciseId);
        if (!setup) throw new Error('ZodError');
        const binding = versionFor({ type: 'exercise_setup', id: setup.id, revision: setup.revision }, previous);
        if (binding.source.kind === 'receipt') dependencies.push(binding.source.operationId);
      }
      const id = crypto.randomUUID();
      const binding = versionFor({ type: 'workout_session', id: root.id, revision: root.revision }, previous);
      const input = sessionExerciseInputSchema.parse({ id, setupId, ordinal: nextOrdinal(projection.exercises.filter(item => item.sessionId === root.id)) });
      const command = commandFor(current, { kind: 'session-exercise.create', session: { ...binding, type: 'workout_session' }, input }, id, root.localDate, root.entryTimezone);
      command.dependencies = [...new Set([...command.dependencies, ...dependencies])]; batch.push(command);
      await runtime.database.enqueueCommands(batch, await draft.flush());
      draft.resetAfterSubmit(defaults); onAdded(id); void runtime.queue.flush();
    } catch (failure) { setError(failure instanceof Error && (failure.name === 'ZodError' || failure.message === 'ZodError' || failure.message.includes('DECIMAL')) ? 'training:invalid' : 'training:saveError'); }
    finally { submitting.current = false; setBusy(false); }
  }
  const option = (prefix: string, values: string[]) => values.map(value => <option key={value} value={value}>{t('training:' + prefix + '_' + value)}</option>);
  return <section className="panel exercise-picker">
    <h2>{t('training:addExercise')}</h2>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={!draft.ready || busy}>
        <label htmlFor="training-search">{t('training:search')}</label>
        <input id="training-search" value={query} onChange={event => setQuery(event.target.value)}/>
        <label htmlFor="exercise-choice">{t('training:chooseExercise')}</label>
        <select id="exercise-choice" required value={fields.exerciseId} onChange={event => draft.replace({ ...defaults, exerciseId: event.target.value })}>
          <option value="">{t('training:choose')}</option>
          {choices.map(item => <option key={item.id} value={item.id}>{name(item.id)}</option>)}
          <option value="custom">{t('training:custom')}</option>
        </select>
        {!definitions.some(item => item.scope === 'system') && <p className="muted">{t('training:noCatalog')}</p>}
        {custom && <>
          <label htmlFor="exercise-name">{t('training:customName')}</label><input id="exercise-name" required maxLength={120} value={fields.name} onChange={event => draft.change('name', event.target.value)}/>
          <label htmlFor="exercise-equipment">{t('training:equipment')}</label><select id="exercise-equipment" value={fields.equipment} onChange={event => draft.change('equipment', event.target.value)}>{option('equipment', equipmentSchema.options)}</select>
          <div className="training-fields">
            {(['angle', 'grip', 'laterality'] as const).map(key => <label key={key}>{t('training:' + key)}<select value={fields[key]} onChange={event => draft.change(key, event.target.value)}>{option(key, key === 'angle' ? ['unspecified', 'flat', 'incline', 'decline'] : key === 'grip' ? ['unspecified', 'neutral', 'pronated', 'supinated', 'mixed'] : ['unspecified', 'bilateral', 'unilateral', 'alternating'])}</select></label>)}
          </div>
        </>}
        {fields.exerciseId && <>
          <label htmlFor="training-setup">{t('training:configuration')}</label>
          <select id="training-setup" value={fields.setupId} onChange={event => draft.change('setupId', event.target.value)}>
            <option value="">{t('training:newSetup')}</option>{existing.map(setup => <option key={setup.id} value={setup.id}>{setup.equipmentInstance ?? t('training:unknown')} · {t('training:semantics_' + setup.loadSemantics)} · {setup.loadUnit}{setup.includesBar ? ' · ' + t('training:yes') : ''}</option>)}
          </select>
          {!fields.setupId && <>
            <label htmlFor="setup-instance">{t('training:instance')}</label><input id="setup-instance" maxLength={120} value={fields.instance} onChange={event => draft.change('instance', event.target.value)}/>
            <label htmlFor="setup-semantics">{t('training:semantics')}</label><select id="setup-semantics" value={fields.semantics} onChange={event => draft.change('semantics', event.target.value)}>{option('semantics', loadSemanticsSchema.options)}</select>
            <label htmlFor="setup-unit">{t('training:unit')}</label><select id="setup-unit" value={fields.unit} onChange={event => draft.change('unit', event.target.value)}><option>kg</option><option>lb</option></select>
            {fields.semantics === 'external_total' && <>
              <label htmlFor="setup-includes-bar">{t('training:includesBar')}</label><select id="setup-includes-bar" value={fields.includesBar} onChange={event => draft.change('includesBar', event.target.value)}><option value="">{t('training:unknown')}</option><option value="yes">{t('training:yes')}</option><option value="no">{t('training:no')}</option></select>
              <label htmlFor="setup-bar">{t('training:barWeight')}</label><div className="joined-input"><input id="setup-bar" inputMode="decimal" value={fields.barWeight} onChange={event => draft.change('barWeight', event.target.value)}/><select aria-label={t('training:unit')} value={fields.barUnit} onChange={event => draft.change('barUnit', event.target.value)}><option>kg</option><option>lb</option></select></div>
              <p className="muted">{t('training:barRule')}</p>
            </>}
            {fields.semantics === 'per_side' && <p className="muted">{t('training:perSideRule')}</p>}
            {fields.semantics !== 'bodyweight_only' && <details><summary>{t('training:configurationOptions')}</summary>
              <label htmlFor="setup-increment">{t('training:increment')}</label><div className="joined-input"><input id="setup-increment" inputMode="decimal" value={fields.increment} onChange={event => draft.change('increment', event.target.value)}/><select aria-label={t('training:increment') + ' · ' + t('training:unit')} value={fields.incrementUnit} onChange={event => draft.change('incrementUnit', event.target.value)}><option>kg</option><option>lb</option></select></div>
              <label htmlFor="setup-available">{t('training:available')}</label><textarea id="setup-available" value={fields.available} onChange={event => draft.change('available', event.target.value)}/><select aria-label={t('training:available') + ' · ' + t('training:unit')} value={fields.availableUnit} onChange={event => draft.change('availableUnit', event.target.value)}><option>kg</option><option>lb</option></select><p className="muted">{t('training:fixedUnits')}</p>
            </details>}
          </>}
          <button type="submit">{t('training:add')}</button>
        </>}
      </fieldset>
      {error && <p role="alert">{t(error)}</p>}
      <p role="status" className={draft.error ? 'error' : 'muted'}>{draft.error ? t('storageFailed') : draft.saved ? t('savedDraft') : ''}</p>
    </form>
  </section>;
}
