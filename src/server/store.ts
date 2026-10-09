import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { BriefInput, Curation, CurationInput, DeleteInput, Plan, PlanInput, Profile, ProfileInput, Preferences, SessionInput, TrainingSession, Weight, WeightInput, ClientPublic, PROTOCOL_VERSION, ThemeInput, type StateResponse, type Facts, exerciseById } from '@lowkkey/protocol';
import { addDays, getBrief, localToday, mergeCuration, monday, themeState, weekday } from '@lowkkey/core';
import { StoreError } from './account.ts';
type Row = Record<string,unknown>;
const sessionValue = (r:Row) => TrainingSession.parse({date:r.date,title:r.title,...(r.note==null?{}:{note:r.note}),sets:JSON.parse(String(r.sets_json)),updated_at:r.updated_at});
const weightValue = (r:Row) => Weight.parse({date:r.date,lb:r.lb,updated_at:r.updated_at});
const planValue = (r:Row) => Plan.parse({title:r.title,weekday:r.weekday,coach:r.coach,items:JSON.parse(String(r.items_json)),updated_at:r.updated_at});
async function snapshot(db:D1Database,owner:string,now=new Date()) {
  const queries=['SELECT data_revision FROM users WHERE id=?','SELECT * FROM showroom_sessions WHERE owner_id=? ORDER BY date DESC','SELECT * FROM showroom_weights WHERE owner_id=? ORDER BY date','SELECT * FROM showroom_plans WHERE owner_id=? ORDER BY weekday','SELECT * FROM profiles WHERE owner_id=?','SELECT * FROM preferences WHERE owner_id=?','SELECT * FROM curations WHERE owner_id=? ORDER BY week DESC','SELECT * FROM annotations WHERE owner_id=?','SELECT * FROM plan_history WHERE owner_id=? ORDER BY revision'];
  const rows=await db.batch<Row>(queries.map(sql=>db.prepare(sql).bind(owner)));
  if(!rows[0].results.length)throw new StoreError('not_found',404);
  const profile=rows[4].results[0],prefs=rows[5].results[0];
  const facts:Facts={sessions:rows[1].results.map(sessionValue),weights:rows[2].results.map(weightValue),plans:rows[3].results.map(planValue),profile:Profile.parse({body_notes:profile?.body_notes??null,gain_target:profile?.gain_target_json?JSON.parse(String(profile.gain_target_json)):null}),preferences:Preferences.parse({theme:prefs?.theme??'ink',manual_week:prefs?.manual_week??null}),curations:rows[6].results.map(r=>Curation.parse(JSON.parse(String(r.value_json)))),annotations:Object.fromEntries(rows[7].results.map(r=>[String(r.date),String(r.text)])),plan_history:rows[8].results.map(r=>({revision:Number(r.revision),effective_date:String(r.effective_date),plans:JSON.parse(String(r.plans_json))}))};
  const today=localToday(now);return {facts,revision:Number(rows[0].results[0].data_revision),today};
}
export async function state(db:D1Database,owner:string,now=new Date()):Promise<StateResponse>{const {facts,today}=await snapshot(db,owner,now);return {...facts,accountId:owner,protocol:PROTOCOL_VERSION,today,theme_state:themeState(facts,today)};}
export async function brief(db:D1Database,owner:string,args:unknown={},now=new Date()){const {sessions}=BriefInput.parse(args);return getBrief(await state(db,owner,now),now.toISOString(),sessions);}
function field(path:(string|number)[],message:string):never {throw new StoreError('invalid_arguments',400,[{path,message}]);}
// Validate against a consistent snapshot, then compare its revision inside the same
// atomic D1 batch as every write. Retry a competing writer without losing patches.
async function mutate<T>(db:D1Database,owner:string,build:(facts:Facts,revision:number,today:string)=>{statements:D1PreparedStatement[];result:T},now=new Date()):Promise<T>{
  for(let attempt=0;attempt<8;attempt++){const snap=await snapshot(db,owner,now),revision=snap.revision+1,write=build(snap.facts,revision,snap.today);
    try{await db.batch([db.prepare('INSERT INTO mutation_guard(owner_id,ok) VALUES (?,CASE WHEN (SELECT data_revision FROM users WHERE id=?)=? THEN 1 ELSE 0 END) ON CONFLICT(owner_id) DO UPDATE SET ok=excluded.ok').bind(owner,owner,snap.revision),db.prepare('UPDATE users SET data_revision=? WHERE id=?').bind(revision,owner),...write.statements]);return write.result;}
    catch(error){if(!String(error).includes('CHECK constraint failed: ok=1'))throw error;}
  }throw new StoreError('concurrent_update_retry',409);
}
export async function logSession(db:D1Database,owner:string,value:unknown){const input=SessionInput.parse(value);return mutate(db,owner,facts=>{const prior=facts.sessions.find(s=>s.date===input.date);const saved={...input,updated_at:prior&&JSON.stringify({...prior,updated_at:undefined})===JSON.stringify({...input,updated_at:undefined})?prior.updated_at:new Date().toISOString()};return {result:saved,statements:[db.prepare('INSERT INTO showroom_sessions(owner_id,date,title,note,sets_json,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner_id,date) DO UPDATE SET title=excluded.title,note=excluded.note,sets_json=excluded.sets_json,updated_at=excluded.updated_at').bind(owner,input.date,input.title,input.note??null,JSON.stringify(input.sets),saved.updated_at)]};});}
export async function logWeight(db:D1Database,owner:string,value:unknown){const input=WeightInput.parse(value);return mutate(db,owner,facts=>{const prior=facts.weights.find(w=>w.date===input.date),saved={...input,updated_at:prior?.lb===input.lb?prior.updated_at:new Date().toISOString()};return {result:saved,statements:[db.prepare('INSERT INTO showroom_weights(owner_id,date,lb,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id,date) DO UPDATE SET lb=excluded.lb,updated_at=excluded.updated_at').bind(owner,input.date,input.lb,saved.updated_at)]};});}
export async function setPlan(db:D1Database,owner:string,value:unknown,now=new Date()){const input=PlanInput.parse(value);return mutate(db,owner,(facts,revision,today)=>{if(input.items.length&&facts.plans.some(p=>p.weekday===input.weekday&&p.title!==input.title))field(['weekday'],'这个星期已有另一个计划');
  const prior=facts.plans.find(p=>p.title===input.title),saved:Plan|null=input.items.length?{...input,coach:Object.hasOwn(input,'coach')?input.coach:prior?.coach??null,updated_at:now.toISOString()}:null;
  const plans=facts.plans.filter(p=>p.title!==input.title);if(saved)plans.push(saved);
  return {result:saved,statements:[saved?db.prepare('INSERT INTO showroom_plans(owner_id,title,weekday,coach,items_json,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner_id,title) DO UPDATE SET weekday=excluded.weekday,coach=excluded.coach,items_json=excluded.items_json,updated_at=excluded.updated_at').bind(owner,saved.title,saved.weekday,saved.coach??null,JSON.stringify(saved.items),saved.updated_at):db.prepare('DELETE FROM showroom_plans WHERE owner_id=? AND title=?').bind(owner,input.title),db.prepare('INSERT INTO plan_history(owner_id,revision,effective_date,plans_json) VALUES (?,?,?,?)').bind(owner,revision,today,JSON.stringify(plans))]};},now);}
export async function setProfile(db:D1Database,owner:string,value:unknown){const input=ProfileInput.parse(value);return mutate(db,owner,facts=>{const saved={...facts.profile,...input};return {result:saved,statements:[db.prepare('INSERT INTO profiles(owner_id,body_notes,gain_target_json) VALUES (?,?,?) ON CONFLICT(owner_id) DO UPDATE SET body_notes=excluded.body_notes,gain_target_json=excluded.gain_target_json').bind(owner,saved.body_notes,saved.gain_target?JSON.stringify(saved.gain_target):null)]};});}
export async function setTheme(db:D1Database,owner:string,value:unknown,now=new Date()){const input=ThemeInput.parse(value);return mutate(db,owner,(_facts,_revision,today)=>{const saved={theme:input.theme,manual_week:monday(today)};return {result:saved,statements:[db.prepare('INSERT INTO preferences(owner_id,theme,manual_week) VALUES (?,?,?) ON CONFLICT(owner_id) DO UPDATE SET theme=excluded.theme,manual_week=excluded.manual_week').bind(owner,saved.theme,saved.manual_week)]};},now);}
export async function deleteFact(db:D1Database,owner:string,value:unknown){const input=DeleteInput.parse(value);return mutate(db,owner,facts=>{const deleted=(input.kind==='session'?facts.sessions:facts.weights).find(x=>x.date===input.date);if(!deleted)throw new StoreError('not_found',404);const table=input.kind==='session'?'showroom_sessions':'showroom_weights';return {result:{...input,deleted},statements:[db.prepare(`DELETE FROM ${table} WHERE owner_id=? AND date=?`).bind(owner,input.date),...(input.kind==='session'?[db.prepare('DELETE FROM annotations WHERE owner_id=? AND date=?').bind(owner,input.date)]:[])]};});}
export async function curate(db:D1Database,owner:string,value:unknown,now=new Date()){const input=CurationInput.parse(value);return mutate(db,owner,(facts,revision,today)=>{
  if(input.next&&(input.next.date<today||!facts.plans.some(p=>p.weekday===weekday(input.next!.date)&&p.items.length)))field(['next','date'],'必须是今天或之后有计划的日期');
  for(const [i,pick] of (input.recap?.picks??[]).entries()){
    if(pick.date<input.week||pick.date>addDays(input.week,6))field(['recap','picks',i,'date'],'必须在指定周内');
    if(pick.kind==='weight'){if(!facts.weights.some(w=>w.date===pick.date))field(['recap','picks',i,'date'],'当天没有称重');}
    else {const session=facts.sessions.find(s=>s.date===pick.date);if(!session)field(['recap','picks',i,'date'],'当天没有训练');if(pick.kind!=='rhythm'){
      const sets=session.sets.filter(s=>s.ex===pick.ex&&(s.ex!=='custom'||s.name===pick.name));if(!sets.length)field(['recap','picks',i,'ex'],'当天没有这个动作');
      if(['barbell','dumbbell'].includes(pick.kind)&&pick.ex!=='custom'&&exerciseById(pick.ex!)?.type!==pick.kind)field(['recap','picks',i,'kind'],'器械类型与动作不符');
      if(pick.kind==='assist'&&!sets.some(s=>s.kind==='assist'))field(['recap','picks',i,'kind'],'不是辅助动作');
    }}
  }
  for(const [date,text] of Object.entries(input.log??{}))if(text!==null&&!facts.sessions.some(s=>s.date===date))field(['log',date],'当天没有训练');
  const saved=mergeCuration(facts.curations.find(c=>c.week===input.week),input,revision,now.toISOString());
  if(input.recap&&!Object.hasOwn(input.recap,'sign'))saved.recap={...saved.recap,sign:'claude · '+today.slice(5).replace('-','.')};
  const json=JSON.stringify(saved),statements=[db.prepare('INSERT INTO curations(owner_id,week,value_json) VALUES (?,?,?) ON CONFLICT(owner_id,week) DO UPDATE SET value_json=excluded.value_json').bind(owner,input.week,json),db.prepare('INSERT INTO curation_versions(owner_id,revision,week,value_json,created_at) VALUES (?,?,?,?,?)').bind(owner,revision,input.week,json,now.toISOString())];
  for(const [date,text] of Object.entries(input.log??{}))statements.push(text===null?db.prepare('DELETE FROM annotations WHERE owner_id=? AND date=?').bind(owner,date):db.prepare('INSERT INTO annotations(owner_id,date,text) VALUES (?,?,?) ON CONFLICT(owner_id,date) DO UPDATE SET text=excluded.text').bind(owner,date,text));
  return {result:saved,statements};
},now);}
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
