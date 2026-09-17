import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/** Native modal semantics provide focus containment and make the background
 * inert. Restore the triggering control when the modal closes. */
export function ConfirmDialog({ title, children, onCancel }: { title: string; children: ReactNode; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="panel dialog" aria-labelledby="confirmation-title" onCancel={event => { event.preventDefault(); onCancel(); }}><h2 id="confirmation-title">{title}</h2>{children}</dialog>;
}
