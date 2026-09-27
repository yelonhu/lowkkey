const controls='button,a[href],[role="button"],[role="radio"]';

// Pointer feedback belongs to the live control, independently of API/render work.
export function installPressFeedback(root:HTMLElement){
  let active:{node:HTMLElement;x:number;y:number;id:number}|null=null;
  let cancelled=false;
  const release=()=>{active?.node.removeAttribute('data-pressed');active=null;};
  const control=(target:EventTarget|null)=>{
    const node=target instanceof Element?target.closest<HTMLElement>(controls):null;
    return node&&root.contains(node)&&!node.closest('[inert],[aria-disabled="true"],:disabled')?node:null;
  };
  const down=(event:PointerEvent)=>{
    release();cancelled=false;
    if(!event.isPrimary||event.button!==0)return;
    const node=control(event.target);if(!node)return;
    active={node,x:event.clientX,y:event.clientY,id:event.pointerId};node.setAttribute('data-pressed','');
  };
  const move=(event:PointerEvent)=>{
    if(!active||active.id!==event.pointerId)return;
    if(Math.hypot(event.clientX-active.x,event.clientY-active.y)>8){cancelled=true;release();}
  };
  const cancel=()=>{cancelled=true;release();};
  const click=(event:MouseEvent)=>{if(cancelled&&event.detail>0){event.preventDefault();event.stopPropagation();}};
  const keydown=(event:KeyboardEvent)=>{
    if(!['Enter',' '].includes(event.key)||event.repeat)return;
    cancelled=false;const node=control(event.target);if(!node)return;
    release();active={node,x:0,y:0,id:-1};node.setAttribute('data-pressed','');
  };
  root.addEventListener('pointerdown',down);
  root.addEventListener('click',click,true);
  root.addEventListener('keydown',keydown);
  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',release);
  window.addEventListener('pointercancel',cancel);
  window.addEventListener('keyup',release);
  window.addEventListener('blur',cancel);
  document.addEventListener('visibilitychange',cancel);
  return()=>{
    release();root.removeEventListener('pointerdown',down);root.removeEventListener('click',click,true);root.removeEventListener('keydown',keydown);
    window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',cancel);
    window.removeEventListener('keyup',release);window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',cancel);
  };
}
