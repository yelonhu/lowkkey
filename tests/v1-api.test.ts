import { mcpResponse } from '../src/server/mcp.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile, readdir, rm } from 'node:fs/promises';
import type { D1Database } from '@cloudflare/workers-types';
import { createApi } from '../src/server/api.ts';
import { accountFor } from '../src/server/account.ts';
import * as store from '../src/server/store.ts';
const directory = '.data/showroom-api-test/' + crypto.randomUUID(),
  origin = 'http://127.0.0.1:5371',
  now = new Date('2026-10-08T15:00:00Z');
let mf: Miniflare, db: D1Database, owner: string, other: string;
const app = createApi({
  verifyIdentity: async request => ({
    issuer: 'test',
    subject: request.headers.get('X-Test-User') ?? 'one',
    email: 'test@example.com',
  }),
});
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-07-30',
    cf: false,
    host: '127.0.0.1',
    d1Databases: { DB: 'showroom-test' },
    d1Persist: directory,
    outboundService: () => {
      throw new Error('No outbound');
    },
  });
  db = (await mf.getD1Database('DB')) as D1Database;
  for (const name of (await readdir('db/showroom-migrations')).filter(n => n.endsWith('.sql')).sort()) {
    const sql = await readFile('db/showroom-migrations/' + name, 'utf8');
    await db.batch(
      sql
        .split('--> statement-breakpoint')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => db.prepare(s)),
    );
  }
  owner = await accountFor(db, { issuer: 'test', subject: 'one', email: 'test@example.com' });
  other = await accountFor(db, { issuer: 'test', subject: 'two', email: 'test@example.com' });
});
afterAll(async () => {
  await mf?.dispose();
  await rm(directory, { recursive: true, force: true });
});
const call = (path: string, method = 'GET', user = 'one', body?: unknown, extra: Record<string, string> = {}) =>
  app.fetch(
    new Request(origin + path, {
      method,
      headers: { Origin: origin, 'X-Test-User': user, 'Content-Type': 'application/json', ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { DB: db, APP_ENV: 'test', APP_ORIGIN: origin },
  );
const set = { ex: 'bench_press', load: 100, unit: 'lb', kind: 'external', reps: 8 };
const item = { ex: 'bench_press', load: 100, unit: 'lb', loadKind: 'external', sets: 3, min: 8, max: 10 };
describe('v5 account-isolated transactional storage', () => {
  it('starts genuinely empty', async () => {
    const state = await store.state(db, owner);
    expect(state.sessions).toEqual([]);
    expect(state.curations).toEqual([]);
    expect(state.profile).toEqual({ body_notes: null, gain_target: null, training_context: null });
  });
  it('atomically covers a complete session and preserves user note as literal text', async () => {
    const input = { date: '2026-10-08', title: '胸', note: '  <script>原话</script>\n第二行', sets: [set, set] };
    const first = await store.logSession(db, owner, input);
    expect(await store.logSession(db, owner, input)).toEqual(first);
    await store.logSession(db, owner, { ...input, sets: [set] });
    expect((await store.state(db, owner)).sessions[0].sets).toHaveLength(1);
    await expect(store.logSession(db, owner, { ...input, sets: [set, { ...set, cheat: 99 }] })).rejects.toThrow();
    expect((await store.state(db, owner)).sessions[0].sets).toHaveLength(1);
  });
  it('upserts weights and returns a code-computed, rounded brief', async () => {
    for (let day = 5; day <= 8; day++) await store.logWeight(db, owner, { date: '2026-10-0' + day, lb: 140 + day });
    const brief = await store.brief(db, owner, {}, now);
    expect(brief.weight.mean7).toEqual({ date: '2026-10-08', lb: 146.5, n: 4 });
    expect(brief.strength.find(s => s.ex === 'bench_press')?.latest?.e1rm).toBe(126.7);
  });
  it('keeps one plan per weekday, tracks effective schedules, and deletes empty plans', async () => {
    await store.setPlan(db, owner, { title: '胸', weekday: 5, coach: '稳定完成', items: [item] }, now);
    await expect(store.setPlan(db, owner, { title: '背', weekday: 5, items: [item] }, now)).rejects.toMatchObject({
      code: 'invalid_arguments',
      fields: [{ path: ['weekday'], message: expect.any(String) }],
    });
    await store.setPlan(db, owner, { title: '胸', weekday: 5, items: [item] }, now);
    expect((await store.state(db, owner)).plans[0].coach).toBe('稳定完成');
    expect((await store.state(db, owner)).plan_history[0].effective_date).toBe('2026-10-08');
    await store.setPlan(db, owner, { title: '临时', weekday: 1, items: [item] }, now);
    expect(await store.setPlan(db, owner, { title: '临时', weekday: 1, items: [] }, now)).toBeNull();
  });
  it('merges profile patches concurrently without losing fields and honors null', async () => {
    await Promise.all([
      store.setProfile(db, owner, { body_notes: '身体备注' }),
      store.setProfile(db, owner, { gain_target: { start: '2026-10-01', startLb: 140, min: 0.55, max: 0.77 } }),
    ]);
    expect((await store.state(db, owner)).profile).toMatchObject({
      body_notes: '身体备注',
      gain_target: { min: 0.55, max: 0.77 },
    });
    await store.setProfile(db, owner, { body_notes: null });
    expect((await store.state(db, owner)).profile.body_notes).toBeNull();
  });
  it('stores curation snapshots and deep merges recap and annotations', async () => {
    await store.curate(
      db,
      owner,
      {
        week: '2026-10-05',
        theme: { id: 'gold', why: '完成门槛' },
        recap: {
          title: '这一周。',
          letter: ['正文'],
          picks: [{ kind: 'barbell', date: '2026-10-08', ex: 'bench_press', title: '记录', note: '批注' }],
        },
        next: { date: '2026-10-09', text: '下一次练胸' },
        log: { '2026-10-08': '这次的批注' },
      },
      now,
    );
    await Promise.all([
      store.curate(db, owner, { week: '2026-10-05', recap: { title: '新标题' } }, now),
      store.curate(db, owner, { week: '2026-10-05', body: { date: '2026-10-08', text: '体重批注' } }, now),
    ]);
    const state = await store.state(db, owner, now);
    expect(state.curations[0].recap).toMatchObject({ title: '新标题', letter: ['正文'] });
    expect(state.curations[0].body?.text).toBe('体重批注');
    expect(state.annotations['2026-10-08']).toBe('这次的批注');
    expect(state.theme_state.active).toBe('gold');
    const count = await db
      .prepare('SELECT count(*) n FROM curation_versions WHERE owner_id=?')
      .bind(owner)
      .first<{ n: number }>();
    expect(count?.n).toBe(3);
  });
  it('rejects curation reference and text errors with no partial writes', async () => {
    const before = await store.state(db, owner, now);
    for (const input of [
      { theme: { id: 'pearl', why: '好！' } },
      { next: { date: '2026-10-07', text: '过去' } },
      { next: { date: '2026-10-10', text: '没有计划' } },
      { recap: { picks: [{ kind: 'barbell', date: '2026-10-08', ex: 'back_squat', title: '无效', note: '' }] } },
      { log: { '2026-01-01': '无记录' } },
    ])
      await expect(store.curate(db, owner, { week: '2026-10-05', ...input }, now)).rejects.toThrow();
    expect((await store.state(db, owner, now)).curations).toEqual(before.curations);
  });
  it('clears nested fields and annotations explicitly', async () => {
    await store.curate(
      db,
      owner,
      { week: '2026-10-05', recap: { title: null }, log: { '2026-10-08': null }, body: null },
      now,
    );
    const state = await store.state(db, owner, now);
    expect(state.curations[0].recap?.title).toBeNull();
    expect(state.annotations).toEqual({});
    expect(state.curations[0].body).toBeNull();
  });
  it('ignores historical manual preferences and removes manual mutation', async () => {
    await db
      .prepare("INSERT INTO preferences(owner_id,theme,manual_week) VALUES (?,'pearl','2026-10-05')")
      .bind(owner)
      .run();
    expect((await store.state(db, owner, now)).theme_state).toMatchObject({
      user: 'ink',
      active: 'gold',
      manual_this_week: false,
      source_week: '2026-10-05',
      reason: '完成门槛',
    });
    expect((await store.state(db, other, now)).theme_state.active).toBe('ink');
    expect((await store.state(db, owner, new Date('2026-10-12T15:00:00Z'))).theme_state.active).toBe('gold');
  });
  it('isolates reads and deletion; returns deleted contents', async () => {
    await expect(store.deleteFact(db, other, { kind: 'session', date: '2026-10-08' })).rejects.toThrow('not_found');
    const result = await store.deleteFact(db, owner, { kind: 'session', date: '2026-10-08' });
    expect(result.deleted).toMatchObject({ title: '胸' });
    expect((await store.state(db, owner)).sessions).toEqual([]);
    await expect(store.deleteFact(db, owner, { kind: 'session', date: '2026-10-08' })).rejects.toThrow('not_found');
    expect((await store.state(db, other)).weights).toEqual([]);
  });
  it('retires the theme endpoint and keeps origin and account checks', async () => {
    expect(
      (await call('/v1/preferences/theme', 'POST', 'one', { theme: 'ink' }, { Origin: 'https://foreign.invalid' }))
        .status,
    ).toBe(403);
    expect(
      (await call('/v1/preferences/theme', 'POST', 'one', { theme: 'ink' }, { 'X-Lowkkey-Account': other })).status,
    ).toBe(409);
    expect((await call('/v1/preferences/theme', 'POST', 'one', { theme: 'ink' })).status).toBe(404);
    expect((await call('/v1/preferences/theme', 'POST', 'one', { theme: 'bad' })).status).toBe(404);
    expect(((await (await call('/v1/export')).json()) as { format: string }).format).toBe('lowkkey.showroom.v5');
  });
  it('retains authorization revocation and rejects old scopes and business routes', async () => {
    await store.registerOAuthClient(db, owner, 'oauth', 'test', ['read', 'write'], 'client');
    await expect(store.registerOAuthClient(db, owner, 'old', 'old', ['submit'], 'old')).rejects.toThrow(
      'invalid_scope',
    );
    await expect(store.revokeClient(db, other, 'client')).rejects.toThrow('not_found');
    expect((await call('/v1/clients/client/revoke', 'POST', 'one', {})).status).toBe(200);
    expect((await store.oauthClient(db, owner, 'client'))?.status).toBe('revoked');
    for (const path of ['/v1/capture', '/v1/entries', '/v1/proposals', '/v1/events'])
      expect((await call(path)).status).toBe(404);
  });
});

describe('daily notes', () => {
  it('preserves literal text, is separate from facts, and enables a notes-only account', async () => {
    const input = { text: '  <script>文字</script>\n\n135 × 8 🙂！  ', revision: 0 };
    const response = await call('/v1/notes/2026-10-12', 'PUT', 'two', input);
    expect(response.status).toBe(200);
    const note = (await response.json()) as { revision: number; text: string };
    expect(note.text).toBe(input.text);
    expect(note.revision).toBe(1);
    expect(await (await call('/v1/notes/2026-10-12', 'PUT', 'two', input)).json()).toEqual(note);
    expect(((await (await call('/v1/notes', 'GET', 'one')).json()) as { notes: unknown[] }).notes).toEqual([]);
    expect(((await (await call('/v1/state', 'GET', 'two')).json()) as Record<string, unknown>).notes).toBeUndefined();
    expect(((await (await call('/v1/onboarding', 'GET', 'two')).json()) as { hasContent: boolean }).hasContent).toBe(
      true,
    );
    expect(((await (await call('/v1/export', 'GET', 'two')).json()) as { notes: unknown[] }).notes).toEqual([note]);
    expect((await store.brief(db, other)).notes).toMatchObject({ count: 1, latest_date: '2026-10-12' });
  });
  it('uses atomic revisions and tombstones; concurrent edits never silently overwrite', async () => {
    const responses = await Promise.all(
      ['A', 'B'].map(text => call('/v1/notes/2026-10-12', 'PUT', 'two', { text, revision: 1 })),
    );
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await call('/v1/notes/2026-10-12', 'PUT', 'two', { text: '', revision: 2 })).status).toBe(200);
    expect((await call('/v1/notes/2026-10-12', 'PUT', 'two', { text: 'stale resurrection', revision: 0 })).status).toBe(
      409,
    );
    expect(await (await call('/v1/notes/2026-10-12', 'GET', 'two')).json()).toMatchObject({ text: '', revision: 3 });
    expect(((await (await call('/v1/notes', 'GET', 'two')).json()) as { notes: unknown[] }).notes).toEqual([]);
  });
  it('paginates full original text by date range with exclusive cursors', async () => {
    for (let day = 1; day <= 4; day++)
      await call('/v1/notes/2026-09-0' + day, 'PUT', 'two', { text: 'day ' + day, revision: 0 });
    const page = (await (await call('/v1/notes?from=2026-09-02&to=2026-09-04&limit=2', 'GET', 'two')).json()) as {
      notes: { date: string }[];
      next_cursor: string;
    };
    expect(page.notes.map(n => n.date)).toEqual(['2026-09-04', '2026-09-03']);
    expect(page.next_cursor).toBe('2026-09-03');
    const end = (await (
      await call('/v1/notes?from=2026-09-02&to=2026-09-04&limit=2&before=' + page.next_cursor, 'GET', 'two')
    ).json()) as { notes: { date: string }[]; next_cursor: null };
    expect(end.notes.map(n => n.date)).toEqual(['2026-09-02']);
    expect(end.next_cursor).toBeNull();
  });
  it('rejects invalid dates, oversized Unicode, cross-origin and wrong-account writes', async () => {
    for (const [date, body] of [
      ['2026-02-30', { text: 'x', revision: 0 }],
      ['2026-10-15', { text: '🙂'.repeat(20001), revision: 0 }],
      ['2026-10-15', { text: 'x', revision: -1 }],
    ] as const)
      expect((await call('/v1/notes/' + date, 'PUT', 'one', body)).status).toBe(400);
    expect(
      (
        await call(
          '/v1/notes/2026-10-15',
          'PUT',
          'one',
          { text: 'x', revision: 0 },
          { Origin: 'https://foreign.invalid' },
        )
      ).status,
    ).toBe(403);
    expect(
      (await call('/v1/notes/2026-10-15', 'PUT', 'one', { text: 'x', revision: 0 }, { 'X-Lowkkey-Account': other }))
        .status,
    ).toBe(409);
    expect((await call('/v1/notes?from=2026-10-15&to=2026-01-01')).status).toBe(400);
    expect((await call('/v1/notes?limit=31')).status).toBe(400);
    expect((await call('/v1/notes/2026-10-15', 'PUT', 'one', { text: '🙂'.repeat(20000), revision: 0 })).status).toBe(
      200,
    );
  });
});

describe('MCP note writing with separate consent', () => {
  const rpc = async (scopes: string[], name: string, args: unknown, who = owner) => {
    const response = await mcpResponse(
      new Request(origin + '/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      }),
      db,
      { ownerId: who, clientId: 'test-notes', scopes },
    );
    return (
      (
        (await response.json()) as {
          result: { isError?: boolean; structuredContent: { result: Record<string, unknown>; view_url?: string } };
        }
      ).result ?? { isError: true, structuredContent: { result: {} } }
    );
  };
  it('rejects legacy writes, isolates owners, and shares web revisions', async () => {
    const args = { date: '2026-08-01', text: '  转录原话\n🙂  ', revision: 0 };
    for (const scopes of [['read'], ['read', 'write'], ['notes:write']])
      expect((await rpc(scopes, 'write_note', args)).isError).toBe(true);
    const saved = await rpc(['read', 'notes:write'], 'write_note', args);
    expect(saved.isError).not.toBe(true);
    expect(saved.structuredContent.view_url).toBe(origin + '/#notes?date=' + args.date);
    expect(await (await call('/v1/notes/' + args.date)).json()).toMatchObject({ text: args.text, revision: 1 });
    expect((await rpc(['read'], 'read_notes', { date: args.date }, other)).structuredContent.result).toMatchObject({
      notes: [{ text: '', revision: 0 }],
    });
    await call('/v1/notes/' + args.date, 'PUT', 'one', { text: '手机编辑', revision: 1 });
    const stale = await rpc(['read', 'notes:write'], 'write_note', { ...args, text: '过时转录', revision: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent.result.error).toMatchObject({ code: 'note_conflict' });
    expect((await rpc(['read'], 'read_notes', { date: args.date, limit: 1 })).isError).toBe(true);
    expect(
      (await rpc(['read', 'notes:write'], 'write_note', { date: args.date, text: '🙂'.repeat(20001), revision: 2 }))
        .isError,
    ).toBe(true);
    expect(await (await call('/v1/notes/' + args.date)).json()).toMatchObject({ text: '手机编辑', revision: 2 });
  });
});
