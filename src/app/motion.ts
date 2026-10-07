import type { Screen } from './navigation.ts';

export const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const motionCurve='cubic-bezier(0.32, 0.72, 0, 1)';
export class Motion {
  private animations=new Set<Animation>();
  private cleanups=new Set<()=>void>();
  private generation=0;
  settle(){
    this.generation++;
    for(const animation of this.animations)animation.cancel();this.animations.clear();
    for(const cleanup of this.cleanups)cleanup();this.cleanups.clear();
  }
  private play(node:Element,frames:Keyframe[],duration:number,delay=0){
    const generation=this.generation,segmented=frames.some(frame=>frame.offset!==undefined);
    // Explicit timeline offsets use easing per segment so 380 ms stays 380 ms.
    const animation=node.animate(segmented?frames.map(frame=>({...frame,easing:motionCurve})):frames,{duration,delay,easing:segmented?'linear':motionCurve,fill:'backwards'});
    this.animations.add(animation);
    return animation.finished.then(()=>generation===this.generation,()=>false).finally(()=>this.animations.delete(animation));
  }
  screen(host:HTMLElement,old:HTMLElement|null,next:HTMLElement,from:Screen|null,to:Screen,point:{x:number;y:number}|null){
    this.settle();if(!old){
      if(to==='Main')for(const [index,node] of [...next.querySelectorAll('main > *')].entries())void this.play(node,reducedMotion()?[{opacity:0},{opacity:1}]:[{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],reducedMotion()?120:280,reducedMotion()?0:Math.min(index,3)*30);
      return;
    }if(from===to)return;
    const training=from==='Main'&&to==='Session',returning=from==='Debrief'&&to==='Main';
    if(!training&&!returning){if(!reducedMotion())void this.play(next,[{opacity:0},{opacity:1}],160);return;}
    // Reuse the retained outgoing page instead of cloning every control and SVG.
    const outgoing=old,wasInert=old.inert,wasHidden=old.getAttribute('aria-hidden');
    outgoing.classList.add('motion-outgoing');outgoing.inert=true;outgoing.setAttribute('aria-hidden','true');host.append(outgoing);
    const remove=()=>{
      outgoing.remove();outgoing.classList.remove('motion-outgoing');outgoing.style.removeProperty('z-index');outgoing.inert=wasInert;
      if(wasHidden===null)outgoing.removeAttribute('aria-hidden');else outgoing.setAttribute('aria-hidden',wasHidden);
    };
    const restore=()=>{next.removeAttribute('data-motion-above');};
    this.cleanups.add(remove);this.cleanups.add(restore);
    const finish=(completed:boolean)=>{if(completed){remove();restore();this.cleanups.delete(remove);this.cleanups.delete(restore);}};
    if(reducedMotion()){
      outgoing.style.zIndex='0';next.setAttribute('data-motion-above','');
      void this.play(outgoing,[{opacity:1},{opacity:0}],200);
      void this.play(next,[{opacity:0},{opacity:1}],200).then(finish);return;
    }
    const rect=host.getBoundingClientRect(),scale=rect.width/host.offsetWidth;
    const anchor=next.querySelector<HTMLElement>('[data-bind="main-plan"]')?.lastElementChild?.getBoundingClientRect();
    const x=returning&&anchor?(anchor.left+anchor.width/2-rect.left)/scale:point?(point.x-rect.left)/scale:host.offsetWidth/2;
    const y=returning&&anchor?(anchor.top+anchor.height/2-rect.top)/scale:point?(point.y-rect.top)/scale:host.offsetHeight*.75;
    const radius=Math.hypot(Math.max(x,host.offsetWidth-x),Math.max(y,host.offsetHeight-y));
    const circle=(r:number)=>`circle(${r}px at ${x}px ${y}px)`;
    if(training){
      outgoing.style.zIndex='0';next.setAttribute('data-motion-above','');
      void this.play(outgoing,[{transform:'scale(1)',opacity:1,filter:'blur(0)'},{transform:'scale(.92)',opacity:.35,filter:'blur(3px)'}],380);
      void this.play(next,[{clipPath:circle(0),offset:0},{clipPath:circle(radius),offset:380/620},{clipPath:circle(radius),offset:1}],620).then(finish);
      const center=next.querySelector('[data-session-center]');
      if(center?.children[1])void this.play(center.children[1],[{transform:'translateY(12px)',opacity:0},{transform:'translateY(0)',opacity:1}],240,380);
      const bar=center?.querySelector('svg[role="img"]');if(bar)void this.play(bar,[{opacity:0},{opacity:1}],160,460);
    }else{
      outgoing.style.zIndex='1';
      void this.play(next,[{transform:'scale(.92)',opacity:.35,filter:'blur(3px)'},{transform:'scale(1)',opacity:1,filter:'blur(0)'}],480);
      void this.play(outgoing,[{clipPath:circle(radius)},{clipPath:circle(0)}],480).then(finish);
    }
  }
  holdSheet(layer:HTMLElement,background:HTMLElement|null){
    const dialog=layer.querySelector<HTMLElement>('[role="dialog"]');if(!dialog)return 0;
    const transform=getComputedStyle(dialog).transform,y=transform==='none'?0:new DOMMatrixReadOnly(transform).m42;
    const scrim=layer.querySelector<HTMLElement>('[data-scrim]'),opacity=scrim?getComputedStyle(scrim).opacity:'1';
    const depth=background?getComputedStyle(background).scale:'1';this.settle();background?.style.setProperty('--sheet-depth',depth==='none'?'1':depth);dialog.style.setProperty('--sheet-y',`${y}px`);scrim?.style.setProperty('--sheet-scrim-opacity',opacity);
    return y;
  }
  sheet(layer:HTMLElement,opening:boolean,done?:()=>void,background?:HTMLElement|null){
    const dialog=layer.querySelector<HTMLElement>('[role="dialog"]');if(!dialog){done?.();return;}
    const held=!!dialog.style.getPropertyValue('--sheet-y');
    const from=opening&&!held?'translateY(100%)':getComputedStyle(dialog).transform;
    const scrim=layer.querySelector<HTMLElement>('[data-scrim]'),opacity=opening&&!held?0:scrim?Number(getComputedStyle(scrim).opacity):1;
    const depth=background?getComputedStyle(background).scale:'1';
    this.settle();
    if(background)background.style.setProperty('--sheet-depth',opening&&!reducedMotion()?'.96':'1');
    if(background&&!reducedMotion())void this.play(background,[{scale:depth==='none'?'1':depth},{scale:opening?'.96':'1'}],320);
    const clear=()=>{dialog.style.removeProperty('--sheet-y');scrim?.style.removeProperty('--sheet-scrim-opacity');};
    if(reducedMotion()){clear();done?.();return;}
    const finish=()=>{clear();done?.();};
    if(!opening)this.cleanups.add(finish);
    // Finish callbacks only run for this generation, never after a cancellation.
    void this.play(dialog,[{transform:from},{transform:opening?'translateY(0)':'translateY(100%)'}],320).then(completed=>{if(completed){finish();this.cleanups.delete(finish);}});
    if(scrim)void this.play(scrim,[{opacity},{opacity:opening?1:0}],320);
  }
}
