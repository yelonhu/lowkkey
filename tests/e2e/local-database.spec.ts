import { test, expect, localLogin } from './fixtures.ts';
import type * as LocalDbModule from '../../src/client/local-database.ts';
import type * as SyncModule from '../../src/client/synchronizer.ts';

test('commits a real sync batch once and keeps half-input and return scene across reload', async ({ page, context }) => {
  const profile = await localLogin(page);
  const saved = await page.evaluate(async profile => {
    const path = '/src/client/local-database.ts', { LocalDatabase } = await import(path) as typeof LocalDbModule;
    const database = await LocalDatabase.open(profile.ownerId);
    const syncPath = '/src/client/synchronizer.ts', { LedgerSynchronizer } = await import(syncPath) as typeof SyncModule;
    const synchronizer = new LedgerSynchronizer(database);
    if (!(await synchronizer.refresh())?.rebuilt) throw new Error('Initial snapshot failed');
    const before = await database.readLedger(); if (!before) throw new Error('Missing baseline');
    const now = new Date().toISOString(), id = crypto.randomUUID();
    await database.saveDraft({ id: 'current-group', ownerId: profile.ownerId, kind: 'set', rawFields: { load: '１１０．', reps: '5' }, baseRefs: [], localDate: profile.localDate, entryTimezone: profile.timezone, updatedAt: now });
    await database.saveScene({ ownerId: profile.ownerId, view: 'session', localDate: profile.localDate, sessionId: null, currentGroupId: null, scrollY: 217, timerStartedAt: now, draftId: 'current-group', updatedAt: now });
    const write = await fetch('/api/v1/weights', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ id, localDate: profile.localDate, entryTimezone: profile.timezone, occurredAt: null, timePrecision: 'date', value: '70', unit: 'kg', condition: 'unspecified', primaryChoice: 'extra' }) });
    if (!write.ok) throw new Error('Weight failed');
    const response = await fetch(`/api/v1/sync?cursor=${encodeURIComponent(before.cursor)}&limit=100`), delta = (await response.json()).data;
    await database.applyDelta(delta); await database.applyDelta(delta);
    const refresh = await synchronizer.refresh(); if (!refresh || refresh.rebuilt) throw new Error('Delta refresh failed');
    const after = await database.readLedger(); synchronizer.stop(); database.close();
    return { id, before: before.dataRevision, after: after?.dataRevision, timer: now };
  }, profile);
  expect(saved.after).toBe(saved.before + 1);
  await page.reload();
  // Import before disconnecting: this tests persistence, not a yet-unimplemented
  // offline application shell or service worker.
  await page.evaluate(async () => { const path = '/src/client/local-database.ts'; await import(path); });
  await context.setOffline(true);
  const restored = await page.evaluate(async ({ profile, saved }) => {
    const path = '/src/client/local-database.ts', { LocalDatabase } = await import(path) as typeof LocalDbModule;
    const database = await LocalDatabase.open(profile.ownerId), ledger = await database.readLedger(), draft = await database.readDraft('current-group'), scene = await database.readScene();
    const value = ledger?.items.get(`weight_entry:${saved.id}`); database.close();
    const other = await LocalDatabase.open(crypto.randomUUID()), otherLedger = await other.readLedger(), otherDraft = await other.readDraft('current-group'); other.close();
    return { revision: ledger?.dataRevision, value, draft, scene, otherLedger, otherDraft };
  }, { profile, saved });
  expect(restored.revision).toBe(saved.after); expect(restored.value).toMatchObject({ kind: 'weight_entry', value: { value: '70', unit: 'kg' } });
  expect(restored.draft).toMatchObject({ rawFields: { load: '１１０．', reps: '5' } }); expect(restored.scene).toMatchObject({ scrollY: 217, timerStartedAt: saved.timer });
  expect(restored.otherLedger).toBeNull(); expect(restored.otherDraft).toBeNull();
  await context.setOffline(false);
});

test('stages snapshot pages without replacing the visible cache or erasing drafts', async ({ page }) => {
  const profile = await localLogin(page);
  const result = await page.evaluate(async profile => {
    const path = '/src/client/local-database.ts', { LocalDatabase } = await import(path) as typeof LocalDbModule;
    const database = await LocalDatabase.open(profile.ownerId);
    const firstResponse = await fetch('/api/v1/sync/snapshot?limit=1'), first = (await firstResponse.json()).data;
    const part = await database.acceptSnapshotPage(first, null), visibleDuring = await database.readLedger();
    await database.saveDraft({ id: 'unsaved', ownerId: profile.ownerId, kind: 'weight', rawFields: { value: '７０．' }, baseRefs: [], localDate: profile.localDate, entryTimezone: profile.timezone, updatedAt: new Date().toISOString() });
    let cursor = part.nextCursor;
    while (cursor) {
      const response = await fetch(`/api/v1/sync/snapshot?limit=1&cursor=${encodeURIComponent(cursor)}`);
      if (!response.ok) throw new Error('Page failed');
      cursor = (await database.acceptSnapshotPage((await response.json()).data, cursor)).nextCursor;
    }
    const complete = await database.readLedger(), draft = await database.readDraft('unsaved');
    // Starting another snapshot does not clear the complete visible generation.
    const nextFirst = (await (await fetch('/api/v1/sync/snapshot?limit=1')).json()).data;
    await database.acceptSnapshotPage(nextFirst, null);
    const duringReplacement = await database.readLedger();
    let mismatch = false;
    try { await database.acceptSnapshotPage(nextFirst, 'wrong-continuation'); } catch { mismatch = true; }
    const afterRejected = await database.readLedger(); database.close();
    return { partial: !part.complete, visibleDuring, completeSize: complete?.items.size, duringSize: duringReplacement?.items.size, afterSize: afterRejected?.items.size, draft, mismatch };
  }, profile);
  expect(result.partial).toBe(true); expect(result.visibleDuring).toBeNull(); expect(result.completeSize).toBeGreaterThanOrEqual(2);
  expect(result.duringSize).toBe(result.completeSize); expect(result.afterSize).toBe(result.completeSize); expect(result.mismatch).toBe(true);
  expect(result.draft).toMatchObject({ rawFields: { value: '７０．' } });
});

test('rolls back entity updates when cursor persistence fails, then safely retries', async ({ page }) => {
  const profile = await localLogin(page);
  const result = await page.evaluate(async profile => {
    const path = '/src/client/local-database.ts', { LocalDatabase } = await import(path) as typeof LocalDbModule;
    const database = await LocalDatabase.open(profile.ownerId);
    let cursor: string | null = null;
    do { const data: unknown = (await (await fetch(`/api/v1/sync/snapshot?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)).json()).data; cursor = (await database.acceptSnapshotPage(data, cursor)).nextCursor; } while (cursor);
    const before = await database.readLedger(); if (!before) throw new Error('Missing baseline');
    const id = crypto.randomUUID();
    const response = await fetch('/api/v1/weights', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ id, localDate: profile.localDate, entryTimezone: profile.timezone, occurredAt: null, timePrecision: 'date', value: '70', unit: 'kg', condition: 'unspecified', primaryChoice: 'extra' }) });
    if (!response.ok) throw new Error('Weight failed');
    const delta = (await (await fetch(`/api/v1/sync?cursor=${encodeURIComponent(before.cursor)}`)).json()).data;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) { if (this.name === 'meta' && key === 'ledger') throw new DOMException('Injected quota failure', 'QuotaExceededError'); return originalPut.call(this, value, key); };
    let failed = false;
    try { await database.applyDelta(delta); } catch { failed = true; } finally { IDBObjectStore.prototype.put = originalPut; }
    const rolledBack = await database.readLedger(); await database.applyDelta(delta);
    const retried = await database.readLedger(); database.close();
    return { failed, before: before.dataRevision, rolledBack: rolledBack?.dataRevision, beforeItemPresent: rolledBack?.items.has(`weight_entry:${id}`), retried: retried?.dataRevision, itemPresent: retried?.items.has(`weight_entry:${id}`) };
  }, profile);
  expect(result.failed).toBe(true); expect(result.rolledBack).toBe(result.before); expect(result.beforeItemPresent).toBe(false);
  expect(result.retried).toBe(result.before + 1); expect(result.itemPresent).toBe(true);
});

test('rejects foreign drafts and health facts in return state and exposes storage failures', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/client/local-database.ts', { LocalDatabase } = await import(path) as typeof LocalDbModule;
    const owner = crypto.randomUUID(), database = await LocalDatabase.open(owner), other = await LocalDatabase.open(crypto.randomUUID()), now = new Date().toISOString();
    const draft = { id: 'half-input', ownerId: owner, kind: 'set', rawFields: { reps: '1' }, baseRefs: [], localDate: null, entryTimezone: null, updatedAt: now };
    let foreign = false, forgedScene = false, quota = false;
    try { await other.saveDraft(draft); } catch { foreign = true; }
    try { await database.saveScene({ ownerId: owner, view: 'session', localDate: null, sessionId: null, currentGroupId: null, scrollY: 0, timerStartedAt: null, draftId: null, updatedAt: now, snapshot: { reps: 8 } }); } catch { forgedScene = true; }
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) { if (this.name === 'drafts') throw new DOMException('Injected storage failure', 'QuotaExceededError'); return originalPut.call(this, value, key); };
    try { await database.saveDraft(draft); } catch { quota = true; } finally { IDBObjectStore.prototype.put = originalPut; }
    const absent = await database.readDraft(draft.id); await database.saveDraft(draft);
    await other.saveDraft({ ...draft, ownerId: other.ownerId, rawFields: { reps: '2' } });
    await database.clearOwnerData(); const cleared = await database.readDraft(draft.id), retained = await other.readDraft(draft.id);
    database.close(); other.close(); return { foreign, forgedScene, quota, absent, cleared, retained };
  });
  expect(result.foreign).toBe(true); expect(result.forgedScene).toBe(true); expect(result.quota).toBe(true); expect(result.absent).toBeNull(); expect(result.cleared).toBeNull(); expect(result.retained).toMatchObject({ rawFields: { reps: '2' } });
});

test('conditional draft removal never erases a newer local edit', async ({ page }) => {
  const account = await localLogin(page);
  const retained = await page.evaluate(async ownerId => {
    const path='/src/client/local-database.ts';const {LocalDatabase}=await import(path);const db=await LocalDatabase.open(ownerId);
    try {
      const draft={id:'conditional-draft',ownerId,kind:'weight',rawFields:{value:'70'},baseRefs:[],localDate:'2000-01-01',entryTimezone:'UTC',updatedAt:'2026-09-17T00:00:00.000Z'};
      await db.saveDraft(draft);await db.saveDraft({...draft,rawFields:{value:'70.2'},updatedAt:'2026-09-17T00:00:00.001Z'});
      await db.removeDraft(draft.id,draft.updatedAt);return(await db.readDraft(draft.id))?.rawFields.value;
    } finally {db.close();}
  },account.ownerId);
  expect(retained).toBe('70.2');
});
