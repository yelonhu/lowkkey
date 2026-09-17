import { z } from 'zod';
import { entityRefSchema } from './artifacts.ts';
import type { EntityRef } from './artifacts.ts';
import { revisionSchema, scaledSchema, utcSchema, uuidSchema, localDateSchema, timezoneSchema } from './primitives.ts';
import { createWeightSchema, patchWeightSchema } from './weight.ts';
import { profileInputSchema, goalInputSchema } from './profile.ts';
import { customExerciseInputSchema, setupInputSchema, setupPatchSchema, planInputSchema, planActivationInputSchema, scheduleInputSchema, schedulePatchSchema, sessionInputSchema, sessionPatchSchema, sessionExerciseInputSchema, sessionExercisePatchSchema, trainingSetInputSchema, trainingSetPatchSchema } from './training.ts';
import { mealInputSchema, mealPatchSchema, mealDraftInputSchema, mealDraftPatchSchema, foodInputSchema, recipeInputSchema, recipePatchSchema, favoriteInputSchema, favoritePatchSchema, copyFavoriteSchema, portionInputSchema } from './nutrition.ts';
import type { LocalLedger } from './local-ledger.ts';
import { commandReceiptSchema } from './command-receipt.ts';
import type { CommandReceipt } from './command-receipt.ts';

const source = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('observed'), revision: revisionSchema }),
  z.strictObject({ kind: z.literal('receipt'), operationId: uuidSchema }),
]);
function target<T extends EntityRef['type']>(type: T) { return z.strictObject({ type: z.literal(type), id: uuidSchema, source }); }
export const versionBindingSchema = z.strictObject({ type: entityRefSchema.shape.type, id: uuidSchema, source });
type Binding = z.infer<typeof versionBindingSchema>;
const session = target('workout_session');
const setEdit = z.strictObject(trainingSetPatchSchema.shape).omit({ expectedRevision: true }).refine(value => Object.keys(value).length > 0, 'Empty set edit');
const exerciseEdit = z.strictObject(sessionExercisePatchSchema.shape).omit({ expectedRevision: true }).refine(value => Object.keys(value).length > 0, 'Empty exercise edit');

/** This allowlist contains manual health commands only. Neither endpoints nor
 * owner/role, provider parameters or arbitrary patch paths come from input. */
export const manualMutationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('weight.create'), input: createWeightSchema }),
  z.strictObject({ kind: z.literal('weight.update'), target: target('weight_entry'), input: patchWeightSchema }),
  z.strictObject({ kind: z.literal('weight.delete'), target: target('weight_entry') }),
  z.strictObject({ kind: z.literal('profile.update'), target: target('user_profile'), input: profileInputSchema }),
  z.strictObject({ kind: z.literal('goal.create'), input: goalInputSchema }),
  z.strictObject({ kind: z.literal('exercise.create'), input: customExerciseInputSchema }),
  z.strictObject({ kind: z.literal('setup.create'), input: setupInputSchema }),
  z.strictObject({ kind: z.literal('setup.update'), target: target('exercise_setup'), input: setupPatchSchema }),
  z.strictObject({ kind: z.literal('plan.create'), input: planInputSchema }),
  z.strictObject({ kind: z.literal('plan.select'), target: target('plan_version'), action: z.enum(['activate', 'archive']), input: planActivationInputSchema }),
  z.strictObject({ kind: z.literal('schedule.create'), input: scheduleInputSchema }),
  z.strictObject({ kind: z.literal('schedule.update'), target: target('scheduled_session'), input: schedulePatchSchema }),
  z.strictObject({ kind: z.literal('session.create'), input: sessionInputSchema }),
  z.strictObject({ kind: z.literal('session.update'), target: session, input: sessionPatchSchema }),
  z.strictObject({ kind: z.literal('session.transition'), target: session, action: z.enum(['pause', 'resume', 'finish', 'cancel', 'delete']) }),
  z.strictObject({ kind: z.literal('session-exercise.create'), session, input: sessionExerciseInputSchema }),
  z.strictObject({ kind: z.literal('session-exercise.update'), session, target: target('session_exercise'), input: exerciseEdit }),
  z.strictObject({ kind: z.literal('session-exercise.delete'), session, target: target('session_exercise') }),
  z.strictObject({ kind: z.literal('set.create'), session, input: trainingSetInputSchema }),
  z.strictObject({ kind: z.literal('set.update'), session, target: target('workout_set'), input: setEdit }),
  z.strictObject({ kind: z.literal('set.delete'), session, target: target('workout_set') }),
  z.strictObject({ kind: z.literal('meal.create'), input: mealInputSchema }),
  z.strictObject({ kind: z.literal('meal.update'), target: target('meal'), input: mealPatchSchema }),
  z.strictObject({ kind: z.literal('meal.delete'), target: target('meal') }),
  z.strictObject({ kind: z.literal('meal-draft.create'), input: mealDraftInputSchema }),
  z.strictObject({ kind: z.literal('meal-draft.update'), target: target('import_draft'), input: mealDraftPatchSchema }),
  z.strictObject({ kind: z.literal('meal-draft.delete'), target: target('import_draft') }),
  z.strictObject({ kind: z.literal('food.create'), input: foodInputSchema }),
  z.strictObject({ kind: z.literal('recipe.create'), input: recipeInputSchema }),
  z.strictObject({ kind: z.literal('recipe.update'), target: target('personal_recipe'), input: recipePatchSchema }),
  z.strictObject({ kind: z.literal('recipe.delete'), target: target('personal_recipe') }),
  z.strictObject({ kind: z.literal('favorite.create'), input: favoriteInputSchema }),
  z.strictObject({ kind: z.literal('favorite.update'), target: target('favorite'), input: favoritePatchSchema }),
  z.strictObject({ kind: z.literal('favorite.delete'), target: target('favorite') }),
  z.strictObject({ kind: z.literal('favorite.copy'), id: uuidSchema, input: copyFavoriteSchema }),
  z.strictObject({ kind: z.literal('portion.create'), input: portionInputSchema }),
  z.strictObject({ kind: z.literal('operation.undo'), originalId: uuidSchema }),
]);
export type ManualMutation = z.infer<typeof manualMutationSchema>;
export function mutationBindings(mutation: ManualMutation): Binding[] {
  return [...('session' in mutation ? [mutation.session] : []), ...('target' in mutation ? [mutation.target] : [])];
}
export function observed<T extends EntityRef['type']>(ref: EntityRef & { type: T }): Binding & { type: T } { return { type: ref.type, id: ref.id, source: { kind: 'observed', revision: ref.revision } }; }
export class QueueError extends Error {
  constructor(readonly code: 'LOCAL_COMMAND_CHANGED' | 'DEPENDENCY_MISSING' | 'DEPENDENCY_BLOCKED' | 'REVISION_CONFLICT' | 'RECORD_NOT_FOUND' | 'OWNER_MISMATCH' | 'REVIEW_REQUIRED' | 'INVALID_RECEIPT') { super(code); }
}
function resolve(binding: Binding, receipts: ReadonlyMap<string, CommandReceipt>): EntityRef {
  if (binding.source.kind === 'observed') return { type: binding.type, id: binding.id, revision: binding.source.revision };
  const receipt = receipts.get(binding.source.operationId);
  if (!receipt) throw new QueueError('DEPENDENCY_MISSING');
  const ref = receipt.recordRefs.find(ref => ref.type === binding.type && ref.id === binding.id);
  if (!ref) throw new QueueError('INVALID_RECEIPT');
  return ref;
}
export type PreparedMutation = { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body: unknown; expectedRevision: number | null; checks: EntityRef[] };
export function prepareMutation(raw: unknown, receipts: ReadonlyMap<string, CommandReceipt> = new Map()): PreparedMutation {
  const mutation = manualMutationSchema.parse(raw), checks = mutationBindings(mutation).map(binding => resolve(binding, receipts));
  const revision = (binding: Binding) => resolve(binding, receipts).revision;
  const result = (path: string, method: PreparedMutation['method'], body: unknown = {}, root?: Binding): PreparedMutation => ({ path: `/api/v1${path}`, method, body, expectedRevision: root ? revision(root) : null, checks });
  switch (mutation.kind) {
    case 'weight.create': return result('/weights', 'POST', mutation.input);
    case 'weight.update': return result(`/weights/${mutation.target.id}`, 'PATCH', mutation.input, mutation.target);
    case 'weight.delete': return result(`/weights/${mutation.target.id}`, 'DELETE', {}, mutation.target);
    case 'profile.update': return result('/me', 'PATCH', mutation.input, mutation.target);
    case 'goal.create': return result('/goals', 'POST', mutation.input);
    case 'exercise.create': return result('/catalog/custom-exercises', 'POST', mutation.input);
    case 'setup.create': return result('/exercise-setups', 'POST', mutation.input);
    case 'setup.update': return result(`/exercise-setups/${mutation.target.id}`, 'PATCH', mutation.input, mutation.target);
    case 'plan.create': return result('/plans', 'POST', mutation.input);
    case 'plan.select': return result(`/plans/${mutation.target.id}/${mutation.action}`, 'POST', mutation.input, mutation.target);
    case 'schedule.create': return result('/schedule', 'POST', mutation.input);
    case 'schedule.update': return result(`/schedule/${mutation.target.id}`, 'PATCH', mutation.input, mutation.target);
    case 'session.create': return result('/training/sessions', 'POST', mutation.input);
    case 'session.update': return result(`/training/sessions/${mutation.target.id}`, 'PATCH', mutation.input, mutation.target);
    case 'session.transition': return result(`/training/sessions/${mutation.target.id}${mutation.action === 'delete' ? '' : `/${mutation.action}`}`, mutation.action === 'delete' ? 'DELETE' : 'POST', {}, mutation.target);
    case 'session-exercise.create': return result(`/training/sessions/${mutation.session.id}/exercises`, 'POST', mutation.input, mutation.session);
    case 'set.create': return result(`/training/sessions/${mutation.session.id}/sets`, 'POST', mutation.input, mutation.session);
    case 'set.update': return result(`/training/sessions/${mutation.session.id}/sets/${mutation.target.id}`, 'PATCH', trainingSetPatchSchema.parse({ ...mutation.input, expectedRevision: revision(mutation.target) }), mutation.session);
    case 'session-exercise.update': return result(`/training/sessions/${mutation.session.id}/exercises/${mutation.target.id}`, 'PATCH', sessionExercisePatchSchema.parse({ ...mutation.input, expectedRevision: revision(mutation.target) }), mutation.session);
    case 'set.delete': return result(`/training/sessions/${mutation.session.id}/sets/${mutation.target.id}`, 'DELETE', { expectedRevision: revision(mutation.target) }, mutation.session);
    case 'session-exercise.delete': return result(`/training/sessions/${mutation.session.id}/exercises/${mutation.target.id}`, 'DELETE', { expectedRevision: revision(mutation.target) }, mutation.session);
    case 'meal.create': return result('/meals', 'POST', mutation.input);
    case 'meal.update': return result(`/meals/${mutation.target.id}`, 'PATCH', mutation.input, mutation.target);
    case 'meal.delete': return result(`/meals/${mutation.target.id}`, 'DELETE', {}, mutation.target);
    case 'meal-draft.create': return result('/imports', 'POST', mutation.input);
    case 'meal-draft.update': return result(`/imports/${mutation.target.id}`, 'PATCH', mutation.input, mutation.target);
    case 'meal-draft.delete': return result(`/imports/${mutation.target.id}`, 'DELETE', {}, mutation.target);
    case 'food.create': return result('/catalog/custom-foods', 'POST', mutation.input);
    case 'recipe.create': return result('/recipes', 'POST', mutation.input);
    case 'recipe.update': return result(`/recipes/${mutation.target.id}`, 'PATCH', mutation.input, mutation.target);
    case 'recipe.delete': return result(`/recipes/${mutation.target.id}`, 'DELETE', {}, mutation.target);
    case 'favorite.create': return result('/favorites', 'POST', mutation.input);
    case 'favorite.update': return result(`/favorites/${mutation.target.id}`, 'PATCH', mutation.input, mutation.target);
    case 'favorite.delete': return result(`/favorites/${mutation.target.id}`, 'DELETE', {}, mutation.target);
    case 'favorite.copy': return result(`/favorites/${mutation.id}/copy`, 'POST', mutation.input);
    case 'portion.create': return result('/portions', 'POST', mutation.input);
    case 'operation.undo': return result(`/operations/${mutation.originalId}/undo`, 'POST');
  }
}
export const queueIssueSchema = z.strictObject({ code: z.string().min(1).max(100), params: z.record(z.string().max(100), z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()])).default({}) });
export const commandInputSchema = z.strictObject({
  schemaVersion: z.literal(1), operationId: uuidSchema, ownerId: uuidSchema, clientEntityId: uuidSchema,
  mutation: manualMutationSchema, dependencies: z.array(uuidSchema).max(100),
  localDate: localDateSchema, entryTimezone: timezoneSchema, createdAt: utcSchema,
  restoreEpoch: uuidSchema, baseDataRevision: scaledSchema,
}).superRefine((command, ctx) => {
  if (command.dependencies.includes(command.operationId) || new Set(command.dependencies).size !== command.dependencies.length) ctx.addIssue({ code: 'custom', message: 'Invalid dependencies' });
  for (const binding of mutationBindings(command.mutation)) if (binding.source.kind === 'receipt' && !command.dependencies.includes(binding.source.operationId)) ctx.addIssue({ code: 'custom', message: 'A receipt version must name its dependency' });
  const mutation = command.mutation;
  const identity = 'input' in mutation && 'id' in mutation.input ? mutation.input.id : 'target' in mutation ? mutation.target.id : mutation.kind === 'operation.undo' ? mutation.originalId : null;
  if (identity !== null && identity !== command.clientEntityId) ctx.addIssue({ code: 'custom', message: 'Client entity identity differs from mutation' });
  if ('input' in mutation && 'localDate' in mutation.input && mutation.input.localDate && mutation.input.localDate !== command.localDate) ctx.addIssue({ code: 'custom', message: 'Capture date differs from mutation' });
  if ('input' in mutation && 'entryTimezone' in mutation.input && mutation.input.entryTimezone && mutation.input.entryTimezone !== command.entryTimezone) ctx.addIssue({ code: 'custom', message: 'Capture timezone differs from mutation' });
  if (new TextEncoder().encode(JSON.stringify(mutation)).byteLength > 60000) ctx.addIssue({ code: 'custom', message: 'Command is too large' });
});
export type CommandInput = z.infer<typeof commandInputSchema>;
export const queuedCommandSchema = commandInputSchema.safeExtend({
  localRevision: revisionSchema, state: z.enum(['queued', 'sending', 'uncertain', 'committed', 'conflict', 'needs_review', 'rejected', 'discarded']),
  reviewRequired: z.boolean(),
  firstAttemptAt: utcSchema.nullable(), attempts: scaledSchema, issue: queueIssueSchema.nullable(), receipt: commandReceiptSchema.nullable(),
  lease: z.strictObject({ token: uuidSchema, until: utcSchema }).nullable(),
}).superRefine((command, ctx) => {
  if ((command.state === 'committed') !== (command.receipt !== null) || (command.receipt && command.receipt.operationId !== command.operationId)) ctx.addIssue({ code: 'custom', message: 'Receipt must identify this committed command' });
  if ((command.state === 'sending') !== (command.lease !== null)) ctx.addIssue({ code: 'custom', message: 'Only a sending command holds a lease' });
});
export type QueuedCommand = z.infer<typeof queuedCommandSchema>;
export function newQueuedCommand(raw: unknown): QueuedCommand { return queuedCommandSchema.parse({ ...commandInputSchema.parse(raw), localRevision: 1, state: 'queued', reviewRequired: false, firstAttemptAt: null, attempts: 0, issue: null, receipt: null, lease: null }); }
export function commandNeedsReview(command: QueuedCommand, ledger: LocalLedger, now: Date): boolean {
  return command.reviewRequired || command.restoreEpoch !== ledger.restoreEpoch || command.baseDataRevision > ledger.dataRevision || now.getTime() - new Date(command.createdAt).getTime() > 30 * 86400000 || new Date(command.createdAt).getTime() > now.getTime() + 300000;
}
export function validateCommandBaseline(command: QueuedCommand, prepared: PreparedMutation, ledger: LocalLedger): void {
  if (command.ownerId !== ledger.ownerId) throw new QueueError('OWNER_MISMATCH');
  for (const ref of prepared.checks) {
    const item = ledger.items.get(`${ref.type}:${ref.id}`);
    if (!item || !('deletedAt' in item.value) || item.value.deletedAt !== null) throw new QueueError('RECORD_NOT_FOUND');
    if (!('revision' in item.value) || item.value.revision !== ref.revision) throw new QueueError('REVISION_CONFLICT');
  }
}
