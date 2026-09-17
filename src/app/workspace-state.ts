import { useEffect, useRef, useState } from 'react';
import { LocalDatabase } from '../client/local-database.ts';
import { LedgerSynchronizer } from '../client/synchronizer.ts';
import type { SyncStatus } from '../client/synchronizer.ts';
import { CommandQueue } from '../client/command-queue.ts';
import type { QueueStatus } from '../client/command-queue.ts';
import type { LocalLedger } from '../domain/local-ledger.ts';
import { commandInputSchema, mutationBindings } from '../domain/manual-commands.ts';
import type { ManualMutation, QueuedCommand } from '../domain/manual-commands.ts';

export type WorkspaceRuntime = { database: LocalDatabase; synchronizer: LedgerSynchronizer; queue: CommandQueue };
export function useWorkspace(ownerId: string) {
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null), [ledger, setLedger] = useState<LocalLedger | null>(null), [commands, setCommands] = useState<QueuedCommand[]>([]), [error, setError] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: 'idle', errorCode: null, dataRevision: null }), [queueStatus, setQueueStatus] = useState<QueueStatus>({ state: 'idle', errorCode: null });
  const [attempt, setAttempt] = useState(0), reread = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    let cancelled = false, runtime: WorkspaceRuntime | null = null, unsubscribe: (() => void) | null = null, reading = false, readAgain = false, revoking = false;
    const denied = (status: SyncStatus | QueueStatus) => {
      if (status.state !== 'auth_required' || !runtime) return;
      runtime.queue.stop(); runtime.synchronizer.stop();
      if (status.errorCode !== 'MEMBER_SUSPENDED' || revoking) return;
      revoking = true;
      const current = runtime;
      void Promise.all([current.queue.stopAndWait(), current.synchronizer.stopAndWait()]).then(async () => {
        await current.database.clearSyncedData();
        try { localStorage.removeItem('lowkkey.last-owner'); } catch { if (!cancelled) setError(true); }
      }).catch(() => { if (!cancelled) setError(true); });
    };
    const read = async () => {
      if (!runtime || cancelled) return;
      if (reading) { readAgain = true; return; }
      reading = true;
      try {
        const [next, pending] = await Promise.all([runtime.database.readLedger(), runtime.database.listCommands()]);
        if (!cancelled) { setLedger(next); setCommands(pending); setError(false); }
      } catch { if (!cancelled) setError(true); }
      finally { reading = false; if (readAgain && !cancelled) { readAgain = false; void read(); } }
    };
    reread.current = read;
    void LocalDatabase.open(ownerId).then(async database => {
      if (cancelled) { database.close(); return; }
      const synchronizer = new LedgerSynchronizer(database, { onStatus: status => { if (!cancelled) { setSyncStatus(status); denied(status); } } });
      const queue = new CommandQueue(database, synchronizer, { onStatus: status => { if (!cancelled) { setQueueStatus(status); denied(status); } } });
      runtime = { database, synchronizer, queue }; setRuntime(runtime); unsubscribe = database.subscribe(() => { void read(); });
      await read(); if (cancelled) return; synchronizer.start(); queue.start();
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; reread.current = null; unsubscribe?.(); runtime?.queue.stop(); runtime?.synchronizer.stop(); runtime?.database.close(); };
  }, [ownerId, attempt]);
  async function retry() {
    if (!runtime) { setError(false); setAttempt(value => value + 1); return; }
    await reread.current?.(); await runtime.queue.retry();
  }
  return { runtime, ledger, commands, error, syncStatus, queueStatus, retry };
}
export function commandFor(ledger: LocalLedger, mutation: ManualMutation, clientEntityId: string, localDate: string, entryTimezone: string) {
  const dependencies = [...new Set(mutationBindings(mutation).flatMap(binding => binding.source.kind === 'receipt' ? [binding.source.operationId] : []))];
  return commandInputSchema.parse({ schemaVersion: 1, ownerId: ledger.ownerId, operationId: crypto.randomUUID(), clientEntityId, mutation, localDate, entryTimezone, dependencies, createdAt: new Date().toISOString(), restoreEpoch: ledger.restoreEpoch, baseDataRevision: ledger.dataRevision });
}
