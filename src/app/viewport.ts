export function updateScrollability(host:HTMLElement){
  for(const main of host.querySelectorAll('main')){main.removeAttribute('data-scrollable');if(main.scrollHeight>main.clientHeight+1)main.setAttribute('data-scrollable','true');}
}

// Source artboards stay 390×844. Runtime dimensions follow the usable viewport.
// With a 390×844 viewport and no safe-area inset these rules are pixel-neutral.
export function observeViewport(shell:HTMLElement,host:HTMLElement,width:number,height:number){
  const resize=()=>{
    const viewport=window.visualViewport,scale=Math.min(1,window.innerWidth/width);
    const keyboard=!!viewport&&window.innerHeight-viewport.height>120;
    const available=width===390?(keyboard?viewport!.height:window.innerHeight):height*scale;
    host.style.width=`${width}px`;host.style.height=`${available/scale}px`;host.style.transform=`scale(${scale})`;
    host.style.setProperty('--page-height',`${available/scale}px`);
    shell.style.height=`${available}px`;shell.dataset.keyboard=String(keyboard);shell.dataset.compact=String(available/scale<844);updateScrollability(host);
    if(keyboard&&viewport)shell.style.marginTop=`${viewport.offsetTop}px`;else shell.style.removeProperty('margin-top');
  };
  resize();window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);
  return()=>{window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',resize);};
}
