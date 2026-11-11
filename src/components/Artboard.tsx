import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { fitArtboard } from '../viewport';

export function Artboard({ width, height, busy, children }: { width: number; height: number; busy: boolean; children: ReactNode }) {
  const slot = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = slot.current!;
    const measure = () => {
      const box = node.getBoundingClientRect();
      setSpace(old => old.width === box.width && old.height === box.height ? old : { width: box.width, height: box.height });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const fitted = fitArtboard(space.width, space.height, width, height);
  return <div ref={slot} className="artboard-slot"><div className={`artboard ${busy ? 'generating' : ''}`} style={{ width: fitted.width, height: fitted.height }}>{children}</div></div>;
}
