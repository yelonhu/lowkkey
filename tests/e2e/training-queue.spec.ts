import { test, expect, localLogin } from './fixtures.ts';
import type * as Storage from '../../src/client/local-database.ts';
import type * as Pull from '../../src/client/synchronizer.ts';
test('a multi-command draft submission rolls back every local write on a late dependency failure', async ({ page }) => {
  const account = await localLogin(page);
  const result = await page.evaluate(async account => {
    const path = '/src/client/local-database.ts', pullPath = '/src/client/synchronizer.ts';
    const { LocalDatabase } = await import(path) as typeof Storage, { LedgerSynchronizer } = await import(pullPath) as typeof Pull;
    const db = await LocalDatabase.open(account.ownerId), sync = new LedgerSynchronizer(db);
    await sync.refresh(); const ledger = (await db.readLedger())!, at = new Date().toISOString(), id = crypto.randomUUID();
    const draft = { id, ownerId: account.ownerId, kind: 'set', rawFields: { load: '110', reps: '8' }, baseRefs: [], localDate: account.localDate, entryTimezone: account.timezone, updatedAt: at };
    await db.saveDraft(draft);
    const make = (dependencies: string[]) => {
      const entity = crypto.randomUUID();
      return { schemaVersion: 1, ownerId: account.ownerId, operationId: crypto.randomUUID(), clientEntityId: entity, mutation: { kind: 'session.create', input: { id: entity, localDate: account.localDate, entryTimezone: account.timezone } }, localDate: account.localDate, entryTimezone: account.timezone, createdAt: at, dependencies, restoreEpoch: ledger.restoreEpoch, baseDataRevision: ledger.dataRevision };
    };
    const first = make([]), second = make([crypto.randomUUID()]);
    let rejected = false;
    try { await db.enqueueCommands([first, second], { id, updatedAt: at }); } catch { rejected = true; }
    const rolledBack = (await db.readCommand(first.operationId)) === null && (await db.readCommand(second.operationId)) === null && (await db.readDraft(id))?.rawFields.load === '110';
    second.dependencies = [first.operationId];
    await db.enqueueCommands([first, second], { id, updatedAt: at });
    const submitted = await db.readDraft(id) === null;
    const newer = { ...draft, updatedAt: new Date(Date.parse(at) + 1000).toISOString(), rawFields: { load: '95', reps: '10' } };
    await db.saveDraft(newer);
    await db.enqueueCommands([first, second], { id, updatedAt: at });
    const replay = (await db.listCommands()).filter(row => (row.operationId === first.operationId || row.operationId === second.operationId)).length;
    const retained = (await db.readDraft(id))?.rawFields.load;
    sync.stop(); db.close(); return { rejected, rolledBack, submitted, replay, retained };
  }, account);
  expect(result).toEqual({ rejected: true, rolledBack: true, submitted: true, replay: 2, retained: '95' });
});
