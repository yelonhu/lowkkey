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
  // The handoff HTML alone supplies every visible node; this compact index adds
  // non-visual lookup hooks at the same element positions.
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
