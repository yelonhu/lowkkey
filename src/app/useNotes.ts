import { useEffect,useMemo,useSyncExternalStore } from 'react';
import { NotesModel } from './notes-model.ts';
const noop=()=>()=>{};
const zero=()=>0;
export function useNotes(owner:string|undefined,today:string|undefined,active:boolean){
  const model=useMemo(()=>owner?new NotesModel(owner):null,[owner]);
  useSyncExternalStore(model?.subscribe??noop,model?.snapshot??zero);
  useEffect(()=>model?.mount(),[model]);
  useEffect(()=>{
    if(!model||!today)return;
    const resume=()=>{if(document.visibilityState!=='hidden'&&(active||model.hasPending()))void model.refresh(today);};
    const hide=()=>{if(document.visibilityState==='hidden')model.flush();else resume();};
    const leaving=(event:BeforeUnloadEvent)=>{if(model.hasPending()){model.flush();event.preventDefault();event.returnValue='';}};
    const storage=(event:StorageEvent)=>{if(event.key==='lowkkey-signout')model.dispose();};
    window.addEventListener('focus',resume);window.addEventListener('online',resume);window.addEventListener('pageshow',resume);window.addEventListener('beforeunload',leaving);window.addEventListener('storage',storage);document.addEventListener('visibilitychange',hide);
    resume();if(!active)model.flush();
    return()=>{window.removeEventListener('focus',resume);window.removeEventListener('online',resume);window.removeEventListener('pageshow',resume);window.removeEventListener('beforeunload',leaving);window.removeEventListener('storage',storage);document.removeEventListener('visibilitychange',hide);};
  },[model,today,active]);
  return model;
}
