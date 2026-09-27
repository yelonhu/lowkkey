import type { Screen } from './navigation.ts';

export const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const curve='cubic-bezier(0.32, 0.72, 0, 1)';
export class Motion {
  private animations:Animation[]=[];
  private cleanups:(()=>void)[]=[];
  settle(){for(const animation of this.animations)animation.cancel();this.animations=[];for(const cleanup of this.cleanups)cleanup();this.cleanups=[];}
  private play(node:Element,frames:Keyframe[],duration:number,delay=0){
    const animation=node.animate(frames,{duration,delay,easing:curve,fill:'backwards'});
    this.animations.push(animation);return animation.finished.catch(()=>{});
  }
  screen(host:HTMLElement,old:HTMLElement|null,next:HTMLElement,from:Screen|null,to:Screen,point:{x:number;y:number}|null){
    this.settle();if(!old||from===to)return;
    const training=from==='Main'&&to==='Session',returning=from==='Debrief'&&to==='Main';
    if(!training&&!returning){void this.play(next,[{opacity:0},{opacity:1}],160);return;}
    const outgoing=old.cloneNode(true) as HTMLElement;
    outgoing.classList.add('motion-outgoing');outgoing.inert=true;outgoing.setAttribute('aria-hidden','true');host.append(outgoing);
    const remove=()=>outgoing.remove();this.cleanups.push(remove);
    if(reducedMotion()){
      outgoing.style.zIndex='0';next.style.position='relative';next.style.zIndex='1';
      const restore=()=>{next.style.removeProperty('position');next.style.removeProperty('z-index');};this.cleanups.push(restore);
      void this.play(outgoing,[{opacity:1},{opacity:0}],200);
      void this.play(next,[{opacity:0},{opacity:1}],200).then(()=>{remove();restore();});return;
    }
    const rect=host.getBoundingClientRect(),scale=rect.width/host.offsetWidth;
    const anchor=next.querySelector<HTMLElement>('[data-bind="main-plan"]')?.lastElementChild?.getBoundingClientRect();
    const x=returning&&anchor?(anchor.left+anchor.width/2-rect.left)/scale:point?(point.x-rect.left)/scale:host.offsetWidth/2;
    const y=returning&&anchor?(anchor.top+anchor.height/2-rect.top)/scale:point?(point.y-rect.top)/scale:host.offsetHeight*.75;
    const radius=Math.hypot(Math.max(x,host.offsetWidth-x),Math.max(y,host.offsetHeight-y));
    const circle=(r:number)=>`circle(${r}px at ${x}px ${y}px)`;
    if(training){
      outgoing.style.zIndex='0';next.style.position='relative';next.style.zIndex='1';
      void this.play(outgoing,[{transform:'scale(1)',opacity:1,filter:'blur(0)'},{transform:'scale(.92)',opacity:.35,filter:'blur(3px)'}],380);
      const restore=()=>{next.style.removeProperty('position');next.style.removeProperty('z-index');};
      void this.play(next,[{clipPath:circle(0),offset:0},{clipPath:circle(radius),offset:380/620},{clipPath:circle(radius),offset:1}],620).then(()=>{remove();restore();});
      const center=next.firstElementChild?.children[2];
      if(center?.children[1])void this.play(center.children[1],[{transform:'translateY(12px)',opacity:0},{transform:'translateY(0)',opacity:1}],240,380);
      const bar=center?.querySelector('svg[role="img"]');if(bar)void this.play(bar,[{opacity:0},{opacity:1}],160,460);
      this.cleanups.push(restore);
    }else{
      outgoing.style.zIndex='1';
      void this.play(next,[{transform:'scale(.92)',opacity:.35,filter:'blur(3px)'},{transform:'scale(1)',opacity:1,filter:'blur(0)'}],480);
      void this.play(outgoing,[{clipPath:circle(radius)},{clipPath:circle(0)}],480).then(remove);
    }
  }
  sheet(layer:HTMLElement,opening:boolean,done?:()=>void){
    this.settle();const dialog=layer.querySelector('[role="dialog"]');if(!dialog){done?.();return;}
    if(reducedMotion()){done?.();return;}
    const frames=opening?[{transform:'translateY(100%)'},{transform:'translateY(0)'}]:[{transform:'translateY(0)'},{transform:'translateY(100%)'}];
    void this.play(dialog,frames,320).then(()=>done?.());
    const scrim=layer.querySelector('[data-scrim]');if(scrim)void this.play(scrim,opening?[{opacity:0},{opacity:1}]:[{opacity:1},{opacity:0}],320);
  }
}
