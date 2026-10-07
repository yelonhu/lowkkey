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
  const main=page.querySelector<HTMLElement>('main');
  if(screen==='Ledger'){
    main!.dataset.scrollFrame='';
    page.querySelector<HTMLElement>('[data-bind="ledger-timeline"]')!.dataset.scrollRegion='';
  }else if(main)main.dataset.scrollRegion='';
  else if(screen==='Connect')(page.children[1] as HTMLElement).dataset.scrollRegion='';
  else if(screen==='Session'){
    const center=page.children[2] as HTMLElement,controls=page.children[3] as HTMLElement;
    center.dataset.sessionCenter='';controls.dataset.sessionControls='';
    const content=document.createElement('div');content.dataset.scrollRegion='session';content.dataset.nodeKey='session-scroll';
    while(page.children.length>1)content.append(page.children[1]);
    page.append(content);
  }
  else if(screen==='Debrief'){
    const middle=document.createElement('div');middle.dataset.scrollRegion='debrief';middle.dataset.nodeKey='debrief-scroll';
    while(page.children.length>2)middle.append(page.children[1]);
    page.insertBefore(middle,page.lastElementChild);
  }
}

export function observeViewport(shell:HTMLElement,host:HTMLElement,width:number,height:number){
  let frame=0;
  let keyboardScroll:{node:HTMLElement;top:number}[]|null=null;
  const resize=()=>{
    frame=0;
    const viewport=window.visualViewport,phone=width===390,scale=phone?1:Math.min(1,window.innerWidth/width);
    // Pinch zoom stays a browser operation; don't resize the app into it.
    const zoomed=!!viewport&&Math.abs(viewport.scale-1)>.01;
    const editable=document.activeElement?.matches('input,textarea,[contenteditable="true"]');
    const keyboard=!!viewport&&!zoomed&&!!editable&&window.innerHeight-viewport.height>120;
    if(keyboard&&!keyboardScroll)keyboardScroll=[...host.querySelectorAll<HTMLElement>('[data-scroll-region]')].map(node=>({node,top:node.scrollTop}));
    const available=width===390?(!zoomed&&viewport?viewport.height:window.innerHeight):height*scale;
    host.style.width=phone?`${Math.min(window.innerWidth,600)}px`:`${width}px`;host.style.height=`${available/scale}px`;host.style.transform=`scale(${scale})`;
    host.style.setProperty('--page-height',`${available/scale}px`);host.style.setProperty('--viewport-scale',String(scale));
    // One visual-viewport offset, on the shell only. Body remains fixed; never
    // scroll the whole document to reveal a footer input or resize into zoom.
    shell.style.height=`${available}px`;shell.style.top=keyboard?`${Math.max(0,viewport!.offsetTop)}px`:'0px';
    shell.dataset.keyboard=String(keyboard);shell.dataset.compact=String(available/scale<844);
    if(!keyboard&&keyboardScroll){for(const {node,top} of keyboardScroll)if(node.isConnected)node.scrollTop=top;keyboardScroll=null;}
    if(!zoomed&&window.scrollY!==0)window.scrollTo({top:0,left:0,behavior:'instant'});
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(resize);};
  resize();window.addEventListener('resize',schedule);window.addEventListener('pageshow',schedule);window.addEventListener('scroll',schedule);
  document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
  window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
  return()=>{
    cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('pageshow',schedule);window.removeEventListener('scroll',schedule);
    document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);
    window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);
  };
}
