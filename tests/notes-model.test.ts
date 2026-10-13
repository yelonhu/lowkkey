import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { NotesModel } from '../src/app/notes-model.ts';
import type { DailyNote } from '@lowkkey/protocol';
const date='2026-10-12';let model:NotesModel,server:DailyNote,failStorage=false,failNetwork=false;
function storage(){const values=new Map<string,string>();return {get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{if(failStorage)throw new Error('quota');values.set(key,value);},removeItem:(key:string)=>values.delete(key)};}
let intercept:((path:string,init?:RequestInit)=>Promise<Response>|undefined)|undefined;
beforeEach(async()=>{
 vi.useFakeTimers();failStorage=false;failNetwork=false;intercept=undefined;server={date,text:'',revision:0,updated_at:null};
 vi.stubGlobal('localStorage',storage());vi.stubGlobal('sessionStorage',storage());vi.stubGlobal('window',new EventTarget());
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  const deferred=intercept?.(path,init);if(deferred)return deferred;
  if(failNetwork)throw new Error('offline');
  if(init?.method==='PUT'){
   const input=JSON.parse(init.body as string);if(input.revision!==server.revision)return Response.json({error:{code:'note_conflict'}},{status:409});
   server={date,text:input.text,revision:server.revision+1,updated_at:new Date().toISOString()};return Response.json(server);
  }
  return Response.json(path.includes('?')?{notes:server.text?[server]:[],next_cursor:null}:server);
 }));
 model=new NotesModel('one');await model.refresh(date);
});
afterEach(()=>{model.dispose();vi.useRealTimers();vi.unstubAllGlobals();});
it('keeps newer typing while an older save is in flight, then saves the next version',async()=>{
 let release!:(response:Response)=>void;
 intercept=(_path,init)=>init?.method==='PUT'?new Promise(resolve=>{release=resolve;}):undefined;
 model.edit(date,'first');const saving=model.save(date);model.edit(date,'second');
 server={date,text:'first',revision:1,updated_at:new Date().toISOString()};release(Response.json(server));await saving;
 expect(model.entry(date).text).toBe('second');expect(model.entry(date).dirty).toBe(true);
 intercept=undefined;await model.save(date);expect(server.text).toBe('second');expect(server.revision).toBe(2);expect(localStorage.length).toBe(0);
});
it('ignores an older read arriving after a newer write',async()=>{
 model.edit(date,'first');await model.save(date);const old={...server};let release!:(response:Response)=>void;
 intercept=path=>path.includes('?')?new Promise(resolve=>{release=resolve;}):undefined;
 const refreshing=model.refresh(date);model.edit(date,'second');await model.save(date);release(Response.json({notes:[old],next_cursor:null}));await refreshing;
 expect(model.entry(date).text).toBe('second');expect(model.entry(date).server.revision).toBe(2);
});
it('retains full drafts across model recreation and prevents composing text from being sent',async()=>{
 model.composition(date,true);model.edit(date,'中文输入中🙂');await vi.advanceTimersByTimeAsync(1000);expect(server.revision).toBe(0);
 model.composition(date,false);failNetwork=true;await model.save(date);expect(model.entry(date).error).toContain('未能同步');model.dispose();
 model=new NotesModel('one');expect(model.entry(date).text).toBe('中文输入中🙂');failNetwork=false;await model.refresh(date);await vi.waitFor(()=>expect(server.text).toBe('中文输入中🙂'));
});
it('does not lose a concurrent tab draft when removing a saved draft',async()=>{
 model.edit(date,'mine');const key=localStorage.key(0)!;const newer=JSON.stringify({text:'newer tab text',base:server});localStorage.setItem(key,newer);
 await model.save(date);expect(localStorage.getItem(key)).toBe(newer);
});
it('shows storage failure, retains an oversized paste, and stops writes after disposal',async()=>{
 failStorage=true;model.edit(date,'x');expect(model.entry(date).localError).toBe(true);expect(model.entry(date).dirty).toBe(true);
 const text='🙂'.repeat(20001);model.edit(date,text);await model.save(date);expect(model.entry(date).text).toBe(text);expect(server.revision).toBe(0);
 model.edit(date,'pending');model.dispose();await vi.advanceTimersByTimeAsync(2000);expect(server.revision).toBe(0);
});
it('does not restore one account drafts into another account',()=>{
 model.edit(date,'private');const other=new NotesModel('two');expect(other.entries.size).toBe(0);other.dispose();
});
it('does not recreate or send a draft after export-and-leave discards it',async()=>{
 let release!:(response:Response)=>void;
 intercept=(_path,init)=>init?.method==='PUT'?new Promise(resolve=>{release=resolve;}):undefined;
 model.edit(date,'exported draft');const saving=model.save(date);model.discard();
 release(Response.json({date,text:'exported draft',revision:1,updated_at:new Date().toISOString()}));await saving;
 expect(model.hasPending()).toBe(false);expect(model.entry(date).text).toBe('');
 await vi.advanceTimersByTimeAsync(1000);expect(model.hasPending()).toBe(false);
});

it('loads a linked historical day without disturbing current typing',async()=>{
 const past={date:'2025-01-01',text:'历史原文',revision:4,updated_at:new Date().toISOString()};
 intercept=path=>path.endsWith(past.date)?Promise.resolve(Response.json(past)):undefined;
 model.edit(date,'正在输入');await model.loadDate(past.date);
 expect(model.entry(past.date).text).toBe(past.text);expect(model.entry(date).text).toBe('正在输入');expect(model.entry(date).dirty).toBe(true);
});
