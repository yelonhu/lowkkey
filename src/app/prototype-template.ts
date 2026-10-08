import prototypeHtml from '../../docs/lowkkey-handoff/frontend/lowkkey-frontend.html?raw';
import bindingHooks from './binding-hooks.json';
import type { Screen } from './navigation.ts';

let parsed: Document | null = null;

function source(): Document {
  parsed ??= new DOMParser().parseFromString(prototypeHtml, 'text/html');
  return parsed;
}

export function installPrototypeStyle(): void {
  if (document.getElementById('lowkkey-prototype-style')) return;
  const style = document.createElement('style');
  style.id = 'lowkkey-prototype-style';
  style.textContent = source().querySelector('style')?.textContent ?? '';
  document.head.append(style);
  const font = source().querySelector('link[rel="stylesheet"]')?.cloneNode(true);
  if (font) document.head.append(font);
}

export function prototypeScreen(screen: Screen): HTMLElement {
  const original = source().querySelector<HTMLElement>(`.screen[data-screen="${screen}"]`);
  if (!original) throw new Error(`Prototype screen missing: ${screen}`);
  const node = document.importNode(original, true);
  // Resolve source nodes before bindings insert controls or rearrange regions.
  const hooks = bindingHooks[screen] as {elements:number;hooks:[number,string,string,string][]};
  const targetElements = [node, ...node.querySelectorAll('*')];
  targetElements.forEach((element, index) => element.setAttribute('data-node-key', `${screen}:${index}`));
  if (hooks.elements !== targetElements.length) throw new Error(`Handoff structure changed: ${screen}`);
  for (const [index,tag,name,value] of hooks.hooks) {
    const target = targetElements[index];
    if (target.tagName !== tag) throw new Error(`Handoff node changed: ${screen}:${index}`);
    target.setAttribute(name,value);
  }
  if(screen==='Session'){
    // Resolve the handoff structure once, before runtime rearrangement. Bindings
    // and motion address named regions rather than child positions afterwards.
    const [header,progress,center,controls]=Array.from(node.firstElementChild!.children);
    const parts:Record<string,Element>={header,progress,center,controls,name:header.children[1],title:header.children[1].children[0],count:header.children[1].children[1],caption:center.children[0],weight:center.children[1],range:center.children[2],plates:center.children[4],previous:center.children[5],reps:controls.children[0],repValue:controls.children[0].children[1].children[1],rir:controls.children[1],submit:controls.children[2]};
    for(const [name,element] of Object.entries(parts))element.setAttribute('data-session-part',name);
  }
  return node;
}

// Mark existing handoff regions. The debrief's nonvisual flex wrapper retains
// its header, footer and original spacing while making only the middle scroll.
export function preparePageLayout(node:HTMLElement,screen:Screen){
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
