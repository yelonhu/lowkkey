export type QueuedCapture = { id: string; accountId: string; rawText: string; capturedAt: string; capturedLocalDate: string; timeZone: string; createdAt: string };
const DB_NAME = 'lowkkey-v02-captures';
const STORE = 'pending';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function operation<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function enqueue(value: QueuedCapture): Promise<void> { await operation('readwrite', store => store.put(value)); }
export async function dequeue(id: string): Promise<void> { await operation('readwrite', store => store.delete(id)); }
export async function pending(accountId: string): Promise<QueuedCapture[]> {
  const all = await operation<Array<QueuedCapture & {capturedAt?:string}>>('readonly', store => store.getAll());
  return all.filter(item => item.accountId === accountId).map(item=>({...item,capturedAt:item.capturedAt??item.createdAt})).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function capturedClock(now = new Date()): { capturedAt:string; capturedLocalDate: string; timeZone: string } {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const find = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return { capturedAt:now.toISOString(), capturedLocalDate: `${find('year')}-${find('month')}-${find('day')}`, timeZone };
}
