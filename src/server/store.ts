import type { D1Database } from '@cloudflare/workers-types';
import { Plan, PlanInput, SessionInput, TrainingSession, Weight, WeightInput, ClientPublic, PROTOCOL_VERSION, type StateResponse } from '@lowkkey/protocol';
import { getBrief } from '@lowkkey/core';
import { StoreError } from './account.ts';

type SessionRow = { date: string; raw_text: string; sets_json: string; updated_at: string };
type WeightRow = { date: string; lb: number; updated_at: string };
type PlanRow = { day: string; items_json: string; coach: string | null; body: string | null; gain_target_json: string | null; body_revision: number | null; gain_target_revision: number | null; updated_at: string };
const sessionValue = (row: SessionRow) => TrainingSession.parse({ date: row.date, raw_text: row.raw_text, sets: JSON.parse(row.sets_json), updated_at: row.updated_at });
const planValue = (row: PlanRow) => Plan.parse({
  day: row.day, items: JSON.parse(row.items_json),
  notes: { coach: row.coach, body: row.body, gain_target: row.gain_target_json ? JSON.parse(row.gain_target_json) : null },
  body_revision: row.body_revision, gain_target_revision: row.gain_target_revision, updated_at: row.updated_at,
});
export async function state(db: D1Database, owner: string): Promise<StateResponse> {
  // D1 batch reads form one consistent snapshot across the three facts.
  const rows = await db.batch([
    db.prepare('SELECT date,raw_text,sets_json,updated_at FROM training_sessions WHERE owner_id=? ORDER BY date DESC').bind(owner),
    db.prepare('SELECT date,lb,updated_at FROM weights WHERE owner_id=? ORDER BY date').bind(owner),
    db.prepare('SELECT * FROM plans WHERE owner_id=? ORDER BY day').bind(owner),
  ]);
  return { accountId: owner, protocol: PROTOCOL_VERSION,
    sessions: (rows[0].results as SessionRow[]).map(sessionValue),
    weights: (rows[1].results as WeightRow[]).map(row => Weight.parse(row)),
    plans: (rows[2].results as PlanRow[]).map(planValue) };
}
export async function brief(db: D1Database, owner: string) { return getBrief(await state(db, owner)); }
export async function logSession(db: D1Database, owner: string, value: unknown) {
  const input = SessionInput.parse(value), sets = JSON.stringify(input.sets);
  const rows = await db.batch([
    db.prepare('INSERT INTO training_sessions(owner_id,date,raw_text,sets_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(owner_id,date) DO UPDATE SET raw_text=excluded.raw_text,sets_json=excluded.sets_json,updated_at=excluded.updated_at WHERE training_sessions.raw_text!=excluded.raw_text OR training_sessions.sets_json!=excluded.sets_json')
      .bind(owner, input.date, input.raw_text, sets, new Date().toISOString()),
    db.prepare('SELECT date,raw_text,sets_json,updated_at FROM training_sessions WHERE owner_id=? AND date=?').bind(owner, input.date),
  ]);
  return sessionValue(rows[1].results[0] as SessionRow);
}
export async function logWeight(db: D1Database, owner: string, value: unknown) {
  const input = WeightInput.parse(value);
  const rows = await db.batch([
    db.prepare('INSERT INTO weights(owner_id,date,lb,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,date) DO UPDATE SET lb=excluded.lb,updated_at=excluded.updated_at WHERE weights.lb!=excluded.lb')
      .bind(owner, input.date, input.lb, new Date().toISOString()),
    db.prepare('SELECT date,lb,updated_at FROM weights WHERE owner_id=? AND date=?').bind(owner, input.date),
  ]);
  return Weight.parse(rows[1].results[0]);
}
export async function setPlan(db: D1Database, owner: string, value: unknown) {
  const input = PlanInput.parse(value), notes = input.notes;
  const has = (key: keyof typeof notes) => Object.hasOwn(notes, key) ? 1 : 0;
  // Every explicit context write receives an account-wide sequence in the same transaction.
  // Optional fields merge inside SQL, so concurrent updates cannot lose omitted notes.
  const rows = await db.batch([
    db.prepare('UPDATE users SET data_revision=data_revision+1 WHERE id=?').bind(owner),
    db.prepare(`INSERT INTO plans(owner_id,day,items_json,coach,body,gain_target_json,body_revision,gain_target_revision,updated_at)
      VALUES (?,?,?,?,?,?,CASE WHEN ? THEN (SELECT data_revision FROM users WHERE id=?) END,CASE WHEN ? THEN (SELECT data_revision FROM users WHERE id=?) END,?)
      ON CONFLICT(owner_id,day) DO UPDATE SET items_json=excluded.items_json,
      coach=CASE WHEN ? THEN excluded.coach ELSE plans.coach END,
      body=CASE WHEN ? THEN excluded.body ELSE plans.body END,
      gain_target_json=CASE WHEN ? THEN excluded.gain_target_json ELSE plans.gain_target_json END,
      body_revision=COALESCE(excluded.body_revision,plans.body_revision),
      gain_target_revision=COALESCE(excluded.gain_target_revision,plans.gain_target_revision),updated_at=excluded.updated_at`)
      .bind(owner, input.day, JSON.stringify(input.items), notes.coach ?? null, notes.body ?? null, notes.gain_target ? JSON.stringify(notes.gain_target) : null,
        has('body'), owner, has('gain_target'), owner, new Date().toISOString(), has('coach'), has('body'), has('gain_target')),
    db.prepare('SELECT * FROM plans WHERE owner_id=? AND day=?').bind(owner, input.day),
  ]);
  return planValue(rows[2].results[0] as PlanRow);
}
export async function listClients(db: D1Database, owner: string) {
  const rows = await db.prepare('SELECT * FROM oauth_clients WHERE owner_id=? ORDER BY created_at DESC,id').bind(owner).all<{
    id: string; name: string; scopes_json: string; status: string; created_at: string; last_used_at: string | null;
  }>();
  return rows.results.map(row => ClientPublic.parse({ id: row.id, name: row.name, scopes: JSON.parse(row.scopes_json), status: row.status, createdAt: row.created_at, lastUsedAt: row.last_used_at }));
}
export async function registerOAuthClient(db: D1Database, owner: string, oauthId: string, name: string, scopes: string[], id: string) {
  if (!scopes.length || !scopes.every(scope => ['read', 'write'].includes(scope))) throw new StoreError('invalid_scope');
  await db.prepare("INSERT INTO oauth_clients(id,owner_id,oauth_client_id,name,scopes_json,status,created_at) VALUES (?,?,?,?,?,'active',?)")
    .bind(id, owner, oauthId, name, JSON.stringify(scopes), new Date().toISOString()).run();
  return id;
}
export function oauthClient(db: D1Database, owner: string, id: string) {
  return db.prepare('SELECT id,scopes_json,status,grant_id FROM oauth_clients WHERE owner_id=? AND id=?').bind(owner, id)
    .first<{ id: string; scopes_json: string; status: string; grant_id: string | null }>();
}
export async function revokeClient(db: D1Database, owner: string, id: string) {
  if (!await oauthClient(db, owner, id)) throw new StoreError('not_found', 404);
  await db.prepare("UPDATE oauth_clients SET status='revoked',revoked_at=COALESCE(revoked_at,?) WHERE owner_id=? AND id=?").bind(new Date().toISOString(), owner, id).run();
  return { ok: true as const };
}
