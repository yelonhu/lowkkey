import { useCallback, useEffect, useRef, useState } from 'react';
import type { EntryDraft, Entry, Held, Program, WriteResult } from '@lowkkey/protocol';
import { capturedClock, dequeue, enqueue, pending } from '../client/offline.ts';
import type { QueuedCapture } from '../client/offline.ts';
import type { V1State } from '../server/v1-store.ts';
import { openSession } from '@lowkkey/core';

export class RequestError extends Error {
  constructor(readonly code:string, readonly status=0){super(code);}
  get retryable(){return this.status===0||this.status>=500||this.status===408||this.status===429;}
}
async function request<T>(path:string,method:'GET'|'POST'|'PUT'='GET',body?:unknown,id?:string):Promise<T> {
  const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(path,{method,credentials:'same-origin',signal:controller.signal,headers:body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':id??crypto.randomUUID()},body:body===undefined?undefined:JSON.stringify(body)});
    if(!response.ok){const value=await response.json().catch(()=>null) as {error?:{code?:string}}|null;throw new RequestError(value?.error?.code??`HTTP_${response.status}`,response.status);}
    return await response.json() as T;
  } catch(cause){if(cause instanceof RequestError)throw cause;throw new RequestError(controller.signal.aborted?'timeout':'network');}
  finally{window.clearTimeout(timeout);}
}
function message(cause:unknown){
  if(cause instanceof RequestError){
    if(cause.status===409)return '状态已变化，已刷新，请重新确认。';
    if(cause.status===401)return '登录已失效，请重新登录。';
    if(cause.retryable)return '暂未确认操作结果，请重试；同一操作不会重复写入。';
  }
  return '操作未完成，请检查输入后重试。';
}
export function useHandoff(enabled=true) {
  const [state,setState]=useState<V1State|null>(null),[auth,setAuth]=useState<'loading'|'required'|'ready'>('loading');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[queueCount,setQueueCount]=useState(0),[toast,setToast]=useState<Entry|null>(null);
  const [retry,setRetry]=useState<(()=>void)|null>(null);
  const [confirmedCapture,setConfirmedCapture]=useState<QueuedCapture|null>(null);
  const account=useRef(''),current=useRef<V1State|null>(null),flushing=useRef<Promise<boolean>|null>(null),captureFlight=useRef(false),operation=useRef<Promise<unknown>|null>(null);
  const sequence=useRef(0),applied=useRef(0);
  const refresh=useCallback(async()=>{
    const serial=++sequence.current;
    let next=await request<V1State>('/v1/state');
    const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    if(next.revision===0&&next.timezone==='UTC'&&zone!=='UTC'){await request('/v1/preferences/timezone','PUT',{timeZone:zone});next=await request<V1State>('/v1/state');}
    if(serial>=applied.current&&(!current.current||next.accountId!==current.current.accountId||next.revision>=current.current.revision)){
      applied.current=serial;account.current=next.accountId;current.current=next;setState(next);setAuth('ready');setQueueCount((await pending(next.accountId)).length);
    }
    return current.current??next;
  },[]);
  const flush=useCallback(():Promise<boolean>=>{
    if(flushing.current)return flushing.current;
    if(!account.current||!navigator.onLine)return Promise.resolve(false);
    const work=(async()=>{
      try {
        // Re-read after each write: a capture can arrive while this loop awaits D1.
        for(;;){
          const item=(await pending(account.current))[0];if(!item)break;
          const result=await request<WriteResult>('/v1/capture','POST',{text:item.rawText,capturedAt:item.capturedAt,capturedLocalDate:item.capturedLocalDate,timeZone:item.timeZone,context:{inSession:item.inSession??false}},item.id);
          await dequeue(item.id);
          setConfirmedCapture(item);
          setToast(result.committed.find(entry=>entry.kind!=='revert')??null);
          await refresh();
        }
        setError('');return true;
      }catch(cause){if(navigator.onLine)setError(message(cause));return false;}
      finally{flushing.current=null;}
    })();flushing.current=work;return work;
  },[refresh]);
  useEffect(()=>{if(!enabled)return;void refresh().then(flush).catch(cause=>{setAuth(cause instanceof RequestError&&cause.status===401?'required':'loading');setError(cause instanceof RequestError&&cause.status===401?'':message(cause));});},[enabled,refresh,flush]);
  useEffect(()=>{
    if(!enabled)return;
    const resume=()=>{if(document.visibilityState==='hidden')return;void refresh().then(flush).catch(()=>{});};
    window.addEventListener('online',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);
    return()=>{window.removeEventListener('online',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume);};
  },[enabled,flush,refresh]);
  useEffect(()=>{
    if(!enabled||auth!=='ready')return;
    let events:EventSource|null=null,timer:number|undefined;
    const connect=()=>{
      events?.close();events=null;
      if(document.visibilityState==='hidden')return;
      events=new EventSource(`/v1/events?after=${current.current?.eventCursor??0}`);
      events.onmessage=()=>{if(timer!==undefined)return;timer=window.setTimeout(()=>{timer=undefined;void refresh().catch(()=>{});},40);};
    };
    connect();document.addEventListener('visibilitychange',connect);
    return()=>{events?.close();window.clearTimeout(timer);document.removeEventListener('visibilitychange',connect);};
  },[enabled,auth,refresh]);
  useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(null),8000);return()=>window.clearTimeout(timer);},[toast]);
  async function login(){setBusy(true);try{if(!import.meta.env.DEV){window.location.href='/cdn-cgi/access/login';return;}await request('/api/local/session','POST',{});await refresh();await flush();setError('');}catch(cause){setError(message(cause));}finally{setBusy(false);}}
  async function submit(text:string){
    if(!state||!text.trim()||captureFlight.current||operation.current)return false;
    captureFlight.current=true;setBusy(true);setError('');
    try {
      const clock=capturedClock(),existing=(await pending(state.accountId)).find(item=>item.rawText===text.trim());
      const item:QueuedCapture=existing??{id:crypto.randomUUID(),accountId:state.accountId,rawText:text.trim(),...clock,inSession:!!openSession(state.entries),createdAt:clock.capturedAt};
      if(!existing)await enqueue(item);setQueueCount((await pending(state.accountId)).length);
      if(!navigator.onLine)return true;
      await flush();return !(await pending(state.accountId)).some(queued=>queued.id===item.id);
    }catch(cause){setError(message(cause));return false;}finally{captureFlight.current=false;setBusy(false);}
  }
  function action<T>(path:string,body:unknown,method:'POST'|'PUT'='POST'):Promise<T> {
    if(operation.current)return operation.current as Promise<T>;
    const id=crypto.randomUUID(),payload=structuredClone(body);
    let running=false,committed=false,result:T;
    const promise=new Promise<T>((resolve,reject)=>{
      const attempt=async()=>{
        if(running)return;running=true;setBusy(true);setRetry(null);setError('');
        try {
          if(!committed){result=await request<T>(path,method,payload,id);committed=true;}
          await refresh();operation.current=null;resolve(result);
        }catch(cause){
          setError(message(cause));
          // Retain the original promise, payload and key while the user retries.
          // Callers continue their existing success path only after confirmation.
          if(committed||cause instanceof RequestError&&cause.retryable)setRetry(()=>()=>void attempt());
          else {if(cause instanceof RequestError&&cause.status===409)await refresh().catch(()=>{});operation.current=null;reject(cause);}
        }finally{running=false;setBusy(false);}
      };
      void attempt();
    });operation.current=promise;return promise;
  }
  async function retryCapture(){
    if(captureFlight.current||operation.current)return false;
    captureFlight.current=true;setBusy(true);
    try{return await flush();}finally{captureFlight.current=false;setBusy(false);}
  }
  return {state,auth,busy,error,queueCount,toast,retry,confirmedCapture,retryCapture,setError,login,submit,refresh,
    resolve:(held:Held,choice:{optionId:string}|{skip:true})=>action<WriteResult>(`/v1/held/${held.id}/resolve`,choice),
    decideSubmission:(id:string,decision:'accept'|'skip',answers:Record<string,string>,revision=state?.revision)=>action<WriteResult>(`/v1/submissions/${id}/decision`,{decision,answers,expectedRevision:revision}),
    reviewSubmission:(id:string,answers:Record<string,string>)=>request<{questions:V1State['submissions'][number]['questions'];ready:boolean;revision:number}>(`/v1/submissions/${id}/review`,'POST',{answers}),
    revert:async(entry:Entry)=>{const result=await action<Entry>(`/v1/entries/${entry.id}/revert`,{reason:''});setToast(null);return result;},
    writeEntries:(entries:EntryDraft[],inSession=false)=>action<WriteResult>('/v1/entries',{entries,inSession}),
    writeProgram:(program:Program)=>action<Program>('/v1/program',program,'PUT'),
    decideProposal:(id:string,decision:'accept'|'reject'|'later',expectedRevision=state?.revision)=>action(`/v1/proposals/${id}/decision`,{decision,expectedRevision}),
    claimDecision:async()=>{await request('/v1/decisions/today','POST',{});await refresh();},
    decideTrigger:(id:string,decision:'accept'|'later',expectedRevision=state?.revision)=>action(`/v1/triggers/${id}/decision`,{decision,expectedRevision}),
    revokeClient:(id:string)=>action(`/v1/clients/${id}/revoke`,{}),
  };
}
