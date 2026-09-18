import { test, expect, localLogin } from './fixtures.ts';
import type * as Storage from '../../src/client/local-database.ts';
import type * as Pull from '../../src/client/synchronizer.ts';
import type * as Queue from '../../src/client/command-queue.ts';
import type * as Commands from '../../src/domain/manual-commands.ts';

test('a lost write receipt survives reload and is recovered without another POST', async ({ page }, info) => {
  const account = await localLogin(page);
  const operation = await page.evaluate(async ({ account, date }) => {
    const storagePath = '/src/client/local-database.ts', pullPath = '/src/client/synchronizer.ts', queuePath = '/src/client/command-queue.ts';
    const { LocalDatabase } = await import(storagePath) as typeof Storage;
    const { LedgerSynchronizer } = await import(pullPath) as typeof Pull;
    const { CommandQueue } = await import(queuePath) as typeof Queue;
    const db = await LocalDatabase.open(account.ownerId), sync = new LedgerSynchronizer(db);
    await sync.refresh(); const ledger = (await db.readLedger())!;
    const id = crypto.randomUUID(), operationId = crypto.randomUUID(), createdAt = new Date().toISOString();
    await db.enqueueCommand({ schemaVersion: 1, ownerId: account.ownerId, operationId, clientEntityId: id, mutation: { kind: 'weight.create', input: { id, localDate: date, entryTimezone: account.timezone, timePrecision: 'date', occurredAt: null, value: '70.00', unit: 'kg', condition: 'unspecified', primaryChoice: 'extra' } }, localDate: date, entryTimezone: account.timezone, createdAt, dependencies: [], restoreEpoch: ledger.restoreEpoch, baseDataRevision: ledger.dataRevision });
    const queue = new CommandQueue(db, sync, { fetch: async (url, init) => {
      const response = await fetch(url, init);
      if (init?.method === 'POST' && response.ok) throw new TypeError('Simulated lost receipt');
      return response;
    } });
    await queue.flush(); const pending = await db.readCommand(operationId);
    queue.stop(); sync.stop(); db.close();
    return { id, operationId, state: pending?.state, attempts: pending?.attempts };
  }, { account, date: '1970-' + (info.project.name === 'en' ? '09' : info.project.name === 'zh-Hant' ? '05' : '01') + '-01' });
  expect(operation).toMatchObject({ state: 'uncertain', attempts: 1 });
  await page.reload();
  const recovered = await page.evaluate(async ({ account, operation }) => {
    const storagePath = '/src/client/local-database.ts', pullPath = '/src/client/synchronizer.ts', queuePath = '/src/client/command-queue.ts';
    const { LocalDatabase } = await import(storagePath) as typeof Storage;
    const { LedgerSynchronizer } = await import(pullPath) as typeof Pull;
    const { CommandQueue } = await import(queuePath) as typeof Queue;
    const db = await LocalDatabase.open(account.ownerId), sync = new LedgerSynchronizer(db), calls: string[] = [];
    const queue = new CommandQueue(db, sync, { fetch: async (url, init) => { calls.push(`${init?.method} ${String(url)}`); return fetch(url, init); } });
    await queue.flush(); const row = await db.readCommand(operation.operationId), ledger = await db.readLedger();
    const weight = ledger?.items.get(`weight_entry:${operation.id}`);
    queue.stop(); sync.stop(); db.close();
    return { state: row?.state, attempts: row?.attempts, calls, weight };
  }, { account, operation });
  expect(recovered.state).toBe('committed'); expect(recovered.attempts).toBe(1); expect(recovered.calls).toEqual([`GET /api/v1/operations/${operation.operationId}`]);
  expect(recovered.weight).toMatchObject({ value: { id: operation.id, revision: 1, value: '70.00', unit: 'kg' } });
});

test('offline training commands use predecessor receipts for root and child versions', async ({ page }) => {
  const account = await localLogin(page);
  const result = await page.evaluate(async account => {
    const storagePath = '/src/client/local-database.ts', pullPath = '/src/client/synchronizer.ts', queuePath = '/src/client/command-queue.ts';
    const { LocalDatabase } = await import(storagePath) as typeof Storage;
    const { LedgerSynchronizer } = await import(pullPath) as typeof Pull;
    const { CommandQueue } = await import(queuePath) as typeof Queue;
    const db = await LocalDatabase.open(account.ownerId), sync = new LedgerSynchronizer(db); await sync.refresh();
    const ledger = (await db.readLedger())!, date = account.localDate, createdAt = new Date().toISOString();
    const exerciseId = crypto.randomUUID(), setupId = crypto.randomUUID(), sessionId = crypto.randomUUID(), exerciseRowId = crypto.randomUUID(), setId = crypto.randomUUID();
    const enqueue = async (mutation: unknown, clientEntityId: string, dependencies: string[] = []) => {
      const operationId = crypto.randomUUID();
      await db.enqueueCommand({ schemaVersion: 1, ownerId: account.ownerId, operationId, clientEntityId, mutation, localDate: date, entryTimezone: account.timezone, createdAt, dependencies, restoreEpoch: ledger.restoreEpoch, baseDataRevision: ledger.dataRevision }); return operationId;
    };
    const ref = (type: string, id: string, operationId: string) => ({ type, id, source: { kind: 'receipt', operationId } });
    const exercise = await enqueue({ kind: 'exercise.create', input: { id: exerciseId, name: 'Synthetic queue bench', locale: 'en', equipmentType: 'barbell', variant: { schemaVersion: 1, angle: 'flat', grip: 'pronated', laterality: 'bilateral', note: null }, muscles: { schemaVersion: 1, primary: ['chest'], secondary: ['triceps'] } } }, exerciseId);
    const setup = await enqueue({ kind: 'setup.create', input: { id: setupId, exerciseId, equipmentInstance: 'Fixture bar', loadSemantics: 'external_total', loadUnit: 'lb', includesBar: true, barWeightDecimal: '45', barUnit: 'lb' } }, setupId, [exercise]);
    const session = await enqueue({ kind: 'session.create', input: { id: sessionId, localDate: date, entryTimezone: account.timezone } }, sessionId);
    const added = await enqueue({ kind: 'session-exercise.create', session: ref('workout_session', sessionId, session), input: { id: exerciseRowId, setupId, ordinal: 1 } }, exerciseRowId, [setup, session]);
    const set = await enqueue({ kind: 'set.create', session: ref('workout_session', sessionId, added), input: { id: setId, sessionExerciseId: exerciseRowId, ordinal: 1, reps: 8, load: { value: '110', unit: 'lb', semantics: 'external_total' } } }, setId, [added]);
    const edit = await enqueue({ kind: 'set.update', session: ref('workout_session', sessionId, set), target: ref('workout_set', setId, set), input: { reps: 5 } }, setId, [set]);
    const finished = await enqueue({ kind: 'session.transition', target: ref('workout_session', sessionId, edit), action: 'finish' }, sessionId, [edit]);
    let online = false; const environment = { online: () => online, visible: () => true, subscribe: () => () => {} }, writes: Array<{ method: string; path: string; revision: string | null }> = [];
    const queue = new CommandQueue(db, sync, { environment, fetch: async (url, init) => { writes.push({ method: String(init?.method), path: String(url), revision: new Headers(init?.headers).get('If-Match') }); return fetch(url, init); } });
    await queue.flush(); const before = writes.length; online = true; await queue.flush();
    const commands = await db.listCommands(), after = await db.readLedger(), row = after?.items.get(`workout_set:${setId}`), sessionRow = after?.items.get(`workout_session:${sessionId}`);
    const relevant = [exercise, setup, session, added, set, edit, finished].map(id => commands.find(command => command.operationId === id));
    queue.stop(); sync.stop(); db.close();
    return { before, states: relevant.map(command => ({ state: command?.state, issue: command?.issue })), writes, row, sessionRow };
  }, account);
  expect(result.before).toBe(0); expect(result.states.map(row => row.state), JSON.stringify(result.states)).toEqual(Array(7).fill('committed'));
  expect(result.row).toMatchObject({ value: { reps: 5, loadDecimal: '110', unit: 'lb', revision: 2, rpeHalfUnits: null, setType: 'unknown' } });
  expect(result.sessionRow).toMatchObject({ value: { status: 'completed', revision: 5 } });
  expect(result.writes.filter(write => write.revision !== null).map(write => write.revision)).toEqual(['"1"', '"2"', '"3"', '"4"']);
});

test('IndexedDB atomically saves commands with draft removal and protects resolution across tabs', async ({ page }) => {
  const account = await localLogin(page);
  const result = await page.evaluate(async account => {
    const storagePath = '/src/client/local-database.ts', pullPath = '/src/client/synchronizer.ts', commandPath = '/src/domain/manual-commands.ts';
    const { LocalDatabase } = await import(storagePath) as typeof Storage;
    const { LedgerSynchronizer } = await import(pullPath) as typeof Pull;
    const { commandInputSchema } = await import(commandPath) as typeof Commands;
    const db = await LocalDatabase.open(account.ownerId), sync = new LedgerSynchronizer(db); await sync.refresh();
    const ledger = (await db.readLedger())!, id = crypto.randomUUID(), createdAt = new Date().toISOString(), draftId = `weight-${id}`;
    const input = commandInputSchema.parse({ schemaVersion: 1, ownerId: account.ownerId, operationId: crypto.randomUUID(), clientEntityId: id, mutation: { kind: 'weight.create', input: { id, localDate: account.localDate, entryTimezone: account.timezone, timePrecision: 'date', occurredAt: null, value: '70', unit: 'kg', condition: 'unspecified' } }, localDate: account.localDate, entryTimezone: account.timezone, createdAt, dependencies: [], restoreEpoch: ledger.restoreEpoch, baseDataRevision: ledger.dataRevision });
    await db.saveDraft({ id: draftId, ownerId: account.ownerId, kind: 'weight', rawFields: { value: '70' }, baseRefs: [], localDate: account.localDate, entryTimezone: account.timezone, updatedAt: createdAt });
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) { if (this.name === 'drafts') throw new DOMException('Synthetic quota error', 'QuotaExceededError'); return originalDelete.call(this, key); };
    let failed = false;
    try { await db.enqueueCommand(input, { id: draftId, updatedAt: createdAt }); } catch { failed = true; } finally { IDBObjectStore.prototype.delete = originalDelete; }
    const afterFailure = { command: await db.readCommand(input.operationId), draft: await db.readDraft(draftId) };
    const first = await db.enqueueCommand(input, { id: draftId, updatedAt: createdAt }), duplicate = await db.enqueueCommand(input);
    let changedRejected = false; try { await db.enqueueCommand({ ...input, createdAt: new Date(Date.now() + 1).toISOString() }); } catch { changedRejected = true; }
    const other = await LocalDatabase.open(account.ownerId);
    const results = await Promise.allSettled([db.updateCommand(first.operationId, first.localRevision, { state: 'needs_review', reviewRequired: true }), other.updateCommand(first.operationId, first.localRevision, { state: 'conflict' })]);
    const current = (await db.readCommand(first.operationId))!, replacement = { ...input, operationId: crypto.randomUUID() };
    await db.resolveCommand(first.operationId, current.localRevision, replacement);
    const resolved = [await db.readCommand(first.operationId), await db.readCommand(replacement.operationId)], removed = await db.readDraft(draftId);
    await db.resolveCommand(replacement.operationId, 1); other.close(); sync.stop(); db.close();
    return { failed, afterFailure, duplicateRevision: duplicate.localRevision, changedRejected, successfulClaims: results.filter(result => result.status === 'fulfilled').length, states: resolved.map(command => command?.state), removed };
  }, account);
  expect(result.failed).toBe(true); expect(result.afterFailure.command).toBeNull(); expect(result.afterFailure.draft?.rawFields.value).toBe('70');
  expect(result.duplicateRevision).toBe(1); expect(result.changedRejected).toBe(true); expect(result.successfulClaims).toBe(1); expect(result.states).toEqual(['discarded', 'queued']); expect(result.removed).toBeNull();
});

test('account and restore assertions reject a stale tab before a health write', async ({ page }) => {
  const account = await localLogin(page);
  const result = await page.evaluate(async account => {
    const id = crypto.randomUUID(), body = JSON.stringify({ id, localDate: account.localDate, entryTimezone: account.timezone, occurredAt: null, timePrecision: 'date', value: '70', unit: 'kg', condition: 'unspecified', primaryChoice: 'extra' });
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };
    const wrongAccount = await fetch('/api/v1/weights', { method: 'POST', headers: { ...headers, 'X-Account-Id': crypto.randomUUID() }, body });
    const wrongEpoch = await fetch('/api/v1/weights', { method: 'POST', headers: { ...headers, 'X-Account-Id': account.ownerId, 'X-Restore-Epoch': crypto.randomUUID() }, body });
    const missing = await fetch(`/api/v1/weights/${id}`);
    return { wrongAccount: wrongAccount.status, wrongEpoch: wrongEpoch.status, missing: missing.status };
  }, account);
  expect(result).toEqual({ wrongAccount: 401, wrongEpoch: 410, missing: 404 });
});
