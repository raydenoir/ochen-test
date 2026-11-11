import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import type { Palette } from '../model';

function Swatches({ palette }: { palette: Palette }) {
  const colors = [palette.background[0], palette.background[2], palette.objects[0], palette.objects[1]];
  return <span className="swatches" aria-hidden="true">{colors.map((color, i) => <i key={i} style={{ background: color }}/>)}</span>;
}

export function PalettePicker({ palette, options, onChoose }: {
  palette: Palette;
  options: Palette[];
  onChoose: (palette: Palette) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const button = trigger.current;
    const popup = menu.current;
    function position() {
      const anchor = button.getBoundingClientRect();
      const margin = 8, gap = 4;
      const below = window.innerHeight - anchor.bottom - margin - gap;
      const above = anchor.top - margin - gap;
      const placeBelow = below >= popup.scrollHeight || below >= above;
      Object.assign(popup.style, {
        left: `${anchor.left}px`, width: `${anchor.width}px`,
        top: placeBelow ? `${anchor.bottom + gap}px` : '',
        bottom: placeBelow ? '' : `${window.innerHeight - anchor.top + gap}px`,
        maxHeight: `${Math.max(0, placeBelow ? below : above)}px`,
      } satisfies CSSProperties);
    }
    function dismissOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!popup.contains(target) && !button.contains(target)) setOpen(false);
    }
    function dismissOnScroll(event: Event) {
      if (!(event.target instanceof Node) || !popup.contains(event.target)) setOpen(false);
    }
    position();
    popup.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', dismissOnScroll, true);
    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', dismissOnScroll, true);
      document.removeEventListener('pointerdown', dismissOutside);
    };
  }, [open]);

  return <>
    <button ref={trigger} type="button" className="palette-picker" aria-label="Выбрать палитру"
      aria-controls="palette-options" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Swatches palette={palette}/><span>{palette.name}</span><ChevronDown size={13}/>
    </button>
    {open && createPortal(<div ref={menu} id="palette-options" className="palette-options" role="group" aria-label="Палитры"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) setOpen(false);
      }}
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
      }}>
      {options.map(option => <button type="button" key={option.key} className={`palette-row ${option.key === palette.key ? 'active' : ''}`}
        aria-label={`Палитра ${option.name}`} aria-pressed={option.key === palette.key} onClick={() => { onChoose(option); close(); }}>
        <Swatches palette={option}/><span>{option.name}</span>{option.key === palette.key && <Check size={13}/>}
      </button>)}
    </div>, document.body)}
  </>;
}
