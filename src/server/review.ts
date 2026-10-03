import type { D1Database } from '@cloudflare/workers-types';
import * as store from './v1-store.ts';
import { StoreError } from './account.ts';
export function reviewURL(origin:string,kind:string,id:string){return `${origin}/#${kind==='submission'||kind==='held'?'Capture':'Main'}?${new URLSearchParams({review:kind,id})}`;}
export async function reviewDetail(db:D1Database,ownerId:string,kind:string,id:string,origin:string){
  const data=await store.state(db,ownerId);
  if(kind==='submission'){
    const row=await db.prepare('SELECT id,status,drafts_json,result_json,raw_text,client_id FROM v1_submissions WHERE owner_id=? AND id=?').bind(ownerId,id).first<{id:string;status:string;drafts_json:string;result_json:string|null;raw_text:string;client_id:string}>();
    if(!row)throw new StoreError('not_found',404);
    return {kind,id,status:row.status,drafts:JSON.parse(row.drafts_json),result:row.result_json?JSON.parse(row.result_json):null,title:row.raw_text,source:data.clients.find(c=>c.id===row.client_id)?.name??'AI 客户端',exercises:data.exercises,program:data.program,revision:data.revision,reviewUrl:reviewURL(origin,kind,id)};
  }
  const item=kind==='proposal'?data.proposals.find(p=>p.id===id):kind==='held'?data.held.find(p=>p.id===id):data.triggers.find(p=>p.id===id);
  if(!item&&kind==='held'){const resolved=await db.prepare("SELECT id FROM v1_events WHERE owner_id=? AND json_extract(event_json,'$.type')='held.resolved' AND json_extract(event_json,'$.heldId')=? LIMIT 1").bind(ownerId,id).first();if(resolved)return {kind,id,status:'resolved',revision:data.revision,reviewUrl:reviewURL(origin,kind,id)};}
  if(!item)throw new StoreError('not_found',404);
  return {kind,id,item,status:'status' in item?item.status:'pending',exercises:data.exercises,program:data.program,revision:data.revision,reviewUrl:reviewURL(origin,kind,id)};
}
