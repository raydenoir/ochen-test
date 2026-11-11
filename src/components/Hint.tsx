import { useEffect, useId, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { createPortal } from 'react-dom';

export function Hint({ label, children }: { label: string; children: string }) {
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const close = () => setPosition(null);
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, []);
  function show(node: HTMLElement) {
    const box = node.getBoundingClientRect();
    setPosition({ left: Math.max(12, Math.min(window.innerWidth - 272, box.right - 260)), top: Math.max(12, Math.min(window.innerHeight - 130, box.bottom + 8)) });
  }
  return <span className="hint"><button type="button" className="hint-trigger" aria-label={label} aria-describedby={position ? id : undefined}
    onMouseEnter={e => show(e.currentTarget)} onMouseLeave={e => { if (document.activeElement !== e.currentTarget) setPosition(null); }} onFocus={e => show(e.currentTarget)} onBlur={() => setPosition(null)}
    onClick={e => show(e.currentTarget)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setPosition(null); } }}><CircleHelp size={14}/></button>
    {position && createPortal(<span role="tooltip" id={id} className="hint-content" style={position}>{children}</span>, document.body)}
  </span>;
}
