import { useEffect,useRef,useState } from 'react';
import { screenFromHash,screens,targetFromHash } from './navigation.ts';
import { useShowroom } from './useShowroom.ts';
import { PlanView } from './PlanView.tsx';
import { RecapView,themeNames } from './RecapView.tsx';
import { WeightView } from './WeightView.tsx';
import { LogView } from './LogView.tsx';
import { CustomerAccount,LoginGate } from './CustomerAccount.tsx';
import { applyPageTheme } from './viewport.ts';
export function App(){
  const chamber=useShowroom(),[screen,setScreen]=useState(screenFromHash),[settings,setSettings]=useState(location.hash==='#settings'),[target,setTarget]=useState(targetFromHash),[focus,setFocus]=useState<string|null>(null),trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{const route=()=>{setScreen(screenFromHash());setTarget(targetFromHash());if(location.hash==='#settings')setSettings(true);window.scrollTo({top:0});};window.addEventListener('hashchange',route);return()=>window.removeEventListener('hashchange',route);},[]);
  useEffect(()=>{document.documentElement.dataset.theme=chamber.state?.theme_state.active??'ink';applyPageTheme();const media=matchMedia('(prefers-color-scheme:dark)');media.addEventListener('change',applyPageTheme);return()=>media.removeEventListener('change',applyPageTheme);},[chamber.state?.theme_state.active]);
  useEffect(()=>{if(!target||!chamber.state)return;const element=document.getElementById(target);if(element instanceof HTMLDetailsElement)element.open=true;element?.scrollIntoView({block:'start'});},[target,screen,chamber.state]);
  if(chamber.auth!=='ready'||!chamber.state)return <LoginGate chamber={chamber}/>;
  const facts=chamber.state,today=facts.today;
  return <><div className="showroom-content" inert={settings}><div className="wrap brandrow"><button ref={trigger} className="brand" aria-label="lowkkey，打开设置" aria-haspopup="dialog" aria-expanded={settings} onClick={()=>setSettings(true)}>lowkkey</button><div className="themes" role="group" aria-label="主题">{(['ink','gold','pearl'] as const).map((theme,i)=><button key={theme} data-t={theme} title={themeNames[theme]+' · '+['日常','庆祝','突破'][i]} aria-label={themeNames[theme]+' · '+['日常','庆祝','突破'][i]} aria-pressed={facts.theme_state.active===theme} disabled={chamber.themeBusy} onClick={()=>void chamber.setTheme(theme)}/>)}</div></div><div className="navbar"><nav className="wrap tabs" aria-label="页面">{screens.map(key=><a key={key} href={'#'+key} aria-current={screen===key?'page':undefined}>{key}</a>)}</nav></div>{chamber.error&&<div className="wrap connection-notice" role="alert">{chamber.error}<button onClick={()=>void chamber.refresh()}>重试</button></div>}<main className={'wrap pg'+(screen==='next'?' next':'')} id={'v-'+screen}>{screen==='next'?<PlanView facts={facts} today={today}/>:screen==='recap'?<RecapView facts={facts} today={today} focus={focus} setFocus={setFocus} setTheme={theme=>void chamber.setTheme(theme)}/>:screen==='body'?<WeightView facts={facts} today={today}/>:<LogView facts={facts}/>}</main></div>{settings&&<CustomerAccount chamber={chamber} onClose={()=>setSettings(false)} returnFocusTo={trigger.current}/>}</>;
}
