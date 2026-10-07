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
  for(const name of ['0000_state.sql','0001_handoff_v1.sql','0002_oauth_batch.sql','0003_customer_auth.sql']){
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


describe('AI plan and review contracts',()=>{
  it('stages custom exercises atomically and preserves existing load semantics',async()=>{
    const before=(await call('/v1/state','custom')).body;
    const exercise={...before.exercises[0],id:'personal_press',name:'个人器械推胸',aliases:[]};
    const days=[{id:'personal',name:'我的推胸日',weekday:2,items:[{exerciseId:exercise.id,sets:3,repMin:6,repMax:10}]}];
    const proposal=await call('/v1/proposals','custom','POST',{kind:'program_change',title:'我的计划',rationale:'已在对话里商定',ruleRefs:[],patch:{days},exercises:[exercise],expectedRevision:before.revision});
    expect(proposal.status,JSON.stringify(proposal.body)).toBe(200);
    const pending=(await call('/v1/state','custom')).body;expect(pending.exercises.some((ex:{id:string})=>ex.id===exercise.id)).toBe(false);
    const accepted=await call(`/v1/proposals/${proposal.body.id}/decision`,'custom','POST',{decision:'accept',expectedRevision:pending.revision});expect(accepted.status).toBe(200);
    const after=(await call('/v1/state','custom')).body;expect(after.program.days[0].items[0].exerciseId).toBe(exercise.id);expect(after.exercises).toContainEqual(exercise);
    expect((await call('/v1/proposals','custom','POST',{kind:'program_change',title:'旧状态',rationale:'',patch:{days:[]},expectedRevision:before.revision})).status).toBe(409);
    expect((await call('/v1/proposals','custom','POST',{kind:'program_change',title:'覆盖动作',rationale:'',patch:{},exercises:[{...exercise,unit:'kg'}]})).status).not.toBe(200);
    expect((await call(`/v1/reviews/proposal/${proposal.body.id}`,'stranger')).status).toBe(404);
    expect((await call(`/v1/reviews/proposal/${proposal.body.id}`,'custom')).body.item.status).toBe('accepted');
  });
});

it('AI corrections remain pending and append a revert only after user review',async()=>{
  const original=await call('/v1/entries','correction','POST',{entries:[{kind:'note',date:clock.capturedLocalDate,dateOrigin:'device',source:{actor:'user',channel:'ui',client:'web'},text:'旧备注',confidence:1}]});
  const before=(await call('/v1/state','correction')).body,target=original.body.committed[0];
  const batch=await submitModelEntries(db,before.accountId,'model',crypto.randomUUID(),'更正备注',[{kind:'note',date:clock.capturedLocalDate,dateOrigin:'device',source:{actor:'model',channel:'mcp',client:'model'},text:'新备注',confidence:1,corrects:target.id}],clock);
  const pending=(await call('/v1/state','correction')).body;expect(pending.entries).toHaveLength(1);
  const result=await call(`/v1/submissions/${batch.id}/decision`,'correction','POST',{decision:'accept',expectedRevision:pending.revision});
  expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.committed.map((e:{kind:string})=>e.kind)).toEqual(['revert','note']);
  expect((await call('/v1/state','correction')).body.entries).toHaveLength(3);
});

it('resolved ambiguity links retain owner-scoped outcomes',async()=>{
  await call('/v1/capture','resolved','POST',{text:'体重 60kg',...clock});
  const capture=await call('/v1/capture','resolved','POST',{text:'体重 61kg',...clock}),id=capture.body.held[0].id;
  expect((await call(`/v1/held/${id}/resolve`,'resolved','POST',{skip:true})).status).toBe(200);
  expect((await call(`/v1/reviews/held/${id}`,'resolved')).body.status).toBe('resolved');
  expect((await call(`/v1/reviews/held/${id}`,'elsewhere')).status).toBe(404);
});


describe('account equipment preferences',()=>{
  it('persists across reads, isolates accounts, emits an event and replays once',async()=>{
    const before=(await call('/v1/state','equipment')).body;
    expect(before.equipment.lb.plateLoads).toEqual([45,25,10,5,2.5]);
    const equipment={...before.equipment,activeBarbellUnit:'kg',kg:{barLoad:15,plateLoads:[20,10,5,.5]}};
    const body={equipment,expectedRevision:before.revision},key=crypto.randomUUID();
    const saved=await call('/v1/preferences/equipment','equipment','PUT',body,key);expect(saved.status).toBe(200);
    expect((await call('/v1/preferences/equipment','equipment','PUT',body,key)).body).toEqual(saved.body);
    const after=(await call('/v1/state','equipment')).body;
    expect(after.equipment).toEqual(equipment);expect(after.revision).toBe(before.revision+1);expect(after.entries).toEqual(before.entries);expect(after.eventCursor).toBeGreaterThan(before.eventCursor);
    expect((await call('/v1/state','equipment-other')).body.equipment.kg.barLoad).toBe(20);
    expect((await call('/v1/export','equipment')).body.snapshot.equipment).toEqual(equipment);
    expect((await call('/v1/preferences/equipment','equipment','PUT',{...body,equipment:before.equipment},key)).status).toBe(409);
    expect((await call('/v1/preferences/equipment','equipment','PUT',body)).status).toBe(409);
    expect((await call('/v1/preferences/equipment','equipment','PUT',{equipment:{...equipment,kg:{barLoad:20,plateLoads:[5,5]}},expectedRevision:after.revision})).status).toBe(400);
    const response=await app.fetch(new Request(`http://127.0.0.1:5173/v1/events?after=${before.eventCursor}`,{headers:{'X-Test-User':'equipment'}}),env());
    const reader=response.body!.getReader();const event=await reader.read();await reader.cancel();expect(new TextDecoder().decode(event.value)).toContain('equipment.updated');
  });
  it('rejects one concurrent stale configuration without partial writes',async()=>{
    const before=(await call('/v1/state','equipment-race')).body;
    const [a,b]=await Promise.all([15,25].map(barLoad=>call('/v1/preferences/equipment','equipment-race','PUT',{expectedRevision:before.revision,equipment:{...before.equipment,kg:{...before.equipment.kg,barLoad}}})));
    expect([a.status,b.status].sort()).toEqual([200,409]);expect((await call('/v1/state','equipment-race')).body.revision).toBe(before.revision+1);
  });
});
