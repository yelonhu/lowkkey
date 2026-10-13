import type { StateResponse } from '@lowkkey/protocol';
import { strengthSeries } from '@lowkkey/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { screens, type Screen } from './navigation.ts';

export const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
export const ease='cubic-bezier(.22,.8,.25,1)';
export function animate(element:Element|null,frames:Keyframe[],duration=240){
  if(!element||reducedMotion())return null;
  return element.animate(frames,{duration,easing:ease});
}

// Native summaries keep keyboard semantics. Measure only the two endpoints;
// interrupting starts at the currently painted height instead of queuing work.
export function useMotion(){
  useEffect(()=>{
    const running=new Map<HTMLDetailsElement,{animation:Animation;opening:boolean}>();
    const pointer=()=>{document.documentElement.dataset.input='pointer';};
    const key=(event:KeyboardEvent)=>{if(event.key==='Tab')document.documentElement.dataset.input='keyboard';};
    const click=(event:MouseEvent)=>{
      const summary=event.target instanceof Element?event.target.closest('summary'):null;
      const detail=summary?.parentElement;
      if(!(detail instanceof HTMLDetailsElement)||event.defaultPrevented||reducedMotion())return;
      if(event.target instanceof Element&&event.target.closest('a,button,input,select'))return;
      event.preventDefault();
      const previous=running.get(detail),opening=previous?!previous.opening:!detail.open;
      const start=detail.getBoundingClientRect().height;
      previous?.animation.cancel();
      detail.open=true;
      const end=opening?detail.getBoundingClientRect().height:summary!.getBoundingClientRect().height+parseFloat(getComputedStyle(detail).borderTopWidth)+parseFloat(getComputedStyle(detail).borderBottomWidth);
      detail.dataset.expanded=String(opening);
      detail.style.overflow='hidden';
      const animation=detail.animate([{height:start+'px'},{height:end+'px'}],{duration:240,easing:ease});
      running.set(detail,{animation,opening});
      animation.onfinish=()=>{if(running.get(detail)?.animation!==animation)return;detail.open=opening;detail.style.overflow='';delete detail.dataset.expanded;running.delete(detail);};
    };
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const settle=()=>{for(const [detail,{animation,opening}] of running){animation.cancel();detail.open=opening;detail.style.overflow='';delete detail.dataset.expanded;}running.clear();};
    document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',key,true);document.addEventListener('click',click);
    media.addEventListener('change',settle);
    return()=>{settle();document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',key,true);document.removeEventListener('click',click);media.removeEventListener('change',settle);};
  },[]);
}

export function PageTabs({screen}:{screen:Screen}){
  const ref=useRef<HTMLElement>(null),[indicator,setIndicator]=useState({left:0,width:0});
  useLayoutEffect(()=>{
    const nav=ref.current!;
    const update=()=>{const link=nav.querySelector<HTMLElement>('[aria-current]');if(link)setIndicator({left:link.offsetLeft,width:link.offsetWidth});};
    update();const observer=new ResizeObserver(update);observer.observe(nav);for(const link of nav.children)observer.observe(link);
    void document.fonts.ready.then(update);return()=>observer.disconnect();
  },[screen]);
  return <nav ref={ref} className="wrap tabs" aria-label="页面">{screens.map(key=><a key={key} href={'#'+key} aria-current={screen===key?'page':undefined}>{key}</a>)}<span className="tab-indicator" aria-hidden="true" style={{transform:`translateX(${indicator.left}px)`,width:indicator.width,opacity:indicator.width?1:0}}/></nav>;
}

export function useFactMotion(revision:unknown,screen:Screen){
  const values=useRef(new WeakMap<Element,string>());
  useEffect(()=>{
    if(screen==='notes')return;
    const animations:Animation[]=[];
    for(const node of document.querySelectorAll(`#v-${screen} .cl, #v-${screen} .bw, #v-${screen} .lift .v`)){
      const text=node.textContent??'',prior=values.current.get(node);
      if(prior!==undefined&&prior!==text){const animation=animate(node,[{opacity:.5},{opacity:1}],180);if(animation)animations.push(animation);}
      values.current.set(node,text);
    }
    return()=>animations.forEach(a=>a.cancel());
  },[revision,screen]);
}

// Establish a quiet baseline on load. Only a genuinely higher best arriving
// during this visit can be highlighted; refreshes and tab changes don't replay it.
export function useRecordMotion(facts:StateResponse|null,screen:Screen){
  const history=useRef<{owner:string;best:Map<string,number>;seen:Set<string>;pending:Map<string,string>}|null>(null);
  useEffect(()=>{
    if(!facts)return;
    const series=strengthSeries(facts),fresh=history.current?.owner!==facts.accountId;
    if(fresh)history.current={owner:facts.accountId,best:new Map(),seen:new Set(),pending:new Map()};
    const state=history.current!;
    for(const line of series){
      if(!line.best)continue;
      const id=line.ex+':'+line.best.date+':'+line.best.e1rm,previous=state.best.get(line.ex);
      if(!fresh&&previous!==undefined&&line.best.e1rm>previous&&!state.seen.has(id))state.pending.set(line.ex,id);
      state.best.set(line.ex,line.best.e1rm);state.seen.add(id);
    }
    if(screen!=='recap')return;
    for(const [ex] of state.pending){
      const node=document.querySelector(`#v-recap .lift[data-ex="${ex}"]`);
      if(node){animate(node,[{backgroundColor:'transparent'},{backgroundColor:getComputedStyle(node).getPropertyValue('--wash')},{backgroundColor:'transparent'}],800);state.pending.delete(ex);}
    }
  },[facts,screen]);
}
