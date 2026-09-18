import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { mealDraftInputSchema, mealDraftPatchSchema, mealDraftSchema, mealInputSchema, mealItemSchema, mealPatchSchema, mealSchema, mealSnapshotSchema, nutrientKeys, resolveNote } from '../domain/nutrition.ts';
import type { Meal, MealDraft, MealItem, MealItemSnapshot } from '../domain/nutrition.ts';
import { localDateAt, validateActualDate } from '../domain/primitives.ts';
import type { AuthContext } from './auth.ts';
import { executeCommand } from './commands.ts';
import type { CommandContext, CommandPlan, Guard } from './commands.ts';
import { DomainError } from './errors.ts';
import { compareDecimal } from '../domain/numbers.ts';
import { expectRevision, mergePlans, newMetadata, reviseRecord } from './record-store.ts';
import { mealDrafts, mealItems, meals } from './nutrition-store.ts';
import { resolveMealItem } from './nutrition-basis.ts';
import { invalidateNutrition } from './nutrition-days.ts';

export function validateMealDate(context: CommandContext, value: Pick<Meal, 'localDate' | 'occurredAt' | 'entryTimezone'>) {
  try {
    validateActualDate(value, context.auth.timezone, new Date(context.now));
    if (value.occurredAt && localDateAt(new Date(value.occurredAt), value.entryTimezone) !== value.localDate) throw new Error('OCCURRENCE_DATE_MISMATCH');
  } catch { throw new DomainError('INVALID_INPUT', 400, { reason: 'actualDate' }); }
}
export async function readMealTree(db: D1Database, owner: string, id: string) {
  const meal = await meals.read(db, owner, id), items = await mealItems.list(db, owner, 'meal_id=?', [id], 'ordinal,id');
  return { meal, items };
}
export function frozenMeal(meal: Meal, items: MealItem[]) { return mealSnapshotSchema.parse(meal.note ? { schemaVersion: 2, title: meal.title, mealType: meal.mealType, note: meal.note, items: [] } : { schemaVersion: 1, title: meal.title, mealType: meal.mealType, items: items.map(item => item.snapshot) }); }
function checkedNote(input: Parameters<typeof resolveNote>[0]) {
  if (input.nutrients.energyKcal !== null && compareDecimal(input.nutrients.energyKcal, '3000') > 0 && !input.confirmLargePortion) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'largePortion' });
  return resolveNote(input);
}
function ensureKnown(items: MealItemSnapshot[]) {
  if (!items.some(item => nutrientKeys.some(key => item.nutrientSnapshot[key] !== null))) throw new DomainError('NEEDS_CONFIRMATION', 422, { reason: 'saveAsDraft' });
}
export async function sourceGuards(context: CommandContext, sourceIds: string[]): Promise<Guard[]> {
  if (new Set(sourceIds).size !== sourceIds.length) throw new DomainError('INVALID_INPUT', 400, { reason: 'duplicateSource' });
  const guards: Guard[] = [];
  for (const id of sourceIds) {
    const row = await context.db.prepare("SELECT revision FROM source_assets WHERE owner_id=? AND id=? AND kind='image' AND status='ready' AND deleted_at IS NULL").bind(context.auth.id, id).first<{ revision: number }>();
    if (!row) throw new DomainError('RECORD_NOT_FOUND', 404);
    guards.push({ predicate: "EXISTS(SELECT 1 FROM source_assets WHERE owner_id=? AND id=? AND revision=? AND kind='image' AND status='ready' AND deleted_at IS NULL)", values: [context.auth.id, id, row.revision], error: new DomainError('CONTEXT_STALE', 422) });
  }
  return guards;
}
/** Ordinal changes share the root guard. Temporary positions never leave the transaction. */
export function stageMealOrdinals(context: CommandContext, plans: CommandPlan[]) {
  const ids = plans.flatMap(plan => plan.entities.filter(entity => entity.type === 'meal_item' && entity.before !== null).map(entity => String(entity.after.id)));
  return ids.map((id, index) => context.db.prepare('UPDATE meal_items SET ordinal=? WHERE owner_id=? AND id=?').bind(1_000_000 + index, context.auth.id, id));
}
export async function newMealPlan(context: CommandContext, meal: Meal, items: Array<{ id: string; snapshot: MealItemSnapshot }>, draft: MealDraft | null = null) {
  validateMealDate(context, meal);
  if (meal.note) { if (items.length) throw new DomainError('INVALID_INPUT', 400, { reason: 'noteHasItems' }); }
  else ensureKnown(items.map(item => item.snapshot));
  const records = items.map((item, index) => mealItemSchema.parse({ ...newMetadata(context, item.id), mealId: meal.id, ordinal: index + 1, snapshot: item.snapshot }));
  const plans = [meals.plan(context, null, meal), ...records.map(item => mealItems.plan(context, null, item))];
  if (draft) {
    if (draft.status === 'confirmed') throw new DomainError('REVISION_CONFLICT', 409, { reason: 'draftAlreadyConfirmed' });
    if (draft.expiresAt <= context.now && !(meal.note && draft.sourceIds.length === 0)) throw new DomainError('DRAFT_EXPIRED', 410);
    const plan = mealDrafts.plan(context, draft, reviseRecord(draft, context, { status: 'confirmed', confirmedMealId: meal.id }));
    plan.guards.push(...await sourceGuards(context, draft.sourceIds)); plans.push(plan);
  }
  plans.push(...await invalidateNutrition(context, [meal.localDate, ...(draft ? [draft.localDate] : [])], 'mealCreated'));
  return mergePlans(plans, { mealId: meal.id, itemIds: records.map(item => item.id), draftId: draft?.id ?? null });
}
export function createMeal(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, clock?: () => Date) {
  const input = mealInputSchema.parse(payload);
  const { note: noteInput, ...legacyInput } = input;
  return executeCommand(db, auth, { operationId, kind: 'nutrition.meal.create', payload: noteInput ? input : legacyInput, entryPoint: 'manual', plan: async context => {
    const draft = input.draftRef ? await mealDrafts.read(db, auth.id, input.draftRef.id) : null;
    if (draft && input.draftRef) expectRevision(draft, input.draftRef.revision);
    if (input.items.some(item => item.expectedRevision !== undefined)) throw new DomainError('INVALID_INPUT', 400, { reason: 'newItemRevision' });
    const resolved = await Promise.all(input.items.map(item => resolveMealItem(context, item)));
    const meal = mealSchema.parse({ ...newMetadata(context, input.id), localDate: input.localDate, entryTimezone: input.entryTimezone, occurredAt: input.occurredAt, timePrecision: input.timePrecision, mealType: input.mealType, title: input.title, note: input.note ? checkedNote(input.note) : null, sourceKind: draft?.sourceIds.length ? 'photo' : 'manual', sourceRef: draft?.id ?? null, confirmedAt: context.now });
    const plan = await newMealPlan(context, meal, input.items.map((item, index) => ({ id: item.id, snapshot: resolved[index].snapshot })), draft);
    plan.guards.push(...resolved.flatMap(item => item.guards)); return plan;
  } }, clock);
}
export function editMeal(db: D1Database, auth: AuthContext, operationId: string, id: string, revision: number, payload: unknown, deleting = false, clock?: () => Date) {
  const input = deleting ? z.strictObject({}).parse(payload) : mealPatchSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: deleting ? 'nutrition.meal.delete' : 'nutrition.meal.patch', payload: { id, ...input }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    const { meal: before, items } = await readMealTree(db, auth.id, id); expectRevision(before, revision);
    const { items: inputs, note, ...fields } = input;
    if ((note && !before.note) || (inputs && before.note)) throw new DomainError('INVALID_INPUT', 400, { reason: 'mealRepresentationChanged' });
    const after = mealSchema.parse(reviseRecord(before, context, deleting ? { deletedAt: context.now } : { ...fields, ...(note ? { note: checkedNote(note) } : {}) }));
    if (!deleting) validateMealDate(context, after);
    const plans = [meals.plan(context, before, after)];
    if (inputs) {
      const previous = new Map(items.map(item => [item.id, item])), next: MealItem[] = [];
      for (let index = 0; index < inputs.length; index++) {
        const item = inputs[index], old = previous.get(item.id);
        if (old) { if (item.expectedRevision === undefined) throw new DomainError('INVALID_INPUT', 400, { reason: 'itemRevisionRequired' }); expectRevision(old, item.expectedRevision); }
        else if (item.expectedRevision !== undefined) throw new DomainError('RECORD_NOT_FOUND', 404);
        const resolved = await resolveMealItem(context, item, old?.snapshot);
        const record = mealItemSchema.parse(old ? reviseRecord(old, context, { ordinal: index + 1, snapshot: resolved.snapshot }) : { ...newMetadata(context, item.id), mealId: id, ordinal: index + 1, snapshot: resolved.snapshot });
        const plan = mealItems.plan(context, old ?? null, record); plan.guards.push(...resolved.guards); plans.push(plan); next.push(record); previous.delete(item.id);
      }
      ensureKnown(next.map(item => item.snapshot));
      for (const item of previous.values()) plans.push(mealItems.plan(context, item, reviseRecord(item, context, { deletedAt: context.now })));
    }
    plans.push(...await invalidateNutrition(context, [before.localDate, after.localDate], deleting ? 'mealDeleted' : 'mealEdited'));
    const plan = mergePlans(plans, { mealId: id });
    plan.statements.unshift(...stageMealOrdinals(context, plans)); return plan;
  } }, clock);
}
export function createMealDraft(db: D1Database, auth: AuthContext, operationId: string, payload: unknown, clock?: () => Date) {
  const input = mealDraftInputSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: 'nutrition.draft.create', payload: input, entryPoint: 'manual', plan: async context => {
    const record = mealDraftSchema.parse({ ...newMetadata(context, input.id), ...input, status: 'needs_input', confirmedMealId: null, expiresAt: new Date(new Date(context.now).getTime() + 90 * 86400000).toISOString() });
    const plan = mealDrafts.plan(context, null, record); plan.guards.push(...await sourceGuards(context, input.sourceIds));
    return mergePlans([plan, ...await invalidateNutrition(context, [input.localDate], 'mealDraftAdded')], { draftId: input.id });
  } }, clock);
}
export function editMealDraft(db: D1Database, auth: AuthContext, operationId: string, id: string, revision: number, payload: unknown, deleting = false, clock?: () => Date) {
  const input = deleting ? z.strictObject({}).parse(payload) : mealDraftPatchSchema.parse(payload);
  return executeCommand(db, auth, { operationId, kind: deleting ? 'nutrition.draft.delete' : 'nutrition.draft.patch', payload: { id, ...input }, expectedRevision: revision, entryPoint: 'manual', plan: async context => {
    const before = await mealDrafts.read(db, auth.id, id); expectRevision(before, revision);
    if (before.status === 'confirmed') throw new DomainError('REVISION_CONFLICT', 409, { reason: 'editConfirmedMeal' });
    if (!deleting && before.expiresAt <= context.now) throw new DomainError('DRAFT_EXPIRED', 410);
    const after = mealDraftSchema.parse(reviseRecord(before, context, deleting ? { deletedAt: context.now } : input));
    if (!deleting && !after.description.trim() && !after.sourceIds.length) throw new DomainError('INVALID_INPUT', 400, { reason: 'draftContentRequired' });
    const plan = mealDrafts.plan(context, before, after);
    if (!deleting) plan.guards.push(...await sourceGuards(context, after.sourceIds));
    return mergePlans([plan, ...await invalidateNutrition(context, [before.localDate, after.localDate], deleting ? 'mealDraftDeleted' : 'mealDraftEdited')], { draftId: id });
  } }, clock);
}
