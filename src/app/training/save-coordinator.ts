import type { LocalDatabase } from '../../client/local-database.ts';
import type { QueuedCommand } from '../../domain/manual-commands.ts';
import { versionFor } from './training-state.ts';
import type { Binding } from './training-state.ts';
const tails = new WeakMap<LocalDatabase, Promise<unknown>>();
/** Serialize local intent, including blur + navigation in the same event turn. */
export function serializeTraining<T>(database: LocalDatabase, action: () => Promise<T>): Promise<T> {
  const next = (tails.get(database) ?? Promise.resolve()).catch(() => undefined).then(action);
  tails.set(database, next); return next;
}
export async function commitTrainingRows() {
  const actions: Array<() => Promise<unknown>> = [];
  window.dispatchEvent(new CustomEvent('lowkkey:commit-training', { detail: actions }));
  for (const action of actions) await action();
}
/** Only our own receipt chain may advance an input's baseline. Never replace it with a newly fetched server revision. */
export function advanceOwnBinding(binding: Binding, commands: QueuedCommand[]): Binding {
  if (binding.source.kind === 'observed') return versionFor({ type: binding.type, id: binding.id, revision: binding.source.revision }, commands);
  const source = binding.source;
  const receipt = commands.find(command => command.operationId === source.operationId)?.receipt;
  const revision = receipt?.recordRefs.find(ref => ref.id === binding.id && ref.type === binding.type)?.revision ?? 1;
  const advanced = versionFor({ type: binding.type, id: binding.id, revision }, commands);
  return advanced.source.kind === 'receipt' ? advanced : binding;
}
