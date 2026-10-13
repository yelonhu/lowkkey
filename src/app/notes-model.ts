import { DailyNote, LocalDate, NOTE_LIMIT, NotesPage } from '@lowkkey/protocol';
import type { NotesPage as Page } from '@lowkkey/protocol';

export type NoteEntry={server:DailyNote;text:string;dirty:boolean;composing:boolean;saving:boolean;error:string;localError:boolean;conflict:DailyNote|null;recovered:Draft[]};
type Draft={date:string;text:string;base:DailyNote;key:string};
const prefix=(owner:string)=>'lowkkey-note:'+encodeURIComponent(owner)+':';
const models=new Map<string,NotesModel>();
let tabId:string;
function clientId(){
  if(!tabId){try{tabId=sessionStorage.getItem('lowkkey-note-tab')||crypto.randomUUID();sessionStorage.setItem('lowkkey-note-tab',tabId);}catch{tabId=crypto.randomUUID();}}
  return tabId;
}
function drafts(owner:string):Draft[]{
  const result:Draft[]=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i)!;if(!key.startsWith(prefix(owner)))continue;
    const raw=JSON.parse(localStorage.getItem(key)!);
    if(typeof raw.text!=='string')throw new Error('Unreadable draft');
    const base=DailyNote.parse(raw.base);result.push({date:base.date,text:raw.text,base,key});
  }
  return result;
}
export function hasPendingNotes(owner:string){
  if(models.get(owner)?.hasPending())return true;
  try{return drafts(owner).length>0;}catch{return true;}
}
export function downloadPendingNotes(owner:string){
  let saved:Draft[]=[];try{saved=drafts(owner);}catch{ /* The live editor still offers its in-memory text. */ }
  const live=models.get(owner)?.pending()??[];
  const url=URL.createObjectURL(new Blob([JSON.stringify({format:'lowkkey.notes.drafts',drafts:[...saved,...live]},null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='lowkkey-notes-drafts.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function clearPendingNotes(owner:string){
  const keys:string[]=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i)!;if(key.startsWith(prefix(owner)))keys.push(key);}
  for(const key of keys)localStorage.removeItem(key);
  models.get(owner)?.discard();
}
const blank=(date:string):DailyNote=>({date,text:'',revision:0,updated_at:null});
export class NotesModel {
  entries=new Map<string,NoteEntry>();listeners=new Set<()=>void>();version=0;
  loaded=false;loading=false;error='';cursor:string|null=null;disposed=false;
  private timers=new Map<string,ReturnType<typeof setTimeout>>();
  private controllers=new Set<AbortController>();
  private refreshing=false;
  private mounts=0;
  private epoch=0;
  private draftKeys=new Map<string,Map<string,string>>();
  constructor(readonly owner:string){
    try{
      for(const draft of drafts(owner)){
        const prior=this.entries.get(draft.date);
        if(prior&&prior.text!==draft.text){prior.recovered.push(draft);continue;}
        const e=prior??this.entry(draft.date);e.server=draft.base;e.text=draft.text;e.dirty=true;
        const keys=this.draftKeys.get(draft.date)??new Map<string,string>();keys.set(draft.key,JSON.stringify({text:draft.text,base:draft.base}));this.draftKeys.set(draft.date,keys);
      }
    }catch{this.error='本机草稿暂时无法读取，请不要清除浏览器数据。';}
  }
  mount(){models.set(this.owner,this);this.mounts++;return()=>{this.mounts--;queueMicrotask(()=>{if(!this.mounts)this.dispose();});};}
  discard(){this.epoch++;for(const timer of this.timers.values())clearTimeout(timer);for(const controller of this.controllers)controller.abort();for(const e of this.entries.values()){e.text=e.server.text;e.dirty=false;e.conflict=null;e.recovered=[];e.localError=false;}this.draftKeys.clear();this.emit();}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  snapshot=()=>this.version;
  emit(){if(!this.disposed){this.version++;this.listeners.forEach(f=>f());}}
  entry(date:string){let e=this.entries.get(date);if(!e){e={server:blank(date),text:'',dirty:false,composing:false,saving:false,error:'',localError:false,conflict:null,recovered:[]};this.entries.set(date,e);}return e;}
  hasPending(){return [...this.entries.values()].some(e=>e.dirty||e.saving||e.recovered.length||e.localError);}
  pending(){return [...this.entries.values()].filter(e=>e.dirty||e.recovered.length).flatMap(e=>[{date:e.server.date,text:e.text,base:e.server},...e.recovered]);}
  private persist(e:NoteEntry){
    const key=prefix(this.owner)+clientId()+':'+e.server.date;
    try{const value=JSON.stringify({text:e.text,base:e.server});localStorage.setItem(key,value);const keys=this.draftKeys.get(e.server.date)??new Map<string,string>();keys.set(key,value);this.draftKeys.set(e.server.date,keys);e.localError=false;}
    catch{e.localError=true;}
  }
  private removeDraft(e:NoteEntry){
    try{for(const [key,value] of this.draftKeys.get(e.server.date)??[])if(localStorage.getItem(key)===value)localStorage.removeItem(key);this.draftKeys.delete(e.server.date);e.localError=false;}catch{e.localError=true;}
  }
  edit(date:string,text:string){
    const e=this.entry(date);e.text=text;e.dirty=e.text!==e.server.text;e.error=Array.from(text).length>NOTE_LIMIT?'超过 20,000 字，完整文字仍保留，请缩短后保存。':'';
    // Keep even an oversized paste intact, including its recoverable draft.
    if(e.dirty||e.recovered.length)this.persist(e);else this.removeDraft(e);
    this.emit();this.schedule(date);
  }
  composition(date:string,active:boolean){this.entry(date).composing=active;if(!active)this.schedule(date);}
  private schedule(date:string){clearTimeout(this.timers.get(date));this.timers.set(date,setTimeout(()=>{void this.save(date);},800));}
  private async request(path:string,init?:RequestInit){
    const epoch=this.epoch,controller=new AbortController();this.controllers.add(controller);
    try{
      const headers=new Headers(init?.headers);headers.set('X-Lowkkey-Account',this.owner);
      const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...init,headers,signal:controller.signal});
      const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error?.code??'unavailable'),{status:response.status});
      if(this.disposed||epoch!==this.epoch)throw new Error('cancelled');return value;
    }finally{this.controllers.delete(controller);}
  }
  private absorb(note:DailyNote){
    const e=this.entry(note.date);if(e.saving||e.composing||note.revision<e.server.revision)return;
    if(e.dirty){
      if(note.text===e.text){e.server=note;e.dirty=false;e.conflict=null;e.error='';this.removeDraft(e);}
      else if(note.revision!==e.server.revision){e.conflict=note;}
    }else{e.server=note;e.text=note.text;e.conflict=null;}
  }
  async refresh(today:string){
    if(this.disposed||this.refreshing)return;this.refreshing=true;this.loading=true;this.emit();
    try{
      const page=NotesPage.parse(await this.request('/v1/notes?limit=30'));
      if(!this.loaded)this.cursor=page.next_cursor;
      const included=new Set(page.notes.map(n=>n.date));page.notes.forEach(n=>this.absorb(n));
      this.entry(today);
      // Fetch known missing dates too: an absent list row may be a cleared note.
      const missing=[...this.entries.keys()].filter(date=>!included.has(date));
      await Promise.all(missing.map(async date=>this.absorb(DailyNote.parse(await this.request('/v1/notes/'+date)))));
      this.loaded=true;this.error='';this.emit();this.flush(true);
    }catch{if(!this.disposed)this.error='暂时无法同步。文字保留在这里，请重试。';}
    finally{this.refreshing=false;this.loading=false;this.emit();}
  }
  async loadDate(date:string){
    if(this.disposed||this.entries.has(date))return;
    try{LocalDate.parse(date);this.absorb(DailyNote.parse(await this.request('/v1/notes/'+date)));this.emit();}
    catch{if(!this.disposed){this.error='暂时无法读取链接中的那一天，请稍后重新打开链接。';this.emit();}}
  }
  async earlier():Promise<Page|null>{
    if(!this.cursor||this.loading)return null;this.loading=true;this.emit();
    try{const page=NotesPage.parse(await this.request('/v1/notes?limit=30&before='+this.cursor));page.notes.forEach(n=>this.absorb(n));this.cursor=page.next_cursor;this.error='';return page;}
    catch{this.error='更早的记录暂时无法读取，请重试。';return null;}
    finally{this.loading=false;this.emit();}
  }
  async save(date:string,retry=false){
    const e=this.entry(date);clearTimeout(this.timers.get(date));
    if((e.error&&!retry)||this.disposed||!this.loaded||!e.dirty||e.saving||e.composing||e.conflict||e.recovered.length||Array.from(e.text).length>NOTE_LIMIT)return;
    const epoch=this.epoch,text=e.text,revision=e.server.revision;e.saving=true;e.error='';this.emit();
    try{
      const saved=DailyNote.parse(await this.request('/v1/notes/'+date,{method:'PUT',headers:{'Content-Type':'application/json','X-Lowkkey-Account':this.owner},body:JSON.stringify({text,revision})}));
      e.server=saved;e.dirty=e.text!==saved.text;e.conflict=null;
      if(e.dirty)this.persist(e);else this.removeDraft(e);
      window.dispatchEvent(new Event('lowkkey-notes-saved'));
    }catch(cause){
      if(this.disposed||epoch!==this.epoch)return;
      if((cause as {status?:number}).status===409){
        try{e.conflict=DailyNote.parse(await this.request('/v1/notes/'+date));}catch{e.error='无法读取另一份内容，请重试。';}
      }else e.error=(cause as {status?:number}).status===401?'登录已过期，草稿保留在本机；重新登录后继续。':'未能同步，草稿保留在本机。';
    }finally{e.saving=false;this.emit();if(e.dirty&&!e.error&&!e.conflict&&!this.disposed)this.schedule(date);}
  }
  async resolve(date:string,choice:'local'|'remote'|Draft){
    const e=this.entry(date);
    try{
      // Refresh the version immediately before resolving; a subsequent race still gets a 409.
      const remote=DailyNote.parse(await this.request('/v1/notes/'+date));
      const text=choice==='remote'?remote.text:choice==='local'?e.text:choice.text;
      for(const draft of e.recovered){const keys=this.draftKeys.get(date)??new Map<string,string>();keys.set(draft.key,JSON.stringify({text:draft.text,base:draft.base}));this.draftKeys.set(date,keys);}
      e.recovered=[];e.server=remote;e.conflict=null;e.text=text;e.dirty=text!==remote.text;e.error='';
      if(e.dirty){this.persist(e);await this.save(date);}else this.removeDraft(e);this.emit();
    }catch{e.error='暂时无法确认版本，所有文字仍保留，请重试。';this.emit();}
  }
  flush(retry=false){for(const date of this.entries.keys())void this.save(date,retry);}
  dispose(){this.disposed=true;for(const timer of this.timers.values())clearTimeout(timer);for(const controller of this.controllers)controller.abort();this.listeners.clear();}
}
