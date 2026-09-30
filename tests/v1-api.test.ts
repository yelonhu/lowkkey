import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile, rm } from 'node:fs/promises';
import type { D1Database } from '@cloudflare/workers-types';
import { createApi } from '../src/server/api.ts';
import type { Bindings } from '../src/server/api.ts';
import { submitModelEntries } from '../src/server/v1-store.ts';

const directory=`.data/test-v1/${crypto.randomUUID()}`;
let runtime:Miniflare,db:D1Database;
const app=createApi({verifyIdentity:async request=>({issuer:'test',subject:request.headers.get('X-Test-User')??'a',email:'test@example.invalid'})});
const env=()=>({DB:db,APP_ENV:'test',APP_ORIGIN:'http://127.0.0.1:5173'}) satisfies Bindings;
async function call(path:string,user='a',method:'GET'|'POST'|'PUT'='GET',body?:unknown,key=crypto.randomUUID()){
  const request=new Request(`http://127.0.0.1:5173${path}`,{method,headers:{'X-Test-User':user,...(body===undefined?{}:{'Content-Type':'application/json','Origin':'http://127.0.0.1:5173','Idempotency-Key':key})},body:body===undefined?undefined:JSON.stringify(body)});
  const response=await app.fetch(request,env());return {status:response.status,body:await response.json()};
}
const clock={capturedAt:'2030-03-14T12:00:00.000Z',capturedLocalDate:'2030-03-14',timeZone:'America/Chicago'};
beforeAll(async()=>{
  runtime=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-30',cf:false,host:'127.0.0.1',d1Databases:{DB:'11111111-1111-4111-8111-111111111111'},d1Persist:`${directory}/d1`,outboundService:()=>{throw new Error('no outbound');}});
  db=await runtime.getD1Database('DB') as D1Database;
  for(const name of ['0000_state.sql','0001_handoff_v1.sql','0002_oauth_batch.sql']){
    const sql=await readFile(`db/migrations/${name}`,'utf8');
    await db.batch(sql.split('--> statement-breakpoint').map(part=>part.trim()).filter(Boolean).map(part=>db.prepare(part)));
  }
});
afterAll(async()=>{await runtime?.dispose();await rm(directory,{recursive:true,force:true});});

describe('v1 REST and atomic model review',()=>{
  it('anchors relative dates to the original capture and replays identical requests',async()=>{
    const key=crypto.randomUUID(),input={text:'昨天体重 60kg',...clock};
    const first=await call('/v1/capture','a','POST',input,key);expect(first.status).toBe(200);
    expect(first.body.committed[0].date).toBe('2030-03-13');
    expect((await call('/v1/capture','a','POST',input,key)).body).toEqual(first.body);
    expect((await call('/v1/capture','a','POST',{...input,text:'昨天体重 61kg'},key)).status).toBe(409);
    expect((await call('/v1/capture','a','POST',{...input,capturedLocalDate:'2030-03-15'})).status).toBe(400);
  });
  it('keeps an explicit account timezone when a capture came from another device zone',async()=>{
    expect((await call('/v1/preferences/timezone','zone','PUT',{timeZone:'UTC'})).status).toBe(200);
    const result=await call('/v1/capture','zone','POST',{text:'昨天体重 60kg',...clock});
    expect(result.status).toBe(200);
    expect(result.body.committed[0].date).toBe('2030-03-13');
    expect((await call('/v1/state','zone')).body.timezone).toBe('UTC');
  });
  it('isolates users and appends a revert once',async()=>{
    const own=(await call('/v1/state','a')).body,entry=own.entries[0];
    expect((await call(`/v1/entries/${entry.id}/revert`,'b','POST',{})).status).toBe(404);
    expect((await call('/v1/state','b')).body.entries).toHaveLength(0);
    expect((await call(`/v1/entries/${entry.id}/revert`,'a','POST',{})).status).toBe(200);
    expect((await call(`/v1/entries/${entry.id}/revert`,'a','POST',{})).status).toBe(409);
    await expect(db.prepare('UPDATE v1_entries SET kind=? WHERE id=?').bind('note',entry.id).run()).rejects.toThrow();
    await expect(db.prepare('DELETE FROM v1_entries WHERE id=?').bind(entry.id).run()).rejects.toThrow();
  });
  it('keeps five model drafts out of the ledger until one atomic user decision',async()=>{
    const before=(await call('/v1/state','a')).body;
    const drafts=Array.from({length:5},(_,index)=>({kind:'note' as const,date:clock.capturedLocalDate,dateOrigin:'device' as const,source:{actor:'model' as const,channel:'mcp' as const,client:'model'},text:`批次备注 ${index}`,confidence:0.99}));
    const batch=await submitModelEntries(db,before.accountId,'model',crypto.randomUUID(),'五条备注',drafts,clock);
    expect((await call('/v1/state','a')).body.entries).toHaveLength(before.entries.length);
    const review=(await call('/v1/state','a')).body;
    const stale=review.revision;
    await call('/v1/preferences/timezone','a','PUT',{timeZone:'America/Chicago'});
    expect((await call(`/v1/submissions/${batch.id}/decision`,'a','POST',{decision:'accept',answers:{},expectedRevision:stale})).status).toBe(409);
    expect((await call('/v1/state','a')).body.entries).toHaveLength(before.entries.length);
    const current=(await call('/v1/state','a')).body;
    const key=crypto.randomUUID(),body={decision:'accept',answers:{},expectedRevision:current.revision};
    const accepted=await call(`/v1/submissions/${batch.id}/decision`,'a','POST',body,key);
    expect(accepted.status).toBe(200);expect(accepted.body.committed).toHaveLength(5);
    expect((await call(`/v1/submissions/${batch.id}/decision`,'a','POST',body,key)).body).toEqual(accepted.body);
    expect((await call('/v1/state','a')).body.entries).toHaveLength(before.entries.length+5);
  });
  it('reviews successive gates before committing a model batch',async()=>{
    const seed=await call('/v1/capture','chain','POST',{text:'昨天体重 70kg',...clock});
    expect(seed.status).toBe(200);
    const before=(await call('/v1/state','chain')).body;
    const draft={kind:'weight' as const,kg:74,raw:{value:74,unit:'kg' as const},condition:'unspecified' as const,date:'2030-03-13',dateOrigin:'inferred' as const,source:{actor:'model' as const,channel:'mcp' as const,client:'model'},confidence:0.5};
    const batch=await submitModelEntries(db,before.accountId,'model',crypto.randomUUID(),'体重 74kg',[draft],clock);
    const path=`/v1/submissions/${batch.id}`;
    let answers:Record<string,string>={};
    for(const [expected,option] of [['G5','yes'],['G2','inferred'],['G3','replace'],['G4','yes']] as const){
      const preview=await call(`${path}/review`,'chain','POST',{answers});
      expect(preview.status).toBe(200);
      expect(preview.body.questions[0].gate).toBe(expected);
      answers={...answers,[preview.body.questions[0].id]:option};
      expect((await call('/v1/state','chain')).body.entries).toHaveLength(1);
    }
    const ready=await call(`${path}/review`,'chain','POST',{answers});expect(ready.body.ready).toBe(true);
    const accepted=await call(`${path}/decision`,'chain','POST',{decision:'accept',answers,expectedRevision:ready.body.revision});
    expect(accepted.status).toBe(200);
    expect(accepted.body.committed.map((entry:{kind:string})=>entry.kind)).toEqual(['revert','weight']);
  });
  it('lets only one concurrent decision commit a pending batch',async()=>{
    const before=(await call('/v1/state','race')).body;
    const draft={kind:'note' as const,date:clock.capturedLocalDate,dateOrigin:'device' as const,source:{actor:'model' as const,channel:'mcp' as const,client:'model'},text:'并发确认',confidence:0.99};
    const batch=await submitModelEntries(db,before.accountId,'model',crypto.randomUUID(),'并发确认',[draft],clock);
    const review=(await call('/v1/state','race')).body;
    const body={decision:'accept',answers:{},expectedRevision:review.revision};
    const [first,second]=await Promise.all([call(`/v1/submissions/${batch.id}/decision`,'race','POST',body),call(`/v1/submissions/${batch.id}/decision`,'race','POST',body)]);
    expect([first.status,second.status].sort()).toEqual([200,409]);
    expect((await call('/v1/state','race')).body.entries).toHaveLength(1);
  });
  it('restricts backup import to the owner and to an append-only superset',async()=>{
    const backup=(await call('/v1/export','a')).body;
    expect(backup.format).toBe('lowkkey.v1');
    expect((await call('/v1/import','b','POST',backup)).status).toBe(403);
    expect((await call('/v1/import','a','POST',{...backup,snapshot:{...backup.snapshot,entries:[]}})).status).toBe(409);
    expect((await call('/v1/import','a','POST',backup)).body.imported).toBe(0);
  });
  it('streams only the owner events after the requested cursor',async()=>{
    const cursor=(await call('/v1/state','a')).body.eventCursor;
    const entry=(text:string)=>({entries:[{kind:'note',date:clock.capturedLocalDate,dateOrigin:'device',source:{actor:'user',channel:'ui',client:'web'},text}]});
    const other=await call('/v1/entries','b','POST',entry('other event'));
    const own=await call('/v1/entries','a','POST',entry('owner event'));
    expect(other.status).toBe(200);expect(own.status).toBe(200);
    const response=await app.fetch(new Request(`http://127.0.0.1:5173/v1/events?after=${cursor}`,{headers:{'X-Test-User':'a'}}),env());
    expect(response.status).toBe(200);
    const reader=response.body!.getReader();
    const first=await reader.read();await reader.cancel();
    const message=new TextDecoder().decode(first.value);
    expect(message).toContain(own.body.committed[0].id);
    expect(message).not.toContain(other.body.committed[0].id);
  });
});

describe('user-owned macro decisions',()=>{
  it('reserves one slot across devices, snoozes, and rejects stale or duplicate decisions',async()=>{
    const user='macro',proposal=(title:string)=>({kind:'program_change',title,rationale:'调整后的安排由用户确认',patch:{cycleStart:'2030-04-01'},ruleRefs:['V6']});
    const first=await call('/v1/proposals',user,'POST',proposal('第一个建议'));expect(first.status).toBe(200);
    await call('/v1/proposals',user,'POST',proposal('第二个建议'));
    const [a,b]=await Promise.all([call('/v1/decisions/today',user,'POST',{}),call('/v1/decisions/today',user,'POST',{})]);
    expect(a.status).toBe(200);expect(b.status).toBe(200);
    let state=(await call('/v1/state',user)).body;expect(state.decisionSlots[state.today].id).toBe(first.body.id);
    const stale=state.revision;await call('/v1/preferences/timezone',user,'PUT',{timeZone:'UTC'});
    expect((await call(`/v1/proposals/${first.body.id}/decision`,user,'POST',{decision:'accept',expectedRevision:stale})).status).toBe(409);
    state=(await call('/v1/state',user)).body;
    const key=crypto.randomUUID(),body={decision:'later',expectedRevision:state.revision};
    const later=await call(`/v1/proposals/${first.body.id}/decision`,user,'POST',body,key);expect(later.status).toBe(200);
    expect((await call(`/v1/proposals/${first.body.id}/decision`,user,'POST',body,key)).body).toEqual(later.body);
    await call('/v1/decisions/today',user,'POST',{});state=(await call('/v1/state',user)).body;
    expect(state.program.cycleStart).toBeNull();expect(state.decisionSlots[state.today]).toMatchObject({id:first.body.id,closed:true});
    expect((await call(`/v1/proposals/${first.body.id}/decision`,'other-macro','POST',{decision:'accept',expectedRevision:0})).status).not.toBe(200);
    const accepted=await call(`/v1/proposals/${first.body.id}/decision`,user,'POST',{decision:'accept',expectedRevision:state.revision});expect(accepted.status).toBe(200);
    const after=(await call('/v1/state',user)).body;
    expect((await call(`/v1/proposals/${first.body.id}/decision`,user,'POST',{decision:'accept',expectedRevision:after.revision})).status).toBe(409);
  });
  it('rejects unrecognized model patch fields even when their value is null',async()=>{
    const proposal={kind:'program_change',title:'Invalid',rationale:'',patch:{targets:{unexpected:null}},ruleRefs:[]};
    expect((await call('/v1/proposals','patch','POST',proposal)).status).toBe(403);
    expect((await call('/v1/state','patch')).body.proposals).toHaveLength(0);
  });
  it('keeps set corrections append-only and scoped to the owner',async()=>{
    const user='role';const result=await call('/v1/entries',user,'POST',{entries:[{kind:'set',sessionId:'role-session',exerciseId:'bench_press',setIndex:1,load:100,unit:'lb',loadKind:'external',reps:8,rir:2,date:clock.capturedLocalDate,dateOrigin:'explicit',source:{actor:'user',channel:'ui'}}]});
    expect(result.status).toBe(200);const original=result.body.committed[0];
    const correction={entries:[{kind:'set_annotation',targetId:original.id,setRole:'warmup',date:clock.capturedLocalDate,dateOrigin:'explicit',source:{actor:'user',channel:'ui'}}]};
    expect((await call('/v1/entries','other-role','POST',correction)).status).toBe(404);
    expect((await call('/v1/entries',user,'POST',correction)).status).toBe(200);
    const state=(await call('/v1/state',user)).body;expect(state.entries.find((e:{id:string})=>e.id===original.id)).toEqual(original);expect(state.entries).toHaveLength(2);
  });
});
