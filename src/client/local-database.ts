import { z } from 'zod';
import { entityRefSchema } from '../domain/artifacts.ts';
import { ledgerItemSchema, ledgerKey, ledgerOwner, snapshotPageSchema, syncPageSchema } from '../domain/ledger.ts';
import type { LedgerItem } from '../domain/ledger.ts';
import { LocalLedgerError, applySyncPage } from '../domain/local-ledger.ts';
import type { LocalLedger } from '../domain/local-ledger.ts';
import { localDateSchema, scaledSchema, timezoneSchema, utcSchema, uuidSchema } from '../domain/primitives.ts';
import { commandInputSchema, newQueuedCommand, queuedCommandSchema, QueueError } from '../domain/manual-commands.ts';
import type { CommandInput, QueuedCommand } from '../domain/manual-commands.ts';

const metaSchema = z.strictObject({ ownerId: uuidSchema, restoreEpoch: uuidSchema, catalogRevision: z.string().regex(/^[a-f0-9]{64}$/), dataRevision: scaledSchema, cursor: z.string().min(1) });
const stageSchema = metaSchema.omit({ cursor: true }).extend({ capturedAt: utcSchema, nextCursor: z.string().min(1) });
export const localDraftSchema = z.strictObject({
  id: z.string().min(1).max(200), ownerId: uuidSchema, kind: z.enum(['weight', 'set', 'meal', 'plan', 'profile', 'conversation']),
  rawFields: z.record(z.string().max(120), z.string().max(20000)).refine(value => Object.keys(value).length <= 100 && JSON.stringify(value).length <= 128000, 'Draft is too large'),
  baseRefs: z.array(entityRefSchema).max(30), localDate: localDateSchema.nullable(), entryTimezone: timezoneSchema.nullable(), updatedAt: utcSchema,
});
export type LocalDraft = z.infer<typeof localDraftSchema>;
export const returnSceneSchema = z.strictObject({
  ownerId: uuidSchema, view: z.enum(['overview', 'session', 'weight', 'diet', 'settings']), localDate: localDateSchema.nullable(),
  sessionId: uuidSchema.nullable(), currentGroupId: uuidSchema.nullable(), scrollY: z.number().finite().min(0), timerStartedAt: utcSchema.nullable(), draftId: z.string().max(200).nullable(), updatedAt: utcSchema,
});
export type ReturnScene = z.infer<typeof returnSceneSchema>;
const stores = ['entities', 'meta', 'snapshotEntities', 'drafts', 'scene', 'commands'] as const;
type StoreName = typeof stores[number];
export type CommandStatePatch = Partial<Pick<QueuedCommand, 'state' | 'firstAttemptAt' | 'attempts' | 'issue' | 'receipt' | 'lease' | 'reviewRequired'>>;
function commandInput(command: QueuedCommand): CommandInput { return commandInputSchema.parse(Object.fromEntries(Object.keys(commandInputSchema.shape).map(key => [key, command[key as keyof QueuedCommand]]))); }
function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error ?? new Error('LOCAL_STORAGE_FAILED')); }); }
function metadata(ledger: LocalLedger) { return metaSchema.parse({ ownerId: ledger.ownerId, restoreEpoch: ledger.restoreEpoch, catalogRevision: ledger.catalogRevision, dataRevision: ledger.dataRevision, cursor: ledger.cursor }); }

/** One IndexedDB database per authenticated owner. Never put private responses
 * in Cache Storage, and never use a navigation snapshot as entity state. */
export class LocalDatabase {
  private readonly listeners = new Set<() => void>();
  private readonly channel: BroadcastChannel | null;
  private constructor(readonly ownerId: string, private readonly database: IDBDatabase) {
    this.channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`lowkkey-ledger-${ownerId}`) : null;
    if (this.channel) this.channel.onmessage = () => { for (const listener of this.listeners) listener(); };
  }
  static async open(ownerId: string, factory: IDBFactory = indexedDB): Promise<LocalDatabase> {
    uuidSchema.parse(ownerId);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(`lowkkey-${ownerId}`, 2);
      let blocked = false;
      open.onupgradeneeded = () => { for (const name of stores) if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name); };
      open.onblocked = () => { blocked = true; reject(new Error('LOCAL_STORAGE_BLOCKED')); };
      open.onerror = () => reject(open.error ?? new Error('LOCAL_STORAGE_FAILED'));
      open.onsuccess = () => { if (blocked) open.result.close(); else resolve(open.result); };
    });
    const local = new LocalDatabase(ownerId, database);
    database.onversionchange = () => local.close();
    return local;
  }
  close() { this.channel?.close(); this.listeners.clear(); this.database.close(); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async readMetadata(): Promise<z.infer<typeof metaSchema> | null> {
    return this.transaction(['meta'], 'readonly', async transaction => {
      const raw = await request(transaction.objectStore('meta').get('ledger'));
      if (!raw) return null;
      const meta = metaSchema.parse(raw);
      if (meta.ownerId !== this.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
      return meta;
    });
  }
  private async transaction<T>(names: StoreName[], mode: IDBTransactionMode, run: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
    const transaction = this.database.transaction(names, mode);
    const done = new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error('LOCAL_STORAGE_FAILED')); transaction.onerror = () => { /* onabort reports the failed transaction. */ }; });
    // Register rejection handling before any request can abort the transaction.
    const completion = done.then(() => ({ ok: true as const }), error => ({ ok: false as const, error: error as unknown }));
    try {
      const value = await run(transaction), result = await completion;
      if (!result.ok) throw result.error;
      if (mode === 'readwrite') { this.channel?.postMessage('changed'); for (const listener of this.listeners) listener(); }
      return value;
    } catch (error) {
      try { transaction.abort(); } catch { /* A failed or completed transaction is already closed. */ }
      await completion; throw error;
    }
  }
  async readLedger(): Promise<LocalLedger | null> {
    return this.transaction(['meta', 'entities'], 'readonly', async transaction => {
      const raw = await request(transaction.objectStore('meta').get('ledger'));
      if (!raw) return null;
      const meta = metaSchema.parse(raw);
      if (meta.ownerId !== this.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
      const values: unknown[] = await request(transaction.objectStore('entities').getAll()), items = new Map<string, LedgerItem>();
      for (const value of values) {
        const item = ledgerItemSchema.parse(value);
        if (ledgerOwner(item) !== null && ledgerOwner(item) !== this.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
        items.set(ledgerKey(item), item);
      }
      return { ...meta, items };
    });
  }
  async applyDelta(payload: unknown): Promise<void> {
    const page = syncPageSchema.parse(payload);
    if (page.ownerId !== this.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
    await this.transaction(['meta', 'entities'], 'readwrite', async transaction => {
      const metaStore = transaction.objectStore('meta'), raw = await request(metaStore.get('ledger'));
      if (!raw) throw new LocalLedgerError('SNAPSHOT_REQUIRED');
      const meta = metaSchema.parse(raw), entities = transaction.objectStore('entities');
      if (meta.ownerId !== this.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
      const keys = new Set(page.items.filter(batch => batch.dataRevision > meta.dataRevision).flatMap(batch => [...batch.changes, ...batch.supplements].map(ledgerKey)));
      const items = new Map<string, LedgerItem>();
      await Promise.all([...keys].map(async key => { const row = await request(entities.get(key)); if (row) items.set(key, ledgerItemSchema.parse(row)); }));
      const next = applySyncPage({ ...meta, items }, page);
      for (const [key, item] of next.items) await request(entities.put(item, key));
      await request(metaStore.put(metadata(next), 'ledger'));
    });
  }
  async acceptSnapshotPage(payload: unknown, requestedCursor: string | null): Promise<{ nextCursor: string | null; complete: boolean }> {
    const page = snapshotPageSchema.parse(payload);
    if (page.ownerId !== this.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
    return this.transaction(['meta', 'entities', 'snapshotEntities', 'commands'], 'readwrite', async transaction => {
      const meta = transaction.objectStore('meta'), staged = transaction.objectStore('snapshotEntities'), entities = transaction.objectStore('entities');
      const currentRaw = await request(meta.get('ledger')), current = currentRaw ? metaSchema.parse(currentRaw) : null;
      if (current && current.ownerId !== this.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
      if (current && current.restoreEpoch === page.restoreEpoch && current.dataRevision > page.dataRevision) throw new LocalLedgerError('SNAPSHOT_CHANGED');
      if (requestedCursor === null) { await request(staged.clear()); await request(meta.delete('snapshot')); }
      else {
        const previous = stageSchema.safeParse(await request(meta.get('snapshot')));
        if (!previous.success || previous.data.ownerId !== this.ownerId || previous.data.nextCursor !== requestedCursor || previous.data.restoreEpoch !== page.restoreEpoch || previous.data.dataRevision !== page.dataRevision || previous.data.catalogRevision !== page.catalogRevision || previous.data.capturedAt !== page.capturedAt) throw new LocalLedgerError('SNAPSHOT_CHANGED');
      }
      for (const item of page.items) {
        const key = ledgerKey(item);
        if (await request(staged.get(key))) throw new LocalLedgerError('SNAPSHOT_CHANGED');
        await request(staged.put(item, key));
      }
      const fields = { ownerId: this.ownerId, restoreEpoch: page.restoreEpoch, catalogRevision: page.catalogRevision, dataRevision: page.dataRevision };
      if (page.syncCursor === null) {
        await request(meta.put(stageSchema.parse({ ...fields, capturedAt: page.capturedAt, nextCursor: page.nextCursor }), 'snapshot'));
        return { nextCursor: page.nextCursor, complete: false };
      }
      // No observable half-snapshot: replacement and cursor commit atomically.
      const values: unknown[] = await request(staged.getAll());
      await request(entities.clear());
      for (const value of values) { const item = ledgerItemSchema.parse(value); await request(entities.put(item, ledgerKey(item))); }
      await request(meta.put(metaSchema.parse({ ...fields, cursor: page.syncCursor }), 'ledger'));
      const commands = transaction.objectStore('commands'), pending: unknown[] = await request(commands.getAll());
      for (const raw of pending) {
        const command = this.checkedCommand(raw);
        if (!['committed', 'discarded'].includes(command.state)) await request(commands.put(this.checkedCommand({ ...command, reviewRequired: true, localRevision: command.localRevision + 1 }), command.operationId));
      }
      await request(staged.clear()); await request(meta.delete('snapshot'));
      return { nextCursor: null, complete: true };
    });
  }
  async saveDraft(payload: unknown): Promise<void> {
    const draft = localDraftSchema.parse(payload);
    if (draft.ownerId !== this.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
    await this.transaction(['drafts'], 'readwrite', async transaction => { await request(transaction.objectStore('drafts').put(draft, draft.id)); });
  }
  async readDraft(id: string): Promise<LocalDraft | null> {
    return this.transaction(['drafts'], 'readonly', async transaction => {
      const raw = await request(transaction.objectStore('drafts').get(id));
      if (!raw) return null;
      const draft = localDraftSchema.parse(raw);
      if (draft.ownerId !== this.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
      return draft;
    });
  }
  async removeDraft(id: string, expectedUpdatedAt?: string): Promise<void> {
    await this.transaction(['drafts'], 'readwrite', async transaction => {
      const drafts = transaction.objectStore('drafts');
      if (expectedUpdatedAt) { const current = await request(drafts.get(id)); if (!current || localDraftSchema.parse(current).updatedAt !== expectedUpdatedAt) return; }
      await request(drafts.delete(id));
    });
  }
  async listDrafts(): Promise<LocalDraft[]> {
    return this.transaction(['drafts'], 'readonly', async transaction => {
      const values: unknown[] = await request(transaction.objectStore('drafts').getAll());
      return values.map(raw => { const draft = localDraftSchema.parse(raw); if (draft.ownerId !== this.ownerId) throw new LocalLedgerError('OWNER_MISMATCH'); return draft; });
    });
  }
  private checkedCommand(raw: unknown): QueuedCommand {
    const command = queuedCommandSchema.parse(raw);
    if (command.ownerId !== this.ownerId) throw new QueueError('OWNER_MISMATCH');
    return command;
  }
  /** The command and removal of the exact submitted draft commit together. A
   * newer draft from another tab is never erased by an older submit. */
  async enqueueCommand(raw: unknown, draft?: { id: string; updatedAt: string }): Promise<QueuedCommand> {
    return (await this.enqueueCommands([raw], draft))[0];
  }
  /** Compound UI intent (custom exercise → setup → session exercise) is saved
   * locally all-or-nothing. Server commands retain their own atomic receipts. */
  async enqueueCommands(raw: unknown[], draft?: { id: string; updatedAt: string }): Promise<QueuedCommand[]> {
    if (!raw.length || raw.length > 20) throw new QueueError('LOCAL_COMMAND_CHANGED');
    const next = raw.map(newQueuedCommand);
    if (next.some(command => command.ownerId !== this.ownerId)) throw new QueueError('OWNER_MISMATCH');
    if (new Set(next.map(command => command.operationId)).size !== next.length) throw new QueueError('LOCAL_COMMAND_CHANGED');
    return this.transaction(['commands', 'drafts'], 'readwrite', async transaction => {
      const commands = transaction.objectStore('commands'), result: QueuedCommand[] = [];
      let added = false;
      for (const command of next) {
        const currentRaw = await request(commands.get(command.operationId));
        if (currentRaw) {
          const current = this.checkedCommand(currentRaw);
          if (JSON.stringify(commandInput(current)) !== JSON.stringify(commandInput(command))) throw new QueueError('LOCAL_COMMAND_CHANGED');
          result.push(current); continue;
        }
        // Dependencies must precede successors, ruling out local dependency cycles.
        for (const id of command.dependencies) {
          const dependencyRaw = await request(commands.get(id));
          if (!dependencyRaw) throw new QueueError('DEPENDENCY_MISSING');
          if (this.checkedCommand(dependencyRaw).state === 'discarded') throw new QueueError('DEPENDENCY_BLOCKED');
        }
        await request(commands.add(command, command.operationId));
        result.push(command); added = true;
      }
      if (added && draft) {
        const drafts = transaction.objectStore('drafts'), currentDraft = await request(drafts.get(draft.id));
        if (currentDraft && localDraftSchema.parse(currentDraft).updatedAt === draft.updatedAt) await request(drafts.delete(draft.id));
      }
      return result;
    });
  }
  async listCommands(): Promise<QueuedCommand[]> {
    return this.transaction(['commands'], 'readonly', async transaction => {
      const values: unknown[] = await request(transaction.objectStore('commands').getAll());
      return values.map(raw => this.checkedCommand(raw)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.operationId.localeCompare(b.operationId));
    });
  }
  async readCommand(id: string): Promise<QueuedCommand | null> {
    return this.transaction(['commands'], 'readonly', async transaction => { const raw = await request(transaction.objectStore('commands').get(id)); return raw ? this.checkedCommand(raw) : null; });
  }
  async updateCommand(id: string, expectedLocalRevision: number, patch: CommandStatePatch): Promise<QueuedCommand> {
    return this.transaction(['commands'], 'readwrite', async transaction => {
      const commands = transaction.objectStore('commands'), raw = await request(commands.get(id));
      if (!raw) throw new QueueError('LOCAL_COMMAND_CHANGED');
      const current = this.checkedCommand(raw);
      if (current.localRevision !== expectedLocalRevision || ['committed', 'discarded'].includes(current.state)) throw new QueueError('LOCAL_COMMAND_CHANGED');
      const next = this.checkedCommand({ ...current, ...patch, localRevision: current.localRevision + 1 });
      await request(commands.put(next, id)); return next;
    });
  }
  /** Explicit resolution creates a fresh operation; it does not silently rebase
   * the original command or rewrite dependent commands to point at a new one. */
  async resolveCommand(id: string, expectedLocalRevision: number, replacement?: unknown, draft?: { id: string; updatedAt: string }): Promise<QueuedCommand | null> {
    const next = replacement === undefined ? null : newQueuedCommand(replacement);
    if (next && (next.ownerId !== this.ownerId || next.operationId === id || next.dependencies.includes(id))) throw new QueueError('LOCAL_COMMAND_CHANGED');
    return this.transaction(['commands', 'drafts'], 'readwrite', async transaction => {
      const commands = transaction.objectStore('commands'), raw = await request(commands.get(id));
      if (!raw) throw new QueueError('LOCAL_COMMAND_CHANGED');
      const current = this.checkedCommand(raw);
      if (current.localRevision !== expectedLocalRevision || !['queued', 'conflict', 'needs_review', 'rejected'].includes(current.state)) throw new QueueError('LOCAL_COMMAND_CHANGED');
      if (next) {
        for (const dependencyId of next.dependencies) {
          const dependencyRaw = await request(commands.get(dependencyId));
          if (!dependencyRaw || this.checkedCommand(dependencyRaw).state !== 'committed') throw new QueueError('DEPENDENCY_BLOCKED');
        }
        await request(commands.add(next, next.operationId));
      }
      await request(commands.put(this.checkedCommand({ ...current, state: 'discarded', lease: null, localRevision: current.localRevision + 1 }), id));
      const all: unknown[] = await request(commands.getAll());
      for (const raw of all) {
        const dependent = this.checkedCommand(raw);
        if (dependent.dependencies.includes(id) && !['committed', 'discarded', 'sending'].includes(dependent.state)) await request(commands.put(this.checkedCommand({ ...dependent, state: 'needs_review', issue: { code: 'DEPENDENCY_BLOCKED', params: {} }, localRevision: dependent.localRevision + 1 }), dependent.operationId));
      }
      if (next && draft) {
        const drafts = transaction.objectStore('drafts'), currentDraft = await request(drafts.get(draft.id));
        if (currentDraft && localDraftSchema.parse(currentDraft).updatedAt === draft.updatedAt) await request(drafts.delete(draft.id));
      }
      return next;
    });
  }
  async saveScene(payload: unknown): Promise<void> {
    const scene = returnSceneSchema.parse(payload);
    if (scene.ownerId !== this.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
    await this.transaction(['scene'], 'readwrite', async transaction => { await request(transaction.objectStore('scene').put(scene, 'return')); });
  }
  async readScene(): Promise<ReturnScene | null> {
    return this.transaction(['scene'], 'readonly', async transaction => {
      const value = await request(transaction.objectStore('scene').get('return'));
      if (!value) return null;
      const scene = returnSceneSchema.parse(value);
      if (scene.ownerId !== this.ownerId) throw new LocalLedgerError('OWNER_MISMATCH');
      return scene;
    });
  }
  /** Call only after the UI has resolved or exported this owner's pending data. */
  async clearOwnerData(): Promise<void> { await this.transaction([...stores], 'readwrite', async transaction => { for (const name of stores) await request(transaction.objectStore(name).clear()); }); }
  /** Revoked online access removes cached server content. Unsubmitted input is
   * retained separately so its owner can explicitly export or discard it. */
  async clearSyncedData(): Promise<void> {
    await this.transaction(['entities', 'meta', 'snapshotEntities', 'scene', 'commands'], 'readwrite', async transaction => {
      for (const name of ['entities', 'meta', 'snapshotEntities', 'scene']) await request(transaction.objectStore(name).clear());
      const commands = transaction.objectStore('commands'), rows: unknown[] = await request(commands.getAll());
      for (const raw of rows) { const command = this.checkedCommand(raw); if (['committed', 'discarded'].includes(command.state)) await request(commands.delete(command.operationId)); }
    });
  }
}
