import { useEffect, useState } from 'react';
import { cn } from './cn';

/**
 * The loading state for anything that takes a beat: the nib's three strokes draw one by one (her
 * mandate, the issuer, the network), then clear and start again. Never a spinner.
 */
const STROKES = ['M4 22C6 14 9 8 12 3', 'M20 3C23 8 26 14 28 22', 'M16 6C15.6 11 16.4 16 16 22'];

export function InkLoader({ lines, className }: { lines?: string[]; className?: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 420);
    return () => window.clearInterval(id);
  }, []);
  const shown = tick % 5; // 0..4: three strokes, then a beat with all three, then clear
  const line = lines?.length ? lines[Math.floor(tick / 7) % lines.length] : null;
  return (
    <div className={cn('flex items-center gap-3', className)} role="status">
      <svg viewBox="0 0 32 26" className="h-5 w-auto text-cobalt" aria-hidden="true" fill="none">
        {STROKES.map((d, i) => (
          <path
            key={i}
            d={d}
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeOpacity={i < Math.min(shown, 3) ? 0.9 : 0.16}
            style={{ transition: 'stroke-opacity 200ms ease-out' }}
          />
        ))}
      </svg>
      {line ? <p className="text-14 text-ink-soft">{line}</p> : <span className="sr-only">Loading</span>}
    </div>
  );
}
