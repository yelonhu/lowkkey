import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile, readdir, rm } from 'node:fs/promises';
import type { D1Database } from '@cloudflare/workers-types';
import { accountFor } from '../src/server/account.ts';
import * as life from '../src/server/lifecycle.ts';
import * as store from '../src/server/store.ts';
import { mcpResponse } from '../src/server/mcp.ts';
import { localToday } from '@lowkkey/core';
import { Brief, OnboardingState, MCP_INSTRUCTIONS } from '@lowkkey/protocol';
import type { Notice } from '../src/server/push.ts';
const directory = '.data/product-test/' + crypto.randomUUID();
let mf: Miniflare, db: D1Database, owner: string, other: string;
const stamp = new Date('2026-10-12T01:30:00Z');
const notices: Notice[] = [];
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-07-30',
    cf: false,
    host: '127.0.0.1',
    d1Databases: { DB: 'product' },
    d1Persist: directory,
    outboundService: () => {
      throw new Error('No outbound');
    },
  });
  db = (await mf.getD1Database('DB')) as D1Database;
  for (const name of (await readdir('db/showroom-migrations')).filter(n => n.endsWith('.sql')).sort())
    await db.batch(
      (await readFile('db/showroom-migrations/' + name, 'utf8'))
        .split('--> statement-breakpoint')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => db.prepare(s)),
    );
  owner = await accountFor(db, { issuer: 'product', subject: 'one', email: 'one@example.com' });
  other = await accountFor(db, { issuer: 'product', subject: 'two', email: 'two@example.com' });
  await store.registerOAuthClient(db, owner, 'test', 'Test AI', ['read', 'write'], 'client');
});
afterAll(async () => {
  await mf?.dispose();
  await rm(directory, { recursive: true, force: true });
});
async function rpc(method: string, params: unknown, scopes = ['read', 'write']) {
  const response = await mcpResponse(
    new Request('https://lowkkey.test/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    db,
    { ownerId: owner, clientId: 'client', scopes },
    notice => notices.push(notice),
  );
  return (await response.json()) as {
    result: {
      isError?: boolean;
      instructions?: string;
      tools?: { name: string }[];
      structuredContent: { result: unknown };
    };
  };
}
describe('product onboarding and continuity', () => {
  it('persists owner-specific choices and uses first-browser timezone only once', async () => {
    await life.updateOnboarding(db, owner, { ai: 'chatgpt', entry: 'existing', skipped: true });
    expect(await life.onboarding(db, other)).toMatchObject({
      ai: null,
      entry: null,
      skippedAt: null,
      hasContent: false,
    });
    expect(await life.onboarding(db, owner)).toMatchObject({
      ai: 'chatgpt',
      entry: 'existing',
      skippedAt: expect.any(String),
    });
    await life.preferences(db, owner, { timezone: 'Asia/Shanghai', initialize: true });
    await life.preferences(db, owner, { timezone: 'America/New_York', initialize: true });
    expect((await store.state(db, owner, stamp)).timezone).toBe('Asia/Shanghai');
    expect((await store.state(db, owner, stamp)).today).toBe('2026-10-12');
    expect((await store.state(db, other, stamp)).today).toBe('2026-10-11');
    await expect(life.preferences(db, owner, { timezone: 'made/up' })).rejects.toThrow();
  });
  it('handles midnight, week boundary and DST with one timezone source', async () => {
    for (const date of [
      '2026-03-08T07:59:00Z',
      '2026-03-08T08:01:00Z',
      '2026-11-01T06:59:00Z',
      '2026-11-01T07:01:00Z',
    ]) {
      await life.preferences(db, owner, { timezone: 'America/Chicago' });
      const state = await store.state(db, owner, new Date(date)),
        brief = await store.brief(db, owner, {}, new Date(date));
      expect(brief.today.date).toBe(state.today);
      expect(state.today).toBe(localToday(new Date(date), 'America/Chicago'));
    }
    expect(localToday(stamp, 'America/Chicago')).toBe('2026-10-11');
    expect(localToday(stamp, 'Asia/Shanghai')).toBe('2026-10-12');
  });
  it('authorization and discovery never masquerade as a successful read', async () => {
    const init = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.result.instructions).toBe(MCP_INSTRUCTIONS);
    expect(init.result).toMatchObject({
      serverInfo: {
        name: 'lowkkey',
        title: 'lowkkey',
        websiteUrl: 'https://lowkkey.test',
        icons: [{ src: 'https://lowkkey.test/icon-512.png', mimeType: 'image/png', sizes: ['512x512'] }],
      },
    });
    expect((await rpc('tools/list', {})).result.tools).toHaveLength(10);
    expect((await life.onboarding(db, owner)).clients[0].firstReadAt).toBeNull();
    const brief = await rpc('tools/call', { name: 'get_brief', arguments: {} });
    expect(Brief.parse(brief.result.structuredContent.result).onboarding?.entry).toBe('existing');
    expect((await life.onboarding(db, owner)).clients[0].firstReadAt).toBeTruthy();
    expect((await life.onboarding(db, owner)).completedAt).toBeNull();
  });
  it('keeps concurrent MCP discovery isolated by permission when metadata is shared', async () => {
    const scopes = [['read'], ['read', 'write'], ['read', 'write', 'notes:write'], ['notes:write']];
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const granted = scopes[i % scopes.length];
        const init = await rpc(
          'initialize',
          { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'concurrent-test', version: '1' } },
          granted,
        );
        expect(init.result.instructions).toBe(MCP_INSTRUCTIONS);
        return (await rpc('tools/list', {}, granted)).result.tools!.map(tool => tool.name);
      }),
    );
    for (let i = 0; i < results.length; i++) {
      expect(results[i]).toHaveLength([2, 10, 11, 0][i % 4]);
      expect(results[i].includes('write_note')).toBe(i % 4 === 2);
      if (i % 4 === 0) expect(results[i]).toEqual(['get_brief', 'read_notes']);
    }
  });
  it('awards medals the AI writes, lists them in state and brief, and deletes by key', async () => {
    const owner = await accountFor(db, { issuer: 'product', subject: 'medals', email: 'medals@example.com' });
    const medal = {
      key: 'first-plate',
      date: '2026-10-08',
      name: '一片冰心',
      motif: '135',
      unit: 'lb',
      occasion: '深蹲第一次挂上一片',
      story: ['她把片挂上去的时候，没有人看。'],
    };
    const saved = await store.award(db, owner, medal, stamp);
    expect(saved).toMatchObject(medal);
    expect(await store.award(db, owner, medal, new Date('2026-10-09T00:00:00Z'))).toEqual(saved);
    await expect(store.award(db, owner, { ...medal, key: 'Bad Key' })).rejects.toThrow();
    await expect(store.award(db, owner, { ...medal, key: 'later', date: '2027-01-01' }, stamp)).rejects.toThrow(
      'invalid_arguments',
    );
    const waiting = await store.award(db, owner, { ...medal, key: 'bodyweight', date: null, name: '举起自己' }, stamp);
    expect(waiting.date).toBeNull();
    // The AI draws the picture: path data on a 100×100 canvas, kept verbatim; a medal needs a drawing or a motif.
    const drawn = {
      ...medal,
      key: 'cat',
      name: '予爱',
      motif: undefined,
      drawing: { d: 'M20 20 L80 80 M80 20 L20 80' },
    };
    expect((await store.award(db, owner, drawn, stamp)).drawing).toEqual({
      d: 'M20 20 L80 80 M80 20 L20 80',
      style: 'line',
    });
    await expect(store.award(db, owner, { ...drawn, drawing: { d: '<svg>' } })).rejects.toThrow();
    await expect(store.award(db, owner, { ...drawn, drawing: undefined })).rejects.toThrow();
    expect((await store.state(db, owner, stamp)).medals.find(m => m.key === 'cat')).toMatchObject({
      drawing: { d: 'M20 20 L80 80 M80 20 L20 80', style: 'line' },
    });
    expect((await store.brief(db, owner, {}, stamp)).medals?.find(m => m.key === 'cat')).not.toHaveProperty('story');
    await store.deleteFact(db, owner, { kind: 'medal', key: 'cat' });
    expect((await store.state(db, owner, stamp)).medals.map(m => m.key)).toEqual(['bodyweight', 'first-plate']);
    expect((await store.brief(db, owner, {}, stamp)).medals?.map(m => m.name)).toEqual(['举起自己', '一片冰心']);
    expect(await store.deleteFact(db, owner, { kind: 'medal', key: 'bodyweight' })).toMatchObject({
      kind: 'medal',
      key: 'bodyweight',
    });
    await expect(store.deleteFact(db, owner, { kind: 'medal', key: 'bodyweight' })).rejects.toThrow('not_found');
    await expect(store.deleteFact(db, owner, { kind: 'medal' })).rejects.toThrow();
    expect((await store.state(db, owner, stamp)).medals).toHaveLength(1);
  });
  it('keeps dated everyday context until it expires and deletes it by date', async () => {
    const owner = await accountFor(db, { issuer: 'product', subject: 'contexts', email: 'contexts@example.com' });
    const week = { date: '2026-10-06', until: '2026-10-12', text: '考试周，晚上只有一小时能练。' };
    const saved = await store.logContext(db, owner, week, stamp);
    expect(saved).toMatchObject(week);
    expect(await store.logContext(db, owner, week, new Date('2026-10-09T00:00:00Z'))).toEqual(saved);
    expect((await store.logContext(db, owner, { date: '2026-10-01', text: '一夜没睡好。' }, stamp)).until).toBe(
      '2026-10-01',
    );
    await expect(store.logContext(db, owner, { ...week, until: '2026-10-05' })).rejects.toThrow();
    await expect(store.logContext(db, owner, { ...week, until: '2027-02-01' })).rejects.toThrow();
    await expect(store.logContext(db, owner, { ...week, text: '太兴奋了！' })).rejects.toThrow();
    expect((await store.state(db, owner, stamp)).contexts.map(c => c.date)).toEqual(['2026-10-01', '2026-10-06']);
    expect((await store.brief(db, owner, {}, stamp)).contexts?.map(c => c.date)).toEqual(['2026-10-06']);
    expect(await store.deleteFact(db, owner, { kind: 'context', date: '2026-10-06' })).toMatchObject({
      kind: 'context',
      date: '2026-10-06',
      deleted: saved,
    });
    await expect(store.deleteFact(db, owner, { kind: 'context', date: '2026-10-06' })).rejects.toThrow('not_found');
    await expect(store.deleteFact(db, owner, { kind: 'context' })).rejects.toThrow();
    expect((await store.brief(db, owner, {}, stamp)).contexts).toEqual([]);
  });
  it('failed calls and profile writes do not complete first-content onboarding', async () => {
    expect(
      (await rpc('tools/call', { name: 'log_weight', arguments: { date: '2026-10-12', lb: -5 } })).result.isError,
    ).toBe(true);
    expect((await life.onboarding(db, owner)).clients[0].firstWriteAt).toBeNull();
    await rpc('tools/call', { name: 'set_profile', arguments: { body_notes: 'Existing note' } });
    expect((await life.onboarding(db, owner)).completedAt).toBeNull();
    await rpc('tools/call', { name: 'set_plan', arguments: { title: 'Empty', weekday: 1, items: [] } });
    expect((await life.onboarding(db, owner)).completedAt).toBeNull();
  });
  it('returns full original sets by date, including warmups, and preserves the first receipt', async () => {
    const input = {
      date: '2026-10-08',
      title: '胸',
      note: '原话',
      sets: [
        { ex: 'bench_press', load: 45, unit: 'lb', kind: 'external', reps: 10, role: 'warmup' },
        { ex: 'bench_press', load: 95, unit: 'lb', kind: 'external', reps: 8, cheat: 1, rir: 2 },
      ],
    };
    await rpc('tools/call', { name: 'log_session', arguments: input });
    const setup = OnboardingState.parse(await life.onboarding(db, owner));
    expect(setup.completedAt).toBeTruthy();
    expect(setup.firstViewUrl).toBe('https://lowkkey.test/#log?date=2026-10-08');
    const brief = await store.brief(db, owner, { sessions: 0, session_date: input.date }, stamp);
    expect(brief.sessions).toHaveLength(0);
    expect(brief.session?.sets).toHaveLength(2);
    expect(brief.session?.sets[0].role).toBe('warmup');
    expect(brief.session?.note).toBe('原话');
    expect((await store.brief(db, other, { session_date: input.date }, stamp)).session).toBeNull();
    await rpc('tools/call', { name: 'log_weight', arguments: { date: input.date, lb: 140 } });
    expect((await life.onboarding(db, owner)).firstViewUrl).toBe(setup.firstViewUrl);
    await life.preferences(db, owner, { timezone: 'Asia/Shanghai' });
    expect((await store.brief(db, owner, { session_date: input.date }, stamp)).session?.date).toBe(input.date);
  });
  it('shows actual permissions and keeps read-only tool discovery honest', async () => {
    expect((await rpc('tools/list', {}, ['read'])).result.tools?.map(t => t.name)).toEqual(['get_brief', 'read_notes']);
    const brief = Brief.parse(
      (await rpc('tools/call', { name: 'get_brief', arguments: {} }, ['read'])).result.structuredContent.result,
    );
    expect(brief.permissions).toEqual(['read']);
    expect(brief.onboarding?.next_step).toContain('只读');
  });
  it('preserves training background on partial updates and allows all three AI themes', async () => {
    await store.setProfile(db, owner, { training_context: '每周两次；忙时缩短训练' });
    await store.setProfile(db, owner, { body_notes: '用户明确提供的备注' });
    expect((await store.brief(db, owner, {}, stamp)).profile.training_context).toBe('每周两次；忙时缩短训练');
    const week = '2026-10-12';
    for (const id of ['ink', 'gold']) {
      await store.curate(db, owner, { week, theme: { id, why: '用户希望本周用这个主题' } });
      expect((await store.state(db, owner, stamp)).theme_state.active).toBe(id);
    }
    await store.curate(db, owner, { week, theme: { id: 'ink', why: '回到水墨' } }, stamp);
    expect((await store.state(db, owner, stamp)).theme_state.active).toBe('ink');
    await store.setProfile(db, owner, { training_context: null });
    expect((await store.brief(db, owner, {}, stamp)).profile.training_context).toBeNull();
  });
  it('tells the device once when a letter is written or a medal is earned', async () => {
    notices.length = 0;
    const letter = { week: '2026-10-05', recap: { title: '稳稳地向前', letter: ['这周卧推完成得更稳。'] } };
    const written = await rpc('tools/call', { name: 'curate', arguments: letter });
    expect(written.result.isError).toBeFalsy();
    // Every write answers with the guide, so the keeper knows its next step without another read.
    expect((written.result.structuredContent as unknown as { guide: { stage: string } }).guide.stage).toBe('active');
    expect((await rpc('tools/call', { name: 'curate', arguments: letter })).result.isError).toBeFalsy();
    await rpc('tools/call', {
      name: 'curate',
      arguments: { week: '2026-10-05', body: { date: '2026-10-11', text: '慢慢来。' } },
    });
    expect(notices).toEqual([
      { kind: 'letter', title: '信到了', body: '稳稳地向前', url: 'https://lowkkey.test/#recap?week=2026-10-05' },
    ]);
    await rpc('tools/call', { name: 'curate', arguments: { ...letter, recap: { letter: ['改了一句。'] } } });
    expect(notices).toHaveLength(2);
    const medal = {
      key: 'first-light',
      date: null,
      name: '初光',
      motif: '初',
      occasion: '约定的一枚',
      story: ['一段。'],
    };
    await rpc('tools/call', { name: 'award', arguments: medal });
    expect(notices).toHaveLength(2);
    await rpc('tools/call', { name: 'award', arguments: { ...medal, date: '2026-10-10' } });
    await rpc('tools/call', { name: 'award', arguments: { ...medal, date: '2026-10-10', story: ['换一段。'] } });
    expect(notices.slice(2)).toEqual([
      {
        kind: 'medal',
        title: '一枚新的奖章',
        body: '初光 · 约定的一枚',
        url: 'https://lowkkey.test/#recap?medal=first-light',
      },
    ]);
  });
  it('blocks deletion immediately, retries cleanup, and preserves other owners', async () => {
    await db
      .prepare('INSERT INTO auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,0,0)')
      .bind('auth-one', 'One', 'one@example.com')
      .run();
    await db.prepare('INSERT INTO auth_owners VALUES (?,?)').bind('auth-one', owner).run();
    await db.prepare("UPDATE oauth_clients SET grant_id='grant' WHERE id='client'").run();
    await expect(life.beginDeletion(db, other, 'auth-one', 'one@example.com')).rejects.toThrow('account_mismatch');
    await life.beginDeletion(db, owner, 'auth-one', 'one@example.com');
    expect(await store.oauthClient(db, owner, 'client')).toBeNull();
    await expect(store.logWeight(db, owner, { date: '2026-10-12', lb: 150 })).rejects.toThrow('not_found');
    await life.cleanupDeletions(db, async () => {
      throw new Error('temporary failure');
    });
    expect(await db.prepare('SELECT * FROM account_deletions WHERE owner_id=?').bind(owner).first()).toBeTruthy();
    await life.cleanupDeletions(db, async () => {});
    await life.cleanupDeletions(db);
    expect(await db.prepare('SELECT * FROM users WHERE id=?').bind(owner).first()).toBeNull();
    expect(await db.prepare('SELECT * FROM auth_user WHERE id=?').bind('auth-one').first()).toBeNull();
    expect((await store.state(db, other)).accountId).toBe(other);
  });
});
