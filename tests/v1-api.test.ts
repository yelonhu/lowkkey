import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile, rm } from 'node:fs/promises';
import type { D1Database } from '@cloudflare/workers-types';
import { createApi } from '../src/server/api.ts';
import { accountFor } from '../src/server/account.ts';
import * as store from '../src/server/store.ts';

const directory = '.data/showroom-api-test/' + crypto.randomUUID(), origin = 'http://127.0.0.1:5371';
let mf: Miniflare, db: D1Database, owner: string, other: string;
const app = createApi({verifyIdentity: async request => ({issuer:'test',subject:request.headers.get('X-Test-User') ?? 'one',email:'test@example.com'})});
beforeAll(async () => {
  mf = new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-30',cf:false,host:'127.0.0.1',d1Databases:{DB:'showroom-test'},d1Persist:directory,outboundService:()=>{throw new Error('No outbound');}});
  db = await mf.getD1Database('DB') as D1Database;
  const sql = await readFile('db/showroom-migrations/0000_schema.sql','utf8');
  await db.batch(sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
  owner = await accountFor(db,{issuer:'test',subject:'one',email:'test@example.com'});
  other = await accountFor(db,{issuer:'test',subject:'two',email:'test@example.com'});
});
afterAll(async()=>{await mf?.dispose();await rm(directory,{recursive:true,force:true});});
const call = (path:string, method='GET', user='one', body?:unknown, extra:Record<string,string>={}) => app.fetch(new Request(origin+path,{method,headers:{Origin:origin,'X-Test-User':user,'Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)}),{DB:db,APP_ENV:'test',APP_ORIGIN:origin});
const set = {exerciseId:'bench_press',load:100,unit:'lb',loadKind:'external',reps:6};

describe('three-fact store and read-only showroom API', () => {
  it('starts empty with no legacy domain tables', async () => {
    expect((await store.state(db,owner)).sessions).toEqual([]);
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{name:string}>();
    expect(tables.results.map(row=>row.name)).toEqual(expect.arrayContaining(['training_sessions','weights','plans']));
    expect(tables.results.some(row=>['entries','v1_entries','held_items','v1_state','v1_submissions','v1_events'].includes(row.name))).toBe(false);
  });
  it('preserves original whitespace and atomically replaces an entire day', async () => {
    const raw = '  original\n100 lb × 6\n<script>literal text</script>  ';
    const input = {date:'2026-10-08',raw_text:raw,sets:[set,set]};
    const first = await store.logSession(db,owner,input);
    expect(first.raw_text).toBe(raw);
    expect(await store.logSession(db,owner,input)).toEqual(first);
    await store.logSession(db,owner,{...input,raw_text:'corrected',sets:[{...set,reps:8}]});
    const state = await store.state(db,owner);
    expect(state.sessions).toHaveLength(1); expect(state.sessions[0].sets).toHaveLength(1);
    expect(state.sessions[0].raw_text).toBe('corrected');
  });
  it('rejects invalid writes without partial changes', async () => {
    await expect(store.logSession(db,owner,{date:'2026-10-08',raw_text:'broken',sets:[set,{...set,unit:'stone'}]})).rejects.toThrow();
    expect((await store.state(db,owner)).sessions[0].raw_text).toBe('corrected');
    await expect(store.logWeight(db,owner,{date:'2026-02-30',lb:160})).rejects.toThrow();
    await expect(store.logWeight(db,owner,{date:'2026-10-08',lb:-1})).rejects.toThrow();
  });
  it('upserts weights once and computes the brief from the saved facts', async () => {
    const first = await store.logWeight(db,owner,{date:'2026-10-02',lb:160});
    expect(await store.logWeight(db,owner,{date:'2026-10-02',lb:160})).toEqual(first);
    await store.logWeight(db,owner,{date:'2026-10-08',lb:164});
    await store.logWeight(db,owner,{date:'2026-10-08',lb:166});
    const brief = await store.brief(db,owner);
    expect((await store.state(db,owner)).weights).toHaveLength(2);
    expect(brief.weight_mean_7d).toEqual({date:'2026-10-08',lb:163,samples:2});
    expect(brief.strength[0].latest?.lb).toBeCloseTo(126.6666667);
  });
  it('merges omitted notes without reviving older context across days', async () => {
    const target = {start_date:'2026-10-01',start_lb:160,weekly_lb_min:.25,weekly_lb_max:.5};
    await store.setPlan(db,owner,{day:'A',items:[],notes:{body:'first',gain_target:target,coach:'keep'}});
    await store.setPlan(db,owner,{day:'B',items:[],notes:{body:'second',gain_target:null}});
    await store.setPlan(db,owner,{day:'A',items:[],notes:{coach:'updated'}});
    let brief = await store.brief(db,owner);
    expect(brief.body_notes).toBe('second'); expect(brief.gain_target).toBeNull();
    await store.setPlan(db,owner,{day:'A',items:[],notes:{body:null}});
    brief = await store.brief(db,owner);
    expect(brief.body_notes).toBeNull(); expect(brief.plans.find(p=>p.day==='A')?.notes.coach).toBe('updated');
    const bad = {day:'A',items:[{...set,sets:3,repMin:10,repMax:6}],notes:{body:'bad'}};
    await expect(store.setPlan(db,owner,bad)).rejects.toThrow();
    expect((await store.brief(db,owner)).body_notes).toBeNull();
  });
  it('does not lose context when concurrent updates omit different fields', async () => {
    await Promise.all([
      store.setPlan(db,owner,{day:'concurrent',items:[],notes:{body:'concurrent body'}}),
      store.setPlan(db,owner,{day:'concurrent',items:[],notes:{coach:'concurrent coach'}}),
    ]);
    const plan = (await store.state(db,owner)).plans.find(p=>p.day==='concurrent')!;
    expect(plan.notes).toMatchObject({body:'concurrent body',coach:'concurrent coach'});
  });
  it('isolates every fact and authorization by account', async () => {
    expect((await store.state(db,other)).sessions).toEqual([]);
    await store.logWeight(db,other,{date:'2026-10-08',lb:200});
    expect((await store.brief(db,owner)).latest_weight?.lb).toBe(166);
    await store.registerOAuthClient(db,owner,'oauth-id','test',['read','write'],'client');
    await expect(store.revokeClient(db,other,'client')).rejects.toThrow('not_found');
    await expect(store.registerOAuthClient(db,owner,'old','old',['submit'],'old')).rejects.toThrow('invalid_scope');
  });
  it('serves facts, export and client revocation but removes every former business write', async () => {
    expect((await call('/v1/state')).status).toBe(200);
    const exported = await (await call('/v1/export')).json() as {format:string};
    expect(exported.format).toBe('lowkkey.showroom.v1');
    for (const path of ['/v1/capture','/v1/entries','/v1/program','/v1/submissions/x/decision','/v1/proposals']) expect((await call(path,'POST','one',{})).status).toBe(404);
    expect((await call('/v1/events')).status).toBe(404);
    expect((await call('/v1/clients/client/revoke','POST','one',{}, {'X-Lowkkey-Account':other})).status).toBe(409);
    expect((await call('/v1/clients/client/revoke','POST','one',{}, {Origin:'https://foreign.invalid'})).status).toBe(403);
    expect((await call('/v1/clients/client/revoke','POST','one',{})).status).toBe(200);
    expect((await store.oauthClient(db,owner,'client'))?.status).toBe('revoked');
  });
});
