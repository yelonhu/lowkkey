import { visibleLedgerEntities } from '../domain/local-ledger.ts';
import type { LocalLedger } from '../domain/local-ledger.ts';
import type { QueuedCommand } from '../domain/manual-commands.ts';
import type { Weight } from '../domain/weight.ts';
import { normalizeMass } from '../domain/numbers.ts';
import { orderedCommands } from './training/training-state.ts';

export function weightProjection(ledger: LocalLedger, commands: QueuedCommand[]): Weight[] {
  const values = new Map(visibleLedgerEntities(ledger).flatMap(item => item.kind === 'weight_entry' ? [[item.value.id, item.value] as const] : []));
  for (const command of orderedCommands(commands)) {
    if (!(['queued','sending','uncertain'].includes(command.state) || command.state === 'committed' && (command.receipt?.dataRevision ?? 0) > ledger.dataRevision)) continue;
    const mutation = command.mutation;
    if (mutation.kind === 'day-weight.create' || mutation.kind === 'weight.create') {
      const input = mutation.input;
      values.set(input.id, { ...input, kgMicros: normalizeMass(input.value, input.unit, 1, 500).kgMicros, ownerId: ledger.ownerId, revision: 1, createdAt: command.createdAt, updatedAt: command.createdAt, deletedAt: null, isPrimary: mutation.kind === 'day-weight.create' || ![...values.values()].some(item => item.localDate === input.localDate && item.isPrimary), sourceKind: 'manual', sourceRef: null, operationId: command.operationId, createdOperationId: command.operationId });
    } else if (mutation.kind === 'day-weight.update' || mutation.kind === 'weight.update') {
      const before = values.get(mutation.target.id);
      if (before) { const next = { ...before, ...mutation.input, operationId: command.operationId }; values.set(before.id, { ...next, kgMicros: normalizeMass(next.value, next.unit, 1, 500).kgMicros }); }
    } else if (mutation.kind === 'day-weight.delete' || mutation.kind === 'weight.delete') values.delete(mutation.target.id);
  }
  return [...values.values()].filter(item => !item.deletedAt).sort((a,b) => b.localDate.localeCompare(a.localDate));
}
