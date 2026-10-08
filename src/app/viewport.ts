import type { Screen } from './navigation.ts';

export function applyPageTheme(screen:Screen,shell?:HTMLElement|null){
  const dark=screen==='Session'||screen==='Debrief',color=dark?'#000000':'#F1F1EF';
  document.documentElement.dataset.theme=dark?'dark':'light';
  if(shell)shell.dataset.theme=document.documentElement.dataset.theme;
  for(const node of [document.documentElement,document.body,document.getElementById('root')])if(node)node.style.backgroundColor=color;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',color);
}

export function observeViewport(shell:HTMLElement,host:HTMLElement,screen:Screen){
  const width=screen==='Transition'?1160:screen==='Icon'?512:390;
  const height=screen==='Transition'?840:screen==='Icon'?512:844,phone=width===390;
  host.className=`prototype-host${phone?' phone':''}`;
  host.style.width=phone?'min(100%, 600px)':`${width}px`;
  host.style.height=phone?'100%':`${height}px`;
  host.style.setProperty('--page-height',phone?'100%':`${height}px`);
  let frame=0,keyboardScroll:{node:HTMLElement;top:number}[]|null=null;
  let safeBeforeKeyboard:{top:number;bottom:number;left:number;right:number}|null=null,orientationWidth=window.innerWidth;
  // Read env() in the window coordinate system; this node never paints.
  const safe=document.createElement('div');safe.className='viewport-safe-probe';safe.ariaHidden='true';shell.append(safe);
  const resize=()=>{
    frame=0;
    const viewport=window.visualViewport,scale=phone?1:Math.min(1,window.innerWidth/width),canvas=shell.getBoundingClientRect();
    const style=getComputedStyle(safe),rawSafe={top:parseFloat(style.paddingTop),bottom:parseFloat(style.paddingBottom),left:parseFloat(style.paddingLeft),right:parseFloat(style.paddingRight)};
    if(orientationWidth!==window.innerWidth){orientationWidth=window.innerWidth;safeBeforeKeyboard=null;}
    // Pinch zoom remains a browser operation, not a keyboard resize.
    const zoomed=!!viewport&&Math.abs(viewport.scale-1)>.01;
    const editable=document.activeElement?.matches('input,textarea,[contenteditable="true"]');
    const keyboard=!!viewport&&!zoomed&&!!editable&&canvas.height-viewport.height>120;
    if(!keyboard||!safeBeforeKeyboard)safeBeforeKeyboard=rawSafe;
    // A late first layout may resolve env() after focus. Accept a valid inset,
    // but never collapse a known inset during this keyboard/orientation session.
    else for(const edge of ['top','bottom','left','right'] as const)safeBeforeKeyboard[edge]=Math.max(safeBeforeKeyboard[edge],rawSafe[edge]);
    const inset=keyboard?safeBeforeKeyboard:rawSafe;
    if(keyboard&&!keyboardScroll)keyboardScroll=[...host.querySelectorAll<HTMLElement>('[data-scroll-region]')].map(node=>({node,top:node.scrollTop}));
    host.style.transform=phone?'none':`scale(${scale})`;
    host.style.setProperty('--viewport-scale',String(scale));
    // DOM rects and visualViewport offsets are layout-viewport coordinates.
    // Convert once to the canvas. Only padding changes; the page never moves.
    const clamp=(value:number)=>Math.max(0,Math.min(canvas.height,value));
    const visibleTop=keyboard?clamp(viewport!.offsetTop-canvas.top):0;
    const visibleBottom=keyboard?clamp(viewport!.offsetTop+viewport!.height-canvas.top):canvas.height;
    const frameTop=visibleTop+inset.top,frameBottom=keyboard?canvas.height-visibleBottom:inset.bottom;
    for(const [name,value] of Object.entries({'frame-top':frameTop,'frame-bottom':frameBottom,'frame-left':inset.left,'frame-right':inset.right,'visible-top':visibleTop,'visible-height':visibleBottom-visibleTop,'effective-safe-top':inset.top}))host.style.setProperty(`--${name}`,`${value}px`);
    shell.dataset.keyboard=String(keyboard);
    if(keyboard&&document.activeElement instanceof HTMLElement){
      const input=document.activeElement,region=input.closest<HTMLElement>('[data-scroll-region],[role="dialog"]');
      if(region){const field=input.getBoundingClientRect(),bounds=region.getBoundingClientRect();
        if(field.bottom>bounds.bottom-8)region.scrollTop+=field.bottom-bounds.bottom+8;
        else if(field.top<bounds.top+8)region.scrollTop-=bounds.top+8-field.top;
      }
    }
    if(!keyboard&&keyboardScroll){for(const {node,top} of keyboardScroll)if(node.isConnected)node.scrollTop=top;keyboardScroll=null;}
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(resize);};
  // Capture pre-keyboard insets at focus time, before WebKit coalesces resize frames.
  const focus=()=>{if(document.activeElement?.matches('input,textarea,[contenteditable="true"]')){cancelAnimationFrame(frame);resize();}else schedule();};
  const pointer=()=>{shell.dataset.inputModality='pointer';schedule();};
  const key=(event:KeyboardEvent)=>{if(event.key==='Tab')shell.dataset.inputModality='keyboard';};
  shell.dataset.inputModality='pointer';
  const observer=new ResizeObserver(schedule);observer.observe(shell);observer.observe(safe,{box:'border-box'});
  resize();window.addEventListener('resize',schedule);window.addEventListener('pageshow',schedule);window.addEventListener('scroll',schedule);
  document.addEventListener('focus',focus,true);document.addEventListener('focusout',schedule);document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key);
  window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
  return()=>{
    safe.remove();observer.disconnect();
    cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('pageshow',schedule);window.removeEventListener('scroll',schedule);
    document.removeEventListener('focus',focus,true);document.removeEventListener('focusout',schedule);document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);
    window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);
  };
}
