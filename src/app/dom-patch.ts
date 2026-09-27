// Reconcile bound copies of the handoff without replacing live controls.
// Keys are scoped to siblings; ledger rows use their persistent entry IDs.
function key(node: Node): string | null {
  if (!(node instanceof Element)) return null;
  return node.getAttribute('data-row-key') ?? node.getAttribute('data-entry-id') ?? node.getAttribute('data-node-key');
}

function compatible(a: Node, b: Node): boolean {
  return a.nodeType === b.nodeType && (!(a instanceof Element) || b instanceof Element && a.tagName === b.tagName && key(a) === key(b));
}

export function patchNode(current: Node, next: Node): void {
  if (!(current instanceof Element) || !(next instanceof Element)) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  const top = current.scrollTop, left = current.scrollLeft;
  for (const attribute of [...current.attributes]) {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of [...next.attributes]) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  if (current instanceof HTMLInputElement && next instanceof HTMLInputElement) {
    // The live input owns its edit/composition buffer until an explicit submit.
    if (document.activeElement !== current && current.value !== next.value) current.value = next.value;
    current.disabled = next.disabled;
    current.readOnly = next.readOnly;
  }
  const remaining = new Set(current.childNodes);
  const keyed = new Map([...remaining].filter(node => key(node)).map(node => [key(node), node]));
  let cursor = current.firstChild;
  for (const desired of [...next.childNodes]) {
    const id = key(desired);
    const match = id ? keyed.get(id) : cursor && !key(cursor) && compatible(cursor, desired) ? cursor : undefined;
    if (match && remaining.has(match) && compatible(match, desired)) {
      if (match !== cursor) current.insertBefore(match, cursor);
      patchNode(match, desired);
      remaining.delete(match);
      cursor = match.nextSibling;
    } else {
      current.insertBefore(desired, cursor);
    }
  }
  for (const removed of remaining) removed.parentNode?.removeChild(removed);
  if (current.scrollTop !== top) current.scrollTop = top;
  if (current.scrollLeft !== left) current.scrollLeft = left;
}
