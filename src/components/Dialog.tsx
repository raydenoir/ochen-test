import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const focusable = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const surface = document.querySelector<HTMLElement>('.app-shell');
    const inert = surface?.inert ?? false;
    const overflow = document.body.style.overflow;
    if (surface) surface.inert = true;
    document.body.style.overflow = 'hidden';
    const controls = () => [...(root.current?.querySelectorAll<HTMLElement>(focusable) ?? [])].filter(el => !el.hidden && !el.closest('[hidden]'));
    const focusFirst = () => (controls()[0] ?? root.current)?.focus();
    focusFirst();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const nodes = controls(), first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); root.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !root.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    function focusin(event: FocusEvent) { if (!root.current?.contains(event.target as Node)) focusFirst(); }
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin);
      if (surface) surface.inert = inert;
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(<div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close.current(); }}>
    <section ref={root} className="help-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>{children}</section>
  </div>, document.body);
}
