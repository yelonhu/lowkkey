import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { Entry as EntrySchema, EntryDraft as DraftSchema, Program as ProgramSchema, Snapshot as SnapshotSchema, VerifierId, type Entry, type EntryDraft, type Snapshot, type Source, type WriteResult } from '@lowkkey/protocol';
import { capture, decideProposal, decideTrigger, derive, emptySnapshot, log, propose, putProgram, refreshTriggers, resolveHeld, revert } from '@lowkkey/core';
import { parse } from '@lowkkey/core';
import { StoreError } from './account.ts';

type StateRow = { state_json: string };
type EntryRow = { entry_json: string };
type OldRow = { id:string; kind:string; local_date:string; payload_json:string; raw_text:string|null; source_actor:string; source_channel:string; capture_id:string|null; reverts_id:string|null; created_at:string };
type OperationRow = { request_hash:string; response_json:string };
type SubmissionRow = { id:string; owner_id:string; client_id:string; raw_text:string; drafts_json:string; captured_at:string; time_zone:string; base_revision:number; status:'pending'|'accepted'|'skipped'; result_json:string|null; created_at:string };
export type Submission = { id:string; clientId:string; rawText:string; drafts:EntryDraft[]; status:SubmissionRow['status']; capturedAt:string; timeZone:string; createdAt:string; questions:{id:string;gate:string;question:string;context?:string;options:{id:string;label:string}[]}[] };
type ReviewQuestion=Submission['questions'][number];
export type V1State = Snapshot & { accountId:string; revision:number; eventCursor:number; derived:ReturnType<typeof derive>; submissions:Submission[]; clients:ClientPublic[] };
export type ClientPublic = { id:string; name:string; scopes:string[]; status:'active'|'revoked'; createdAt:string; lastUsedAt:string|null };

const oldExerciseIds:Record<string,string> = {sq:'back_squat',lps:'leg_press',slc:'seated_leg_curl',add:'hip_adduction',pu:'pull_up',bbr:'barbell_row',lpd:'lat_pulldown',cr:'seated_row',fp1:'face_pull',bp:'bench_press',idb:'incline_db_press',fly:'cable_fly',pd:'triceps_pushdown',dsp:'db_shoulder_press',lr1:'lateral_raise',ez:'ez_curl',sk:'skull_crusher'};
export function localDate(at:string, timeZone:string):string {
  const date=new Date(at);
  if (!Number.isFinite(date.getTime())) throw new StoreError('bad_request',400);
  let parts:Intl.DateTimeFormatPart[];
  try { parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date); }
  catch { throw new StoreError('bad_request',400); }
  const part=(name:string)=>parts.find(p=>p.type===name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function legacyEntry(row:OldRow,index:number):Entry {
  const payload=JSON.parse(row.payload_json) as Record<string,unknown>;
  const base={id:row.id,date:row.local_date,dateOrigin:/(?:昨天|前天|今日|今天|\d{1,2}月\d{1,2}日)/.test(row.raw_text??'')?'explicit' as const:'device' as const,createdAt:row.created_at,
    source:{actor:row.source_actor==='user'?'user' as const:row.source_actor==='rule'?'rule' as const:'model' as const,channel:row.source_channel==='mcp'?'mcp' as const:'text' as const,client:row.source_actor==='user'?'web':row.source_actor,rawText:row.raw_text??undefined}};
  if(row.kind==='weight') return EntrySchema.parse({...base,kind:'weight',kg:payload.kg,raw:payload.raw,condition:payload.condition==='post_bm'?'post_bm':'unspecified'});
  if(row.kind==='set') {
    const raw=payload.raw as {value:number;unit:'kg'|'lb'};
    return EntrySchema.parse({...base,kind:'set',sessionId:row.capture_id??row.id,exerciseId:oldExerciseIds[String(payload.exerciseId)]??payload.exerciseId,setIndex:index+1,load:raw.value,unit:raw.unit,loadKind:'external',reps:payload.reps,rir:payload.rir??null});
  }
  return EntrySchema.parse({...base,kind:'revert',targetId:row.reverts_id,reason:String(payload.reason??'')});
}
async function storedState(db:D1Database,ownerId:string,at:string):Promise<Snapshot> {
  const row=await db.prepare('SELECT state_json FROM v1_state WHERE owner_id=?').bind(ownerId).first<StateRow>();
  const mutable=row?SnapshotSchema.parse(JSON.parse(row.state_json)):emptySnapshot(localDate(at,'UTC'),'UTC');
  const [fresh,old]=await Promise.all([
    db.prepare('SELECT entry_json FROM v1_entries WHERE owner_id=? ORDER BY created_at,id').bind(ownerId).all<EntryRow>(),
    db.prepare('SELECT * FROM entries WHERE owner_id=? ORDER BY created_at,id').bind(ownerId).all<OldRow>(),
  ]);
  const entries=[...old.results.map(legacyEntry),...fresh.results.map(r=>EntrySchema.parse(JSON.parse(r.entry_json)))].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  return {...mutable,entries,today:localDate(at,mutable.timezone)};
}
async function revision(db:D1Database,ownerId:string):Promise<number> {
  const row=await db.prepare('SELECT data_revision FROM users WHERE id=?').bind(ownerId).first<{data_revision:number}>();
  if(!row)throw new StoreError('unauthorized',401);
  return row.data_revision;
}
async function digest(value:unknown):Promise<string> {
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function replay(db:D1Database,ownerId:string,clientId:string,operation:string,key:string,hash:string):Promise<unknown|null> {
  const row=await db.prepare('SELECT request_hash,response_json FROM v1_operations WHERE owner_id=? AND client_id=? AND operation=? AND idempotency_key=?').bind(ownerId,clientId,operation,key).first<OperationRow>();
  if(!row)return null;
  if(row.request_hash!==hash)throw new StoreError('conflict',409);
  return JSON.parse(row.response_json);
}
type Mutation<T> = {snap:Snapshot;result:T;extra?:D1PreparedStatement[];events?:unknown[]};
export async function mutate<T>(db:D1Database,ownerId:string,clientId:string,operation:string,key:string,input:unknown,change:(snap:Snapshot,now:string)=>Promise<Mutation<T>>|Mutation<T>):Promise<T> {
  if(!key || key.length>128)throw new StoreError('bad_request',400);
  const requestHash=await digest(input);
  const done=await replay(db,ownerId,clientId,operation,key,requestHash);
  if(done!==null)return done as T;
  for(let attempt=0;attempt<4;attempt++) {
    const expected=await revision(db,ownerId),now=new Date().toISOString(),before=await storedState(db,ownerId,now);
    const {snap,result,extra=[],events=[]}=await change(before,now);
    const oldIds=new Set(before.entries.map(e=>e.id));
    const added=snap.entries.filter(e=>!oldIds.has(e.id));
    const mutable={...snap,entries:[]};
    const statements:D1PreparedStatement[]=[
      db.prepare('INSERT INTO mutation_guards(owner_id,operation_id,condition_ok) VALUES (?,?,CASE WHEN (SELECT data_revision FROM users WHERE id=?)=? THEN 1 ELSE 0 END)').bind(ownerId,key,ownerId,expected),
      db.prepare('UPDATE users SET data_revision=data_revision+1 WHERE id=?').bind(ownerId),
      db.prepare('INSERT INTO v1_state(owner_id,state_json,updated_at) VALUES (?,?,?) ON CONFLICT(owner_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at').bind(ownerId,JSON.stringify(mutable),now),
      ...added.map(e=>db.prepare('INSERT INTO v1_entries(id,owner_id,local_date,kind,entry_json,created_at) VALUES (?,?,?,?,?,?)').bind(e.id,ownerId,e.date,e.kind,JSON.stringify(e),e.createdAt)),
      ...extra,
      ...events.map(e=>db.prepare('INSERT INTO v1_events(owner_id,event_json,created_at) VALUES (?,?,?)').bind(ownerId,JSON.stringify(e),now)),
      db.prepare('INSERT INTO v1_operations(owner_id,client_id,operation,idempotency_key,request_hash,response_json,created_at) VALUES (?,?,?,?,?,?,?)').bind(ownerId,clientId,operation,key,requestHash,JSON.stringify(result),now),
      db.prepare('DELETE FROM mutation_guards WHERE owner_id=? AND operation_id=?').bind(ownerId,key),
    ];
    try { await db.batch(statements);return result; }
    catch(error) {
      const committed=await replay(db,ownerId,clientId,operation,key,requestHash);
      if(committed!==null)return committed as T;
      if(attempt===3)throw error;
    }
  }
  throw new StoreError('internal',500);
}
function actor(source:Source,at:string,timeZone:string) {return {now:at,today:localDate(at,timeZone),source};}
function eventDiff(before:Snapshot,after:Snapshot):unknown[] {
  const prior=new Set(before.entries.map(e=>e.id));
  return after.entries.filter(e=>!prior.has(e.id)).map(e=>e.kind==='revert'?{type:'entry.reverted',revert:e}:{type:'entry.committed',entry:e});
}
export async function state(db:D1Database,ownerId:string,at=new Date().toISOString()):Promise<V1State> {
  const eventCursor=await latestEventId(db,ownerId);
  const snap=await storedState(db,ownerId,at);
  const [submissions,clients,currentRevision]=await Promise.all([listSubmissions(db,ownerId,snap),listClients(db,ownerId),revision(db,ownerId)]);
  return {...snap,accountId:ownerId,revision:currentRevision,eventCursor,derived:derive(snap),submissions,clients};
}
export async function setTimeZone(db:D1Database,ownerId:string,key:string,timeZone:string) {
  localDate(new Date().toISOString(),timeZone);
  return mutate(db,ownerId,'web','timezone',key,{timeZone},snap=>({snap:{...snap,timezone:timeZone},result:{timeZone}}));
}
export async function captureText(db:D1Database,ownerId:string,key:string,input:{text:string;capturedAt:string;capturedLocalDate:string;timeZone:string;inSession?:boolean}):Promise<WriteResult> {
  if(localDate(input.capturedAt,input.timeZone)!==input.capturedLocalDate)throw new StoreError('bad_request',400);
  return mutate(db,ownerId,'web','capture',key,input,(snap,now)=>{
    const anchored={...snap,today:input.capturedLocalDate,timeZone:input.timeZone};
    const out=capture(anchored,input.text,{now,today:input.capturedLocalDate,source:{actor:'user',channel:'text',client:'web',rawText:input.text}},{inSession:input.inSession});
    const next=refreshTriggers(out.snap,actor({actor:'rule',channel:'ui',client:'V8'},now,input.timeZone));
    return {snap:next,result:out.result,events:[...eventDiff(snap,next),...out.result.held.map(held=>({type:'held.created',held}))]};
  });
}
export async function logEntries(db:D1Database,ownerId:string,key:string,drafts:EntryDraft[],inSession=false):Promise<WriteResult> {
  return mutate(db,ownerId,'web','entries',key,{drafts,inSession},snap=>{
    const now=new Date().toISOString(),source:Source={actor:'user',channel:'ui',client:'web'};
    const safe=drafts.map(d=>DraftSchema.parse({...d,source}));
    const out=log(snap,safe,actor(source,now,snap.timezone),{inSession});
    return {snap:out.snap,result:out.result,events:[...eventDiff(snap,out.snap),...out.result.held.map(held=>({type:'held.created',held}))]};
  });
}
export async function resolve(db:D1Database,ownerId:string,key:string,id:string,choice:{optionId:string}|{skip:true}) {
  return mutate(db,ownerId,'web','held.resolve',key,{id,choice},snap=>{
    const out=resolveHeld(snap,id,choice,actor({actor:'user',channel:'ui',client:'web'},new Date().toISOString(),snap.timezone));
    return {snap:out.snap,result:out.result,events:[...eventDiff(snap,out.snap),{type:'held.resolved',heldId:id}]};
  });
}
export async function undo(db:D1Database,ownerId:string,key:string,id:string,reason:string) {
  return mutate(db,ownerId,'web','entry.revert',key,{id,reason},snap=>{
    if(snap.entries.some(e=>e.kind==='revert'&&e.targetId===id))throw new StoreError('conflict',409);
    const out=revert(snap,id,reason,actor({actor:'user',channel:'ui',client:'web'},new Date().toISOString(),snap.timezone));
    return {snap:out.snap,result:out.entry,events:eventDiff(snap,out.snap)};
  });
}
export async function writeProgram(db:D1Database,ownerId:string,key:string,value:unknown) {
  const program=ProgramSchema.parse(value);
  return mutate(db,ownerId,'web','program.put',key,program,snap=>{
    const next=putProgram(snap,program,actor({actor:'user',channel:'ui',client:'web'},new Date().toISOString(),snap.timezone));
    return {snap:next,result:program,events:[{type:'program.updated',program}]};
  });
}
export async function createProposal(db:D1Database,ownerId:string,clientId:string,key:string,value:{kind:'program_change'|'note';title:string;rationale:string;ruleRefs:string[];patch:Record<string,unknown>},source:Source) {
  return mutate(db,ownerId,clientId,'proposal.create',key,value,snap=>{
    const out=propose(snap,{...value,ruleRefs:VerifierId.array().parse(value.ruleRefs)},actor(source,new Date().toISOString(),snap.timezone));
    return {snap:out.snap,result:out.proposal,events:[{type:'proposal.created',proposal:out.proposal}]};
  });
}
export async function proposalDecision(db:D1Database,ownerId:string,key:string,id:string,decision:'accept'|'reject',note?:string) {
  return mutate(db,ownerId,'web','proposal.decision',key,{id,decision,note},snap=>{
    const next=decideProposal(snap,id,decision,note,actor({actor:'user',channel:'ui',client:'web'},new Date().toISOString(),snap.timezone));
    const result=next.proposals.find(p=>p.id===id)!;
    return {snap:next,result,events:[{type:'proposal.decided',proposal:result}]};
  });
}
export async function triggerDecision(db:D1Database,ownerId:string,key:string,id:string,decision:'accept'|'later',reason?:string) {
  return mutate(db,ownerId,'web','trigger.decision',key,{id,decision,reason},snap=>{
    const next=decideTrigger(snap,id,decision,reason,actor({actor:'user',channel:'ui',client:'web'},new Date().toISOString(),snap.timezone));
    const result=next.triggers.find(t=>t.id===id)!;
    return {snap:next,result,events:[...eventDiff(snap,next),{type:'trigger.updated',trigger:result}]};
  });
}
async function listSubmissions(db:D1Database,ownerId:string,snap:Snapshot):Promise<Submission[]> {
  const rows=await db.prepare("SELECT * FROM v1_submissions WHERE owner_id=? AND status='pending' ORDER BY created_at,id").bind(ownerId).all<SubmissionRow>();
  return rows.results.map(row=>{
    const drafts=JSON.parse(row.drafts_json) as EntryDraft[];
    const preview=evaluateSubmission(snap,row,drafts,{},row.captured_at);
    return {id:row.id,clientId:row.client_id,rawText:row.raw_text,drafts,status:row.status,capturedAt:row.captured_at,timeZone:row.time_zone,createdAt:row.created_at,
      questions:preview.questions};
  });
}
function evaluateSubmission(snap:Snapshot,row:Pick<SubmissionRow,'captured_at'|'time_zone'|'client_id'|'raw_text'>,drafts:EntryDraft[],answers:Record<string,string>,now:string){
  const at=localDate(row.captured_at,row.time_zone);
  const out=log({...snap,today:at},drafts,{now,today:at,source:{actor:'model',channel:'mcp',client:row.client_id,rawText:row.raw_text}});
  let next=out.snap;
  const result:WriteResult={...out.result,committed:[...out.result.committed],held:[]};
  const questions:ReviewQuestion[]=[];
  const visit=(held:typeof out.result.held[number],id:string,depth:number)=>{
    if(depth>12)throw new StoreError('invalid_state',409);
    const chosen=answers[id];
    if(!chosen){questions.push({id,gate:held.gate,question:held.question,context:held.context,options:held.options.filter(o=>o.action==='commit').map(o=>({id:o.id,label:o.label}))});return;}
    const option=held.options.find(o=>o.id===chosen);
    if(!option||option.action!=='commit')throw new StoreError('invalid_state',409);
    const resolved=resolveHeld(next,held.id,{optionId:chosen},actor({actor:'user',channel:'ui',client:'web'},now,snap.timezone));
    next=resolved.snap;result.committed.push(...resolved.result.committed);
    resolved.result.held.forEach((child,index)=>visit(child,`${id}.${index+1}`,depth+1));
  };
  out.result.held.forEach((held,index)=>visit(held,`q${index}`,0));
  return {snap:next,result,questions};
}
export async function reviewSubmission(db:D1Database,ownerId:string,id:string,answers:Record<string,string>={}){
  const row=await db.prepare("SELECT * FROM v1_submissions WHERE id=? AND owner_id=? AND status='pending'").bind(id,ownerId).first<SubmissionRow>();
  if(!row)throw new StoreError('not_found',404);
  const now=new Date().toISOString(),snap=await storedState(db,ownerId,now);
  const preview=evaluateSubmission(snap,row,JSON.parse(row.drafts_json) as EntryDraft[],answers,now);
  return {questions:preview.questions,ready:preview.questions.length===0,revision:await revision(db,ownerId)};
}
export async function submitModelEntries(db:D1Database,ownerId:string,clientId:string,key:string,rawText:string,entries:EntryDraft[],clock:{capturedAt:string;capturedLocalDate:string;timeZone:string}):Promise<Submission> {
  if(localDate(clock.capturedAt,clock.timeZone)!==clock.capturedLocalDate)throw new StoreError('bad_request',400);
  return mutate(db,ownerId,clientId,'entries.propose',key,{rawText,entries,clock},async(snap,now)=>{
    const anchored={...snap,today:clock.capturedLocalDate};
    const parsed=parse(rawText,{today:clock.capturedLocalDate,exercises:snap.exercises});
    const safe=entries.map(item=>{
      if(!['weight','set','waist','note'].includes(item.kind) || item.confidence===undefined)throw new StoreError('bad_request',400);
      const dateOrigin=item.date!==clock.capturedLocalDate && !(parsed.date===item.date&&parsed.dateOrigin==='explicit')?'inferred':item.dateOrigin==='explicit'&&parsed.date===item.date?'explicit':'device';
      return DraftSchema.parse({...item,dateOrigin,source:{actor:'model',channel:'mcp',client:clientId,rawText}});
    });
    const preview=log(anchored,safe,{now,today:clock.capturedLocalDate,source:{actor:'model',channel:'mcp',client:clientId,rawText}});
    if(preview.result.unparsed.length)throw new StoreError('bad_request',400);
    const id=crypto.randomUUID();
    const questions=preview.result.held.map((h,index)=>({
      id:`q${index}`,gate:h.gate,question:h.question,context:h.context,
      options:h.options.map(o=>({id:o.id,label:o.label})),
    }));
    const row={id,clientId,rawText,drafts:safe,status:'pending' as const,capturedAt:clock.capturedAt,timeZone:clock.timeZone,createdAt:now,questions};
    const baseRevision=await revision(db,ownerId);
    const extra=[db.prepare("INSERT INTO v1_submissions(id,owner_id,client_id,raw_text,drafts_json,captured_at,time_zone,status,created_at,base_revision) VALUES (?,?,?,?,?,?,?,'pending',?,?)").bind(id,ownerId,clientId,rawText,JSON.stringify(safe),clock.capturedAt,clock.timeZone,now,baseRevision+1)];
    return {snap,result:row,extra,events:[{type:'submission.created',submissionId:id}]};
  });
}
export async function decideSubmission(db:D1Database,ownerId:string,key:string,id:string,decision:'accept'|'skip',answers:Record<string,string>={},expectedRevision?:number) {
  return mutate(db,ownerId,'web','entries.decision',key,{id,decision,answers,expectedRevision},async(snap,now)=>{
    const row=await db.prepare('SELECT * FROM v1_submissions WHERE id=? AND owner_id=?').bind(id,ownerId).first<SubmissionRow>();
    if(!row)throw new StoreError('not_found',404);
    if(row.status!=='pending')throw new StoreError('conflict',409);
    if(expectedRevision!==await revision(db,ownerId))throw new StoreError('conflict',409);
    let next=snap,result:WriteResult={committed:[],held:[],unparsed:[]};
    if(decision==='accept') {
      const drafts=JSON.parse(row.drafts_json) as EntryDraft[];
      const review=evaluateSubmission(snap,row,drafts,answers,now);
      if(review.questions.length)throw new StoreError('invalid_state',409);
      next=review.snap;result=review.result;
      if(result.committed.filter(e=>e.kind!=='revert').length!==drafts.length)throw new StoreError('invalid_state',409);
    }
    const extra=[db.prepare('UPDATE v1_submissions SET status=?,result_json=?,decided_at=? WHERE id=? AND owner_id=? AND status=?').bind(decision==='accept'?'accepted':'skipped',JSON.stringify(result),now,id,ownerId,'pending')];
    return {snap:next,result,extra,events:[...eventDiff(snap,next),{type:'submission.decided',submissionId:id,decision}]};
  });
}
export async function listClients(db:D1Database,ownerId:string):Promise<ClientPublic[]> {
  const rows=await db.prepare('SELECT id,name,scopes_json,status,created_at,last_used_at FROM v1_clients WHERE owner_id=? ORDER BY created_at DESC').bind(ownerId).all<{id:string;name:string;scopes_json:string;status:'active'|'revoked';created_at:string;last_used_at:string|null}>();
  return rows.results.map(r=>({id:r.id,name:r.name,scopes:JSON.parse(r.scopes_json) as string[],status:r.status,createdAt:r.created_at,lastUsedAt:r.last_used_at}));
}
export async function registerOAuthClient(db:D1Database,ownerId:string,oauthClientId:string,name:string,scopes:string[],id:string) {
  if(!scopes.length||!scopes.every(s=>['read','submit','propose'].includes(s)))throw new StoreError('bad_request',400);
  const now=new Date().toISOString();
  await db.prepare('INSERT INTO v1_clients(id,owner_id,name,scopes_json,status,created_at,oauth_client_id) VALUES (?,?,?,?,?,?,?)').bind(id,ownerId,name,JSON.stringify(scopes),'active',now,oauthClientId).run();
  return id;
}
export async function oauthClient(db:D1Database,ownerId:string,id:string) {
  return db.prepare("SELECT id,scopes_json,status FROM v1_clients WHERE owner_id=? AND id=? AND oauth_client_id IS NOT NULL").bind(ownerId,id).first<{id:string;scopes_json:string;status:'active'|'revoked'}>();
}
export async function revokeClient(db:D1Database,ownerId:string,key:string,id:string) {
  return mutate(db,ownerId,'web','client.revoke',key,{id},async(snap,now)=>{
    const row=await db.prepare("SELECT status FROM v1_clients WHERE id=? AND owner_id=?").bind(id,ownerId).first<{status:'active'|'revoked'}>();
    if(!row)throw new StoreError('not_found',404);
    if(row.status==='revoked')throw new StoreError('conflict',409);
    return {snap,result:{id,status:'revoked'},extra:[db.prepare("UPDATE v1_clients SET status='revoked',revoked_at=? WHERE id=? AND owner_id=? AND status='active'").bind(now,id,ownerId)],events:[{type:'client.revoked',clientId:id}]};
  });
}
export async function eventsAfter(db:D1Database,ownerId:string,id:number) {
  const rows=await db.prepare('SELECT id,event_json FROM v1_events WHERE owner_id=? AND id>? ORDER BY id LIMIT 100').bind(ownerId,id).all<{id:number;event_json:string}>();
  return rows.results.map(r=>({id:r.id,event:JSON.parse(r.event_json) as unknown}));
}
export async function latestEventId(db:D1Database,ownerId:string){
  const row=await db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM v1_events WHERE owner_id=?').bind(ownerId).first<{id:number}>();
  return row?.id??0;
}
export async function importBackup(db:D1Database,ownerId:string,key:string,backup:{format:string;accountId:string;snapshot:unknown}){
  if(backup.format!=='lowkkey.v1'||backup.accountId!==ownerId)throw new StoreError('forbidden',403);
  const incoming=SnapshotSchema.parse(backup.snapshot);
  return mutate(db,ownerId,'web','backup.import',key,backup,(current,now)=>{
    const byId=new Map(incoming.entries.map(entry=>[entry.id,entry]));
    for(const existing of current.entries){const match=byId.get(existing.id);if(!match||JSON.stringify(match)!==JSON.stringify(existing))throw new StoreError('conflict',409);}
    const merged={...incoming,today:localDate(now,incoming.timezone),entries:[...incoming.entries].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))};
    return {snap:merged,result:{imported:incoming.entries.length-current.entries.length},events:[{type:'backup.imported',count:incoming.entries.length-current.entries.length}]};
  });
}
