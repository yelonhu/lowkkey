import type { D1Database } from '@cloudflare/workers-types';
import type { Locale } from '../domain/primitives.ts';
import { customExerciseInputSchema, exerciseAliasInputSchema, exerciseAliasPatchSchema, exerciseDefinitionSchema, exerciseDisplaySnapshotSchema, normalizeAlias, personalExerciseSchema, setupInputSchema, setupPatchSchema } from '../domain/training.ts';
import type { ExerciseSetup } from '../domain/training.ts';
import type { AuthContext } from './auth.ts';
import { executeCommand } from './commands.ts';
import type { CommandContext, Guard } from './commands.ts';
import { DomainError } from './errors.ts';
import { expectRevision, newMetadata, reviseRecord } from './record-store.ts';
import { exerciseAliases, personalExercises, setups } from './training-store.ts';
import { pageAfter, pageResult } from './pagination.ts';

export async function readExercise(db: D1Database, owner: string, id: string, includeArchived = false) {
  const row = await db.prepare(`SELECT id,owner_id AS ownerId,revision,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt,scope,catalog_version AS catalogVersion,family_id AS familyId,parent_exercise_id AS parentExerciseId,equipment_type AS equipmentType,variant_json,muscle_groups_json,status,personal_name AS personalName,personal_locale AS personalLocale FROM exercise_definitions WHERE id=? AND (scope='system' OR owner_id=?) AND deleted_at IS NULL${includeArchived ? '' : " AND status='active'"}`).bind(id, owner).first<Record<string, unknown>>();
  if (!row) throw new DomainError('RECORD_NOT_FOUND', 404);
  const { variant_json, muscle_groups_json, ...fields } = row;
  return exerciseDefinitionSchema.parse({ ...fields, variant: JSON.parse(String(variant_json)), muscles: JSON.parse(String(muscle_groups_json)) });
}
export function exerciseGuard(owner: string, id: string, revision: number): Guard {
  return { predicate: "EXISTS(SELECT 1 FROM exercise_definitions WHERE id=? AND revision=? AND (scope='system' OR owner_id=?) AND status='active' AND deleted_at IS NULL)", values: [id, revision, owner], error: new DomainError('CONTEXT_STALE', 422) };
}
export async function displaySnapshot(context: CommandContext, setup: ExerciseSetup) {
  const exercise = await readExercise(context.db, context.auth.id, setup.exerciseId);
  const label = exercise.scope === 'personal' ? { name: exercise.personalName!, locale: exercise.personalLocale! } : await context.db.prepare("SELECT display_name AS name,locale FROM exercise_labels WHERE exercise_id=? AND locale IN (?,'en') ORDER BY CASE WHEN locale=? THEN 0 ELSE 1 END LIMIT 1").bind(exercise.id, context.auth.locale, context.auth.locale).first<{ name: string; locale: Locale }>();
  if (!label) throw new DomainError('TEMPORARY_FAILURE', 503, { reason: 'catalogLabelMissing' });
  return { snapshot: exerciseDisplaySnapshotSchema.parse({ schemaVersion: 1, exerciseId: exercise.id, catalogVersion: exercise.catalogVersion, name: label.name, locale: label.locale, equipmentType: exercise.equipmentType, equipmentInstance: setup.equipmentInstance, variant: exercise.variant, muscles: exercise.muscles, loadSemantics: setup.loadSemantics, includesBar: setup.includesBar, barWeightDecimal: setup.barWeightDecimal, barUnit: setup.barUnit }), guard: exerciseGuard(context.auth.id, exercise.id, exercise.revision) };
}
export function createCustomExercise(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, clock?: () => Date) {
  const input = customExerciseInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'exercise.create', payload: input, entryPoint: 'manual', plan: async context => {
    const parent = input.parentExerciseId ? await readExercise(db, auth.id, input.parentExerciseId) : null;
    const record = personalExerciseSchema.parse({ ...newMetadata(context, input.id), scope: 'personal', catalogVersion: 'personal-v1', familyId: parent?.familyId ?? input.id, parentExerciseId: input.parentExerciseId, equipmentType: input.equipmentType, variant: input.variant, muscles: input.muscles, status: 'active', personalName: input.name, personalLocale: input.locale });
    const plan = personalExercises.plan(context, null, record);
    if (parent) plan.guards.push(exerciseGuard(auth.id, parent.id, parent.revision));
    plan.undoable = false;
    return plan;
  } }, clock);
}
export function createSetup(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, clock?: () => Date) {
  const input = setupInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'setup.create', payload: input, entryPoint: 'manual', plan: async context => {
    const exercise = await readExercise(db, auth.id, input.exerciseId);
    const plan = setups.plan(context, null, { ...input, ...newMetadata(context, input.id) });
    plan.guards.push(exerciseGuard(auth.id, exercise.id, exercise.revision)); plan.undoable = false;
    return plan;
  } }, clock);
}
export function patchSetup(db: D1Database, auth: AuthContext, operationId: string, id: string, revision: number, payload: unknown, clock?: () => Date) {
  const input = setupPatchSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'setup.patch', payload: { id, ...input }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    const before = await setups.read(db, auth.id, id); expectRevision(before, revision);
    const plan = setups.plan(context, before, reviseRecord(before, context, input)); plan.undoable = false; return plan;
  } }, clock);
}
export function createExerciseAlias(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, clock?: () => Date) {
  const input = exerciseAliasInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'exercise_alias.create', payload: input, entryPoint: 'manual', plan: async context => {
    const exercise = await readExercise(db, auth.id, input.targetId);
    const plan = exerciseAliases.plan(context, null, { ...newMetadata(context, input.id), aliasOriginal: input.text, aliasNormalized: normalizeAlias(input.text), localeHint: input.localeHint, exerciseId: input.targetId, context: input.context, confirmedAt: context.now });
    plan.guards.push(exerciseGuard(auth.id, exercise.id, exercise.revision)); plan.undoable = false; return plan;
  } }, clock);
}
export function editExerciseAlias(db: D1Database, auth: AuthContext, operationId: string, id: string, revision: number, payload: unknown, deleting: boolean, clock?: () => Date) {
  const input = deleting ? {} : exerciseAliasPatchSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: deleting ? 'exercise_alias.delete' : 'exercise_alias.patch', payload: { id, ...input }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    const before = await exerciseAliases.read(db, auth.id, id); expectRevision(before, revision);
    const after = reviseRecord(before, context, deleting ? { deletedAt: context.now } : { aliasOriginal: input.text ?? before.aliasOriginal, aliasNormalized: normalizeAlias(input.text ?? before.aliasOriginal), exerciseId: input.targetId ?? before.exerciseId, confirmedAt: context.now });
    const plan = exerciseAliases.plan(context, before, after);
    if (!deleting) { const exercise = await readExercise(db, auth.id, after.exerciseId); plan.guards.push(exerciseGuard(auth.id, exercise.id, exercise.revision)); }
    plan.undoable = false; return plan;
  } }, clock);
}
export async function searchExercises(db: D1Database, owner: string, query: { q: string; locale: Locale; limit: number; cursor?: string }) {
  const binding = { q: normalizeAlias(query.q), locale: query.locale }, after = pageAfter(owner, 'exercises', binding, query.cursor);
  const like = `%${binding.q.replace(/[\\%_]/g, char => `\\${char}`)}%`;
  const rows = await db.prepare(`SELECT e.id,e.scope,e.equipment_type AS equipmentType,e.personal_locale AS originalLocale,COALESCE(e.personal_name,l.display_name,en.display_name) AS name FROM exercise_definitions e LEFT JOIN exercise_labels l ON l.exercise_id=e.id AND l.locale=? LEFT JOIN exercise_labels en ON en.exercise_id=e.id AND en.locale='en' WHERE (e.scope='system' OR e.owner_id=?) AND e.status='active' AND e.deleted_at IS NULL AND (? IS NULL OR e.id>?) AND (lower(e.personal_name) LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM exercise_labels x WHERE x.exercise_id=e.id AND (x.search_terms LIKE ? ESCAPE '\\' OR lower(x.display_name) LIKE ? ESCAPE '\\')) OR EXISTS(SELECT 1 FROM exercise_aliases a WHERE a.owner_id=? AND a.exercise_id=e.id AND a.deleted_at IS NULL AND a.alias_normalized LIKE ? ESCAPE '\\')) ORDER BY e.id LIMIT ?`).bind(query.locale, owner, after, after, like, like, like, owner, like, query.limit + 1).all<{ id: string; scope: string; equipmentType: string; originalLocale: string | null; name: string }>();
  return pageResult(rows.results, query.limit, owner, 'exercises', binding);
}
