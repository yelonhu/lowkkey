import { useCallback, useEffect, useRef, useState } from 'react';
import type { EntryDraft, Entry, Held, Program, WriteResult } from '@lowkkey/protocol';
import { capturedClock, dequeue, enqueue, pending } from '../client/offline.ts';
import type { QueuedCapture } from '../client/offline.ts';
import type { V1State } from '../server/v1-store.ts';
import { openSession } from '@lowkkey/core';

async function request<T>(path:string,method:'GET'|'POST'|'PUT'='GET',body?:unknown,id?:string):Promise<T> {
  const response=await fetch(path,{method,credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':id??crypto.randomUUID()},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok){const value=await response.json().catch(()=>null) as {error?:{code?:string}}|null;throw new Error(value?.error?.code??`HTTP_${response.status}`);}
  return response.json() as Promise<T>;
}
export function useHandoff(enabled=true) {
  const [state,setState]=useState<V1State|null>(null),[auth,setAuth]=useState<'loading'|'required'|'ready'>('loading');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[queueCount,setQueueCount]=useState(0),[toast,setToast]=useState<Entry|null>(null);
  const account=useRef(''),flushing=useRef(false),flushAgain=useRef(false);
  const refresh=useCallback(async()=>{
    let next=await request<V1State>('/v1/state');
    const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    if(next.revision===0&&next.timezone==='UTC'&&zone!=='UTC'){await request('/v1/preferences/timezone','PUT',{timeZone:zone});next=await request<V1State>('/v1/state');}
    account.current=next.accountId;setState(next);setAuth('ready');setQueueCount((await pending(next.accountId)).length);return next;
  },[]);
  const flush=useCallback(async()=>{
    if(flushing.current){flushAgain.current=true;return;}
    if(!account.current||!navigator.onLine)return;
    flushing.current=true;
    try{
      for(const item of await pending(account.current)){
        const result=await request<WriteResult>('/v1/capture','POST',{text:item.rawText,capturedAt:item.capturedAt,capturedLocalDate:item.capturedLocalDate,timeZone:item.timeZone,context:{inSession:item.inSession??false}},item.id);
        await dequeue(item.id);
        setToast(result.committed.find(entry=>entry.kind!=='revert')??null);
        await refresh();
      }
      setError('');
    }catch(cause){if(navigator.onLine)setError(cause instanceof Error?`提交失败：${cause.message}`:'提交失败');}
    finally{flushing.current=false;if(flushAgain.current){flushAgain.current=false;queueMicrotask(()=>void flush());}}
  },[refresh]);
  useEffect(()=>{if(!enabled)return;void refresh().then(flush).catch(cause=>{setAuth(cause instanceof Error&&cause.message==='unauthorized'?'required':'loading');setError(cause instanceof Error&&cause.message!=='unauthorized'?cause.message:'');});},[enabled,refresh,flush]);
  useEffect(()=>{if(!enabled)return;const online=()=>void flush();window.addEventListener('online',online);return()=>window.removeEventListener('online',online);},[enabled,flush]);
  useEffect(()=>{if(!enabled||auth!=='ready'||!state)return;const events=new EventSource(`/v1/events?after=${state.eventCursor}`);events.onmessage=()=>void refresh();return()=>events.close();},[enabled,auth,refresh,state?.eventCursor]);
  useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(null),8000);return()=>window.clearTimeout(timer);},[toast]);
  async function login(){setBusy(true);try{if(!import.meta.env.DEV){window.location.href='/cdn-cgi/access/login';return;}await request('/api/local/session','POST',{});await refresh();await flush();setError('');}catch(cause){setError(cause instanceof Error?cause.message:'登录失败');}finally{setBusy(false);}}
  async function submit(text:string){if(!state||!text.trim()||busy)return false;const clock=capturedClock();const item:QueuedCapture={id:crypto.randomUUID(),accountId:state.accountId,rawText:text.trim(),...clock,inSession:!!openSession(state.entries),createdAt:clock.capturedAt};setBusy(true);try{await enqueue(item);setQueueCount((await pending(state.accountId)).length);await flush();return true;}catch(cause){setError(cause instanceof Error?cause.message:'保存失败');return false;}finally{setBusy(false);}}
  async function action<T>(path:string,body:unknown,method:'POST'|'PUT'='POST') {setBusy(true);try{const result=await request<T>(path,method,body);await refresh();setError('');return result;}catch(cause){setError(cause instanceof Error?cause.message:'操作失败');throw cause;}finally{setBusy(false);}}
  return {state,auth,busy,error,queueCount,toast,setError,login,submit,refresh,
    resolve:(held:Held,choice:{optionId:string}|{skip:true})=>action<WriteResult>(`/v1/held/${held.id}/resolve`,choice),
    decideSubmission:(id:string,decision:'accept'|'skip',answers:Record<string,string>)=>action<WriteResult>(`/v1/submissions/${id}/decision`,{decision,answers,expectedRevision:state?.revision}),
    reviewSubmission:(id:string,answers:Record<string,string>)=>request<{questions:V1State['submissions'][number]['questions'];ready:boolean;revision:number}>(`/v1/submissions/${id}/review`,'POST',{answers}),
    revert:async(entry:Entry)=>{const result=await action<Entry>(`/v1/entries/${entry.id}/revert`,{reason:''});setToast(null);return result;},
    writeEntries:(entries:EntryDraft[],inSession=false)=>action<WriteResult>('/v1/entries',{entries,inSession}),
    writeProgram:(program:Program)=>action<Program>('/v1/program',program,'PUT'),
    decideProposal:(id:string,decision:'accept'|'reject')=>action(`/v1/proposals/${id}/decision`,{decision}),
    decideTrigger:(id:string,decision:'accept'|'later')=>action(`/v1/triggers/${id}/decision`,{decision}),
    revokeClient:(id:string)=>action(`/v1/clients/${id}/revoke`,{}),
  };
}
