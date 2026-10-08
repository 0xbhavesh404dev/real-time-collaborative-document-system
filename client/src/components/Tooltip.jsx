import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Icon-only toolbar buttons are hard to identify, and the native `title`
// tooltip is slow to appear and can be clipped by the scrolling toolbar.
// A single fixed-position bubble, shown on hover of any element with a
// data-tip attribute, renders in a portal so nothing can clip it.
const FLIP_BELOW = 56;
const EDGE_PADDING = 8;

export default function Tooltip() {
  const [tip, setTip] = useState(null);
  const elementRef = useRef(null);

  useEffect(() => {
    function show(event) {
      const target = event.target?.closest?.('[data-tip]');
      if (!target) return;
      if (event.relatedTarget && target.contains(event.relatedTarget)) return;
      elementRef.current = target;
      const label = target.getAttribute('data-tip');
      if (!label) return;
      setTip({ label, rect: target.getBoundingClientRect() });
    }

    function hide(event) {
      if (!elementRef.current) return;
      if (event.relatedTarget && elementRef.current.contains(event.relatedTarget)) return;
      elementRef.current = null;
      setTip(null);
    }

    function dismiss() {
      elementRef.current = null;
      setTip(null);
    }

    document.addEventListener('mouseover', show);
    document.addEventListener('mouseout', hide);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    document.addEventListener('keydown', dismiss);

    return () => {
      document.removeEventListener('mouseover', show);
      document.removeEventListener('mouseout', hide);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, []);

  if (!tip) return null;

  const placeBelow = tip.rect.top < FLIP_BELOW;
  const centerX = Math.min(
    Math.max(tip.rect.left + tip.rect.width / 2, EDGE_PADDING),
    Math.max(window.innerWidth - EDGE_PADDING, EDGE_PADDING)
  );
  const style = placeBelow
    ? { top: tip.rect.bottom + 8, left: centerX, transform: 'translate(-50%, 0)' }
    : { top: tip.rect.top - 8, left: centerX, transform: 'translate(-50%, -100%)' };

  return createPortal(
    <div
      className={`tooltip-bubble ${placeBelow ? 'below' : 'above'}`}
      style={style}
      role="tooltip"
    >
      {tip.label}
    </div>,
    document.body
  );
}
