import { useEffect,useRef,useState } from 'react';
import { screenFromHash,screens,targetFromHash } from './navigation.ts';
import { useShowroom } from './useShowroom.ts';
import { useNotes } from './useNotes.ts';
import { NotesView } from './NotesView.tsx';
import { PlanView } from './PlanView.tsx';
import { RecapView,themeNames } from './RecapView.tsx';
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
  const awaitingFirstContent=useRef(false);
  const [starting,setStarting]=useState(location.hash==='#start');
  const product=useProduct(chamber.state?.accountId,chamber.refresh,starting);
  useEffect(()=>{
    if(!product.setup){awaitingFirstContent.current=false;return;}
    if(!product.setup.hasContent&&!product.setup.completedAt)awaitingFirstContent.current=true;
    else if(awaitingFirstContent.current&&location.hash!=='#settings'&&screen!=='notes'){awaitingFirstContent.current=false;const receipt=new URL(product.setup.firstViewUrl??'/#next',location.origin);if(receipt.origin===location.origin&&receipt.hash)location.hash=receipt.hash;setStarting(false);void chamber.refresh();}
  },[product.setup,chamber.refresh]);
  useEffect(()=>{if(location.hash!=='#settings'&&screen!=='notes'&&product.setup&&!product.setup.hasContent&&!product.setup.completedAt&&!product.setup.skippedAt)setStarting(true);},[product.setup]);
  useEffect(()=>{const route=()=>{setStarting(location.hash==='#start');setScreen(screenFromHash());setTarget(targetFromHash());if(location.hash==='#settings')setSettings(true);window.scrollTo({top:0});};window.addEventListener('hashchange',route);return()=>window.removeEventListener('hashchange',route);},[]);
  useEffect(()=>{const saved=()=>{awaitingFirstContent.current=false;setStarting(false);void product.refresh();};window.addEventListener('lowkkey-notes-saved',saved);return()=>window.removeEventListener('lowkkey-notes-saved',saved);},[product.refresh]);
  useEffect(()=>{document.documentElement.dataset.theme=chamber.state?.theme_state.active??'ink';applyPageTheme();const media=matchMedia('(prefers-color-scheme:dark)');media.addEventListener('change',applyPageTheme);return()=>media.removeEventListener('change',applyPageTheme);},[chamber.state?.theme_state.active]);
  useEffect(()=>{if(!target||!chamber.state)return;const element=document.getElementById(target);if(element instanceof HTMLDetailsElement)element.open=true;element?.scrollIntoView({block:'start'});},[target,screen,chamber.state]);
  if(chamber.auth==='loading')return <SessionLoading error={chamber.error} retry={chamber.refresh}/>;
  if(chamber.auth==='consent')return <ConsentGate chamber={chamber}/>;
  if(chamber.auth!=='ready'||!chamber.state)return <LoginGate chamber={chamber}/>;
  if(!settings&&screen!=='notes'&&(starting||(!product.setup&&!chamber.state.sessions.length&&!chamber.state.plans.length&&!chamber.state.weights.length)))return <Onboarding product={product} onNotes={()=>{setStarting(false);location.hash='notes';}} onClose={()=>{setStarting(false);if(location.hash==='#start')location.hash='next';void chamber.refresh();}}/>;
  const facts=chamber.state,today=facts.today;
  return <><div className="showroom-content" inert={settings}><div className="wrap brandrow"><button ref={trigger} className="brand" aria-label="lowkkey，打开设置" aria-haspopup="dialog" aria-expanded={settings} onClick={()=>setSettings(true)}>lowkkey</button><div className="themes" role="group" aria-label="主题">{(['ink','gold','pearl'] as const).map((theme,i)=><button key={theme} data-t={theme} title={themeNames[theme]+' · '+['日常','庆祝','突破'][i]} aria-label={themeNames[theme]+' · '+['日常','庆祝','突破'][i]} aria-pressed={facts.theme_state.active===theme} disabled={chamber.themeBusy} onClick={()=>void chamber.setTheme(theme)}/>)}</div></div><div className="navbar"><nav className="wrap tabs" aria-label="页面">{screens.map(key=><a key={key} href={'#'+key} aria-current={screen===key?'page':undefined}>{key}</a>)}</nav></div>{chamber.error&&<div className="wrap connection-notice" role="alert">{chamber.error}<button onClick={()=>void chamber.refresh()}>重试</button></div>}{screen!=='notes'&&product.setup&&!product.setup.hasContent&&!product.setup.completedAt&&<div className="wrap setup-resume"><button onClick={()=>setStarting(true)}>继续连接 AI，开始第一段对话</button></div>}<main className={'wrap pg'+(screen==='next'?' next':'')} id={'v-'+screen}>{screen==='next'?<PlanView facts={facts} today={today}/>:screen==='recap'?<RecapView facts={facts} today={today} focus={focus} setFocus={setFocus} setTheme={theme=>void chamber.setTheme(theme)}/>:screen==='body'?<WeightView facts={facts} today={today}/>:screen==='notes'&&notes?<NotesView model={notes} today={today} target={target}/>:<LogView facts={facts}/>}</main></div>{settings&&<CustomerAccount chamber={chamber} onConnect={()=>{setSettings(false);setStarting(true);location.hash='start';}} onClose={()=>setSettings(false)} returnFocusTo={trigger.current}/>}</>;
}
