import type { Screen } from './navigation.ts';

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
  else if(screen==='Session')(page.children[2] as HTMLElement).dataset.scrollRegion='session';
  else if(screen==='Debrief'){
    const middle=document.createElement('div');middle.dataset.scrollRegion='debrief';middle.dataset.nodeKey='debrief-scroll';
    while(page.children.length>2)middle.append(page.children[1]);
    page.insertBefore(middle,page.lastElementChild);
  }
}

export function observeViewport(shell:HTMLElement,host:HTMLElement,width:number,height:number){
  let frame=0;
  const resize=()=>{
    frame=0;
    const viewport=window.visualViewport,phone=width===390,scale=phone?1:Math.min(1,window.innerWidth/width);
    // Pinch zoom stays a browser operation; don't resize the app into it.
    const zoomed=!!viewport&&Math.abs(viewport.scale-1)>.01;
    const editable=document.activeElement?.matches('input,textarea,[contenteditable="true"]');
    const keyboard=!!viewport&&!zoomed&&!!editable&&window.innerHeight-viewport.height>120;
    const available=width===390?(!zoomed&&viewport?viewport.height:window.innerHeight):height*scale;
    host.style.width=phone?`${Math.min(window.innerWidth,600)}px`:`${width}px`;host.style.height=`${available/scale}px`;host.style.transform=`scale(${scale})`;
    host.style.setProperty('--page-height',`${available/scale}px`);host.style.setProperty('--viewport-scale',String(scale));
    shell.style.height=`${available}px`;shell.style.top=keyboard?`${viewport!.offsetTop}px`:'0px';
    shell.dataset.keyboard=String(keyboard);shell.dataset.compact=String(available/scale<844);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(resize);};
  resize();window.addEventListener('resize',schedule);window.addEventListener('pageshow',schedule);
  document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
  window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
  return()=>{
    cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('pageshow',schedule);
    document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);
    window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);
  };
}
