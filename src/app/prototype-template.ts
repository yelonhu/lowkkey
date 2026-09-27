import prototypeHtml from '../../docs/lowkkey-handoff/frontend/lowkkey-frontend.html?raw';
import bindingTemplate from './prototype.html?raw';
import type { Screen } from './navigation.ts';

let parsed: Document | null = null;
let bindings: Document | null = null;

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
  // The handoff HTML is the visual source. The previous template supplies only
  // non-visual hooks until the binding code no longer needs them.
  bindings ??= new DOMParser().parseFromString(bindingTemplate, 'text/html');
  const reference = bindings.querySelector<HTMLElement>(`.screen[data-screen="${screen}"]`);
  if (!reference) throw new Error(`Binding template missing: ${screen}`);
  const sourceElements = [reference, ...reference.querySelectorAll('*')];
  const targetElements = [node, ...node.querySelectorAll('*')];
  if (sourceElements.length !== targetElements.length) throw new Error(`Handoff structure changed: ${screen}`);
  sourceElements.forEach((element, index) => {
    const target = targetElements[index];
    if (element.tagName !== target.tagName) throw new Error(`Handoff node changed: ${screen}:${index}`);
    for (const name of ['data-bind', 'data-row', 'data-action']) {
      const value = element.getAttribute(name);
      if (value !== null) target.setAttribute(name, value);
    }
  });
  return node;
}
