import type { D1Database } from '@cloudflare/workers-types';
import { MCP_TOOLS, AccountPreferencesInput, OnboardingInput, OnboardingState } from '@lowkkey/protocol';
import { StoreError } from './account.ts';

export async function event(db:D1Database,owner:string,name:string,code='') {
  await db.prepare("INSERT OR IGNORE INTO product_events(owner_id,event,code,created_at) SELECT id,?,?,? FROM users WHERE id=? AND lifecycle='active'").bind(name,code,new Date().toISOString(),owner).run();
}
export async function onboarding(db:D1Database,owner:string) {
  const row=await db.prepare('SELECT * FROM onboarding WHERE owner_id=?').bind(owner).first<Record<string,string|null>>();
  const content=await db.prepare('SELECT EXISTS(SELECT 1 FROM showroom_sessions WHERE owner_id=? AND json_array_length(sets_json)>0) OR EXISTS(SELECT 1 FROM showroom_weights WHERE owner_id=?) OR EXISTS(SELECT 1 FROM showroom_plans WHERE owner_id=? AND json_array_length(items_json)>0) OR EXISTS(SELECT 1 FROM daily_notes WHERE owner_id=? AND text<>"") AS present').bind(owner,owner,owner,owner).first<{present:number}>();
  const clients=await db.prepare('SELECT * FROM oauth_clients WHERE owner_id=? ORDER BY created_at DESC,id').bind(owner).all<Record<string,string|null>>();
  return OnboardingState.parse({ai:row?.ai??null,entry:row?.entry??null,skippedAt:row?.skipped_at??null,completedAt:row?.completed_at??null,firstViewUrl:row?.first_view_url??null,hasContent:!!content?.present,step:row?.step??'choose',connectionStartedAt:row?.connection_started_at??null,clients:clients.results.map(c=>({id:c.id,name:c.name,scopes:JSON.parse(c.scopes_json!),status:c.status,createdAt:c.created_at,lastUsedAt:c.last_used_at,firstReadAt:c.first_read_at,firstWriteAt:c.first_write_at}))});
}
export async function updateOnboarding(db:D1Database,owner:string,value:unknown) {
  const input=OnboardingInput.parse(value);
  await db.prepare("INSERT OR IGNORE INTO onboarding(owner_id) SELECT id FROM users WHERE id=? AND lifecycle='active'").bind(owner).run();
  const statements=[];
  if(input.ai!==undefined)statements.push(db.prepare('UPDATE onboarding SET ai=?,connection_started_at=? WHERE owner_id=?').bind(input.ai,new Date().toISOString(),owner));
  if(input.step!==undefined)statements.push(db.prepare('UPDATE onboarding SET step=? WHERE owner_id=?').bind(input.step,owner));
  if(input.entry!==undefined)statements.push(db.prepare('UPDATE onboarding SET entry=? WHERE owner_id=?').bind(input.entry,owner));
  if(input.skipped!==undefined)statements.push(db.prepare('UPDATE onboarding SET skipped_at=? WHERE owner_id=?').bind(input.skipped?new Date().toISOString():null,owner));
  if(statements.length)await db.batch(statements);
  return onboarding(db,owner);
}
export async function preferences(db:D1Database,owner:string,value:unknown) {
  const input=AccountPreferencesInput.parse(value);
  await db.prepare("UPDATE users SET timezone=?,timezone_initialized=1 WHERE id=? AND lifecycle='active'"+(input.initialize?' AND timezone_initialized=0':'')).bind(input.timezone,owner).run();
  return {ok:true as const};
}
export async function toolSuccess(db:D1Database,owner:string,client:string,name:string,view?:string,activates=false) {
  const now=new Date().toISOString();
  const statements=[db.prepare("UPDATE oauth_clients SET last_used_at=? WHERE id=? AND owner_id=? AND status='active'").bind(now,client,owner)];
  const read=MCP_TOOLS.find(tool=>tool.name===name)?.scope==='read';
  if(read)statements.push(db.prepare("UPDATE oauth_clients SET first_read_at=COALESCE(first_read_at,?) WHERE id=? AND owner_id=? AND status='active'").bind(now,client,owner));
  else statements.push(db.prepare("UPDATE oauth_clients SET first_write_at=COALESCE(first_write_at,?) WHERE id=? AND owner_id=? AND status='active'").bind(now,client,owner));
  if(activates)statements.push(db.prepare("INSERT INTO onboarding(owner_id,completed_at,first_view_url) SELECT id,?,? FROM users WHERE id=? AND lifecycle='active' ON CONFLICT(owner_id) DO UPDATE SET completed_at=COALESCE(completed_at,excluded.completed_at),first_view_url=COALESCE(first_view_url,excluded.first_view_url)").bind(now,view??null,owner));
  await db.batch(statements);
  await event(db,owner,read?'first_read':'first_write');
}

// Block access atomically before any cleanup. The durable job survives request loss.
export async function beginDeletion(db:D1Database,owner:string,userId:string,email:string) {
  const now=new Date().toISOString();
  const linked=await db.prepare('SELECT owner_id FROM auth_owners WHERE user_id=?').bind(userId).first<{owner_id:string}>();
  if(linked?.owner_id!==owner)throw new StoreError('account_mismatch',409);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO account_deletions(owner_id,user_id,email,requested_at) VALUES (?,?,?,?)').bind(owner,userId,email,now),
    db.prepare("UPDATE users SET lifecycle='deleting' WHERE id=?").bind(owner),
    db.prepare("UPDATE oauth_clients SET status='revoked',revoked_at=COALESCE(revoked_at,?) WHERE owner_id=?").bind(now,owner),
    db.prepare('DELETE FROM auth_session WHERE userId=?').bind(userId),
  ]);
}
export async function cleanupDeletions(db:D1Database,revokeGrant?:(grant:string,owner:string)=>Promise<void>) {
  await db.prepare('DELETE FROM privacy_intents WHERE expires_at<?').bind(new Date().toISOString()).run();
  const jobs=await db.prepare('SELECT * FROM account_deletions ORDER BY requested_at LIMIT 25').all<{owner_id:string;user_id:string;email:string}>();
  // Legacy tables may already have been retired in production.
  const tables=new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{name:string}>()).results.map(r=>r.name));
  for(const job of jobs.results){
    try {
      const clients=await db.prepare('SELECT grant_id FROM oauth_clients WHERE owner_id=? AND grant_id IS NOT NULL').bind(job.owner_id).all<{grant_id:string}>();
      if(revokeGrant)for(const client of clients.results)await revokeGrant(client.grant_id,job.owner_id);
      const owned=['daily_notes','showroom_sessions','showroom_weights','showroom_plans','profiles','preferences','curations','curation_versions','annotations','plan_history','mutation_guard','training_sessions','weights','plans','onboarding','privacy_consents','product_events','oauth_clients','auth_owners'];
      await db.batch([
        ...owned.filter(t=>tables.has(t)).map(t=>db.prepare(`DELETE FROM ${t} WHERE owner_id=?`).bind(job.owner_id)),
        db.prepare('DELETE FROM auth_session WHERE userId=?').bind(job.user_id),
        db.prepare('DELETE FROM auth_account WHERE userId=?').bind(job.user_id),
        db.prepare('DELETE FROM auth_verification WHERE identifier=? OR identifier=?').bind(job.email,'sign-in-otp-'+job.email),
        db.prepare('DELETE FROM auth_user WHERE id=?').bind(job.user_id),
        db.prepare('DELETE FROM users WHERE id=?').bind(job.owner_id),
        db.prepare('DELETE FROM account_deletions WHERE owner_id=?').bind(job.owner_id),
      ]);
    }catch{console.error('ACCOUNT_CLEANUP_RETRY');}
  }
}
