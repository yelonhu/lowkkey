import type { Screen } from './navigation.ts';

export function applyPageTheme(screen:Screen){
  const dark=screen==='Session'||screen==='Debrief',color=dark?'#000000':'#F1F1EF';
  document.documentElement.dataset.theme=dark?'dark':'light';
  for(const node of [document.documentElement,document.body,document.getElementById('root')])if(node)node.style.backgroundColor=color;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',color);
}

// Mark existing handoff regions. The debrief's nonvisual flex wrapper retains
// its header, footer and original spacing while making only the middle scroll.
export function prepareViewport(node:HTMLElement,screen:Screen){
  const page=node.firstElementChild as HTMLElement;
  if(screen==='Transition'||screen==='Icon')return;
  page.dataset.pageFrame='';
  const main=page.querySelector<HTMLElement>('main');
  if(screen==='Ledger'){
    main!.dataset.scrollFrame='';
    page.querySelector<HTMLElement>('[data-bind="ledger-timeline"]')!.dataset.scrollRegion='';
  }else if(main){
    main.dataset.scrollRegion='';
    if(screen==='Main'){
      page.dataset.docked='';
      const dock=page.lastElementChild as HTMLElement;
      dock.dataset.bottomDock='main';
      const action=page.querySelector<HTMLElement>('[data-bind="main-plan"]')?.lastElementChild as HTMLElement|null;
      if(action){action.dataset.trainingAction='';dock.prepend(action);}
    }
  }
  else if(screen==='Connect')(page.children[1] as HTMLElement).dataset.scrollRegion='';
  else if(screen==='Session'){
    const center=page.querySelector<HTMLElement>('[data-session-part="center"]')!,controls=page.querySelector<HTMLElement>('[data-session-part="controls"]')!;
    center.dataset.sessionCenter='';controls.dataset.sessionControls='';
    page.dataset.docked='';
    const dock=document.createElement('div');dock.dataset.bottomDock='session';dock.dataset.nodeKey='session-dock';
    for(const action of controls.querySelectorAll(':scope > .extra-set-button,:scope > [data-session-part="submit"]'))dock.append(action);
    const content=document.createElement('div');content.dataset.scrollRegion='session';content.dataset.nodeKey='session-scroll';
    while(page.children.length>1)content.append(page.children[1]);
    page.append(content,dock);
  }
  else if(screen==='Debrief'){
    const middle=document.createElement('div');middle.dataset.scrollRegion='debrief';middle.dataset.nodeKey='debrief-scroll';
    while(page.children.length>2)middle.append(page.children[1]);
    page.insertBefore(middle,page.lastElementChild);
  }
}

export function observeViewport(shell:HTMLElement,host:HTMLElement,width:number,height:number){
  let frame=0,keyboardScroll:{node:HTMLElement;top:number}[]|null=null;
  let safeBeforeKeyboard:{top:number;bottom:number;left:number;right:number}|null=null,orientationWidth=window.innerWidth;
  const mode=new URLSearchParams(location.search).get('viewport');
  const diagnostic=mode==='1'||(__LAYOUT_DIAGNOSTICS__&&mode!=='0');
  // Untransformed probes share the window coordinate system. They never paint.
  const safe=document.createElement('div');safe.className='viewport-safe-probe';safe.ariaHidden='true';shell.append(safe);
  const probes=diagnostic?['dvh','inset'].map(mode=>{const node=document.createElement('div');node.className=`viewport-probe viewport-probe-${mode}`;node.ariaHidden='true';shell.append(node);return node;}):[];
  const copy=diagnostic?document.createElement('button'):null;
  if(copy){
    copy.type='button';copy.className='viewport-diagnostic';copy.textContent='复制布局诊断';
    // Preserve the keyboard and its geometry while copying a diagnostic.
    copy.onpointerdown=event=>event.preventDefault();
    copy.onclick=async()=>{
      resize();
      const report=document.documentElement.dataset.viewport??'';
      try{await navigator.clipboard.writeText(report);copy.textContent='诊断已复制';}
      catch{const field=document.createElement('textarea');field.className='viewport-report';field.readOnly=true;field.value=report;field.setAttribute('aria-label','布局诊断报告');shell.append(field);field.focus();field.select();field.onblur=()=>field.remove();}
    };
    shell.append(copy);
  }
  const resize=()=>{
    frame=0;
    const viewport=window.visualViewport,phone=width===390,scale=phone?1:Math.min(1,window.innerWidth/width),canvas=shell.getBoundingClientRect();
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
    host.style.width=phone?'min(100%, 600px)':`${width}px`;host.style.height=phone?'100%':`${height}px`;host.style.transform=phone?'none':`scale(${scale})`;
    host.style.setProperty('--page-height',phone?'100%':`${height}px`);host.style.setProperty('--viewport-scale',String(scale));
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
    if(diagnostic){
      const page=host.querySelector<HTMLElement>('.screen:not(.motion-outgoing) [data-page-frame]');
      const rect=(node:Element|null)=>node?.getBoundingClientRect().toJSON()??null;
      const dock=page?.querySelector('[data-bottom-dock]')??null;
      document.documentElement.dataset.viewport=JSON.stringify({version:__BUILD_SHA__,standalone:window.matchMedia('(display-mode: standalone)').matches,screen:[window.screen.width,window.screen.height],inner:[window.innerWidth,window.innerHeight],document:[document.documentElement.clientWidth,document.documentElement.clientHeight],scroll:[window.scrollX,window.scrollY],visual:viewport?{height:viewport.height,top:viewport.offsetTop,scale:viewport.scale}:null,keyboard,rawSafe,effectiveSafe:inset,visibleInCanvas:{top:visibleTop,bottom:visibleBottom},shell:rect(shell),host:rect(host),page:rect(page),header:rect(page?.firstElementChild??null),content:rect(page?.querySelector('[data-scroll-region]')??null),dock:rect(dock),bottomControl:rect(dock?.lastElementChild??null),probes:{dvh:rect(probes[0]),inset:rect(probes[1])},theme:document.documentElement.dataset.theme});
    }
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
    copy?.remove();safe.remove();probes.forEach(node=>node.remove());shell.querySelector('.viewport-report')?.remove();observer.disconnect();
    cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('pageshow',schedule);window.removeEventListener('scroll',schedule);
    document.removeEventListener('focus',focus,true);document.removeEventListener('focusout',schedule);document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);
    window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);
  };
}
