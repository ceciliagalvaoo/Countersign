import { useEffect, useState } from 'react';
import { BrushStroke, type BrushVariant } from './BrushStroke';

/**
 * One stroke, always exactly one, painting itself behind the page and then fading so the next can
 * take its place: a hand at work in the margins. Takes no clicks; off under reduced motion.
 */
const PLACEMENTS: Array<{ variant: BrushVariant; className: string }> = [
  { variant: 3, className: 'top-[6%] -right-[16%] h-[520px] w-[520px]' },
  { variant: 1, className: 'bottom-[16%] -left-[6%] h-[120px] w-[70vw] max-w-[700px]' },
  { variant: 5, className: 'bottom-[8%] right-[4%] h-[200px] w-[420px]' },
  { variant: 6, className: 'bottom-[38%] -right-[8%] h-[150px] w-[70vw] max-w-[760px]' },
  { variant: 4, className: 'top-[52%] right-[14%] h-[260px] w-[420px]' },
];

const CYCLE_MS = 13000;

export function AmbientStroke() {
  const [index, setIndex] = useState(0);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setEnabled(true);
    const id = window.setInterval(() => setIndex((i) => i + 1), CYCLE_MS);
    return () => window.clearInterval(id);
  }, []);

  if (!enabled) return null;
  const placement = PLACEMENTS[index % PLACEMENTS.length];
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 select-none overflow-hidden">
      <div key={index} className={`ambient-stroke absolute ${placement.className}`}>
        <BrushStroke variant={placement.variant} className="h-full w-full" />
      </div>
    </div>
  );
}
