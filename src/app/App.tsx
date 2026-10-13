import { animate, PageTabs, useMotion, useFactMotion, useRecordMotion } from './motion.tsx';
import { useEffect,useLayoutEffect,useRef,useState } from 'react';
import { screenFromHash,screens,targetFromHash,type Screen } from './navigation.ts';
import { useShowroom } from './useShowroom.ts';
import { useNotes } from './useNotes.ts';
import { NotesView } from './NotesView.tsx';
import { PlanView } from './PlanView.tsx';
import { RecapView } from './RecapView.tsx';
import { WeightView } from './WeightView.tsx';
import { LogView } from './LogView.tsx';
import { CustomerAccount,LoginGate } from './CustomerAccount.tsx';
import { Onboarding,useProduct } from './Onboarding.tsx';
import { ConsentGate,PrivacyPage } from './Privacy.tsx';
import { applyPageTheme } from './viewport.ts';
import { SessionLoading } from './Welcome.tsx';
export function App(){
  if(location.pathname==='/privacy')return <PrivacyPage/>;
  if(import.meta.env.DEV&&location.pathname==='/__preview/login')return <LoginGate preview/>;
  return <Showroom/>;
}
function Showroom(){
  const chamber=useShowroom(),[screen,setScreen]=useState(screenFromHash),[settings,setSettings]=useState(location.hash==='#settings'),[target,setTarget]=useState(targetFromHash),[focus,setFocus]=useState<string|null>(null),trigger=useRef<HTMLButtonElement>(null);
  const notes=useNotes(chamber.auth==='ready'?chamber.state?.accountId:undefined,chamber.state?.today,screen==='notes');
  useMotion();
  useFactMotion(chamber.state,screen);
  useRecordMotion(chamber.state,screen);
  const positions=useRef<Partial<Record<Screen,number>>>({}),activeScreen=useRef(screen),visited=useRef(new Set<Screen>([screen]));
  const pageMotion=useRef<Animation|null>(null),lastPage=useRef<Screen|null>(null);
  visited.current.add(screen);
  useLayoutEffect(()=>{
    if(chamber.auth!=='ready'||!chamber.state)return;
    if(lastPage.current===screen)return;
    lastPage.current=screen;
    if(!target)window.scrollTo({top:positions.current[screen]??0,behavior:'instant'});
    pageMotion.current?.cancel();
    if(screen!=='notes')pageMotion.current=animate(document.getElementById('v-'+screen),[{opacity:.65,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}]);
  },[screen,chamber.auth,chamber.state,target]);
  const targetPositioned=useRef<string|null>(null);
  const awaitingFirstContent=useRef(false);
  const [starting,setStarting]=useState(location.hash==='#start');
  const product=useProduct(chamber.state?.accountId,chamber.refresh,starting);
  useEffect(()=>{
    if(!product.setup){awaitingFirstContent.current=false;return;}
    if(!product.setup.hasContent&&!product.setup.completedAt)awaitingFirstContent.current=true;
    else if(awaitingFirstContent.current&&location.hash!=='#settings'&&screen!=='notes'){awaitingFirstContent.current=false;const receipt=new URL(product.setup.firstViewUrl??'/#next',location.origin);if(receipt.origin===location.origin&&receipt.hash)location.hash=receipt.hash;setStarting(false);void chamber.refresh();}
  },[product.setup,chamber.refresh]);
  useEffect(()=>{if(location.hash!=='#settings'&&screen!=='notes'&&product.setup&&!product.setup.hasContent&&!product.setup.completedAt&&!product.setup.skippedAt)setStarting(true);},[product.setup]);
  useEffect(()=>{const route=()=>{targetPositioned.current=null;setStarting(location.hash==='#start');const next=screenFromHash();positions.current[activeScreen.current]=window.scrollY;activeScreen.current=next;setScreen(next);setTarget(targetFromHash());if(location.hash==='#settings')setSettings(true);};window.addEventListener('hashchange',route);return()=>window.removeEventListener('hashchange',route);},[]);
  useEffect(()=>{const saved=()=>{awaitingFirstContent.current=false;setStarting(false);void product.refresh();};window.addEventListener('lowkkey-notes-saved',saved);return()=>window.removeEventListener('lowkkey-notes-saved',saved);},[product.refresh]);
  useEffect(()=>{document.documentElement.dataset.theme=chamber.state?.theme_state.active??'ink';applyPageTheme();const media=matchMedia('(prefers-color-scheme:dark)');media.addEventListener('change',applyPageTheme);return()=>media.removeEventListener('change',applyPageTheme);},[chamber.state?.theme_state.active]);
  useEffect(()=>{if(!target||!chamber.state)return;const key=chamber.state.accountId+':'+target;if(targetPositioned.current===key)return;const element=document.getElementById(target);if(!element)return;if(element instanceof HTMLDetailsElement)element.open=true;element.scrollIntoView({block:'start'});targetPositioned.current=key;},[target,screen,chamber.state]);
  if(chamber.auth==='loading')return <SessionLoading error={chamber.error} retry={chamber.refresh}/>;
  if(chamber.auth==='consent')return <ConsentGate chamber={chamber}/>;
  if(chamber.auth!=='ready'||!chamber.state)return <LoginGate chamber={chamber}/>;
  if(!settings&&screen!=='notes'&&(starting||(!product.setup&&!chamber.state.sessions.length&&!chamber.state.plans.length&&!chamber.state.weights.length)))return <Onboarding product={product} onNotes={()=>{setStarting(false);location.hash='notes';}} onClose={()=>{setStarting(false);if(location.hash==='#start')location.hash='next';void chamber.refresh();}}/>;
  const facts=chamber.state,today=facts.today;
  return <><div className="showroom-content" inert={settings}><div className="wrap brandrow"><button ref={trigger} className="brand" aria-label="lowkkey，打开设置" aria-haspopup="dialog" aria-expanded={settings} onClick={()=>setSettings(true)}>lowkkey</button></div><div className="navbar"><PageTabs screen={screen}/></div>{chamber.error&&<div className="wrap connection-notice" role="alert">{chamber.error}<button onClick={()=>void chamber.refresh()}>重试</button></div>}{screen!=='notes'&&product.setup&&!product.setup.hasContent&&!product.setup.completedAt&&<div className="wrap setup-resume"><button onClick={()=>setStarting(true)}>继续连接 AI，开始第一段对话</button></div>}{screens.filter(key=>visited.current.has(key)).map(key=><main key={facts.accountId+key} hidden={key!==screen} className={'wrap pg'+(key==='next'?' next':'')} id={'v-'+key}>{key==='next'?<PlanView facts={facts} today={today}/>:key==='recap'?<RecapView facts={facts} today={today} focus={focus} setFocus={setFocus}/>:key==='body'?<WeightView facts={facts} today={today}/>:key==='notes'&&notes?<NotesView model={notes} today={today} target={screen==='notes'?target:null} active={screen==='notes'}/>:<LogView facts={facts}/>}</main>)}</div>{settings&&<CustomerAccount chamber={chamber} onConnect={()=>{setSettings(false);setStarting(true);location.hash='start';}} onClose={()=>setSettings(false)} returnFocusTo={trigger.current}/>}</>;
}
