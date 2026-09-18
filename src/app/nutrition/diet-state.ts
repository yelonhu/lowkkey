import { visibleLedgerEntities } from '../../domain/local-ledger.ts';
import type { LocalLedger } from '../../domain/local-ledger.ts';
import { resolveNote, summarizeNutrients } from '../../domain/nutrition.ts';
import type { Meal, MealItem } from '../../domain/nutrition.ts';
import type { QueuedCommand } from '../../domain/manual-commands.ts';
import { orderedCommands } from '../training/training-state.ts';

export function isDietCommand(command: QueuedCommand, all: QueuedCommand[] = []): boolean {
  if (command.mutation.kind === 'operation.undo') { const originalId = command.mutation.originalId; const original = all.find(value => value.operationId === originalId); return !!original && isDietCommand(original); }
  return command.mutation.kind.startsWith('meal.') || command.mutation.kind.startsWith('meal-draft.') || command.mutation.kind.startsWith('day-claim.');
}
export function pendingCommand(command: QueuedCommand, ledger: LocalLedger) {
  return command.state !== 'discarded' && (command.state !== 'committed' || (command.receipt?.dataRevision ?? Infinity) > ledger.dataRevision);
}
export function dietProjection(ledger: LocalLedger, commands: QueuedCommand[], date: string) {
  const entities = visibleLedgerEntities(ledger);
  const records = new Map(entities.flatMap(item => item.kind === 'meal' ? [[item.value.id, item.value] as const] : []));
  const items = entities.flatMap(item => item.kind === 'meal_item' ? [item.value] : []);
  const facts = [...records.values()].filter(record => record.localDate === date);
  for (const command of orderedCommands(commands)) {
    if (!pendingCommand(command, ledger)) continue;
    const mutation = command.mutation;
    const metadata = { id: command.clientEntityId, ownerId: ledger.ownerId, revision: 1, createdAt: command.createdAt, updatedAt: command.createdAt, deletedAt: null, operationId: command.operationId, createdOperationId: command.operationId };
    if (mutation.kind === 'meal.create' && mutation.input.note) records.set(mutation.input.id, { ...metadata, ...mutation.input, note: resolveNote(mutation.input.note), sourceKind: 'manual', sourceRef: mutation.input.draftRef?.id ?? null, confirmedAt: command.createdAt });
    if (mutation.kind === 'meal.update') {
      const record = records.get(mutation.target.id), { note, items: omittedItems, ...fields } = mutation.input;
      void omittedItems;
      if (record) records.set(record.id, { ...record, ...fields, ...(note ? { note: resolveNote(note) } : {}) });
    }
    if (mutation.kind === 'meal.delete' && !['conflict','needs_review','rejected'].includes(command.state)) records.delete(mutation.target.id);
  }
  const claim = entities.find(item => item.kind === 'day_claim' && item.value.localDate === date);
  const drafts = entities.flatMap(item => item.kind === 'import_draft' && item.value.localDate === date && item.value.status !== 'confirmed' ? [item.value] : []);
  const zero = claim?.kind === 'day_claim' && claim.value.explicitZeroIntake && claim.value.nutritionCompleteness === 'complete' && !facts.length && !drafts.length;
  return { records: [...records.values()].filter(record => record.localDate === date).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    facts, items, drafts, claim: claim?.kind === 'day_claim' ? claim.value : null,
    summary: summarizeNutrients(facts.flatMap(record => mealValues(record, items)), zero) };
}
export function mealValues(record: Meal, items: MealItem[]) {
  return record.note ? [record.note.nutrientSnapshot] : items.filter(item => item.mealId === record.id).map(item => item.snapshot.nutrientSnapshot);
}
