import { cn } from './cn';

/**
 * The loading state: a small nib writes a signature, lifts, and writes it again. Never a spinning circle.
 * Under reduced motion the signature is shown still.
 */
const PATH = 'M6 34C18 10 28 8 30 22C32 36 20 40 34 30C48 20 54 8 66 16C76 23 70 34 84 28C92 25 98 20 104 16';

export function PenLoader({ size = 'md', label = 'Loading', className }: { size?: 'sm' | 'md' | 'lg'; label?: string; className?: string }) {
  const w = size === 'lg' ? 132 : size === 'sm' ? 54 : 92;
  return (
    <span className={cn('pen-loader inline-flex flex-col items-center gap-2', className)} role="status" aria-label={label}>
      <svg viewBox="0 0 110 48" width={w} height={(w * 48) / 110} fill="none" aria-hidden="true">
        <path d={PATH} className="pen-loader__ghost" stroke="#2547C9" strokeOpacity={0.12} strokeWidth={3} strokeLinecap="round" />
        <path d={PATH} pathLength={1} className="pen-loader__ink" stroke="#2547C9" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        <g className="pen-loader__nib" style={{ offsetPath: `path('${PATH}')` }}>
          <g transform="translate(-7.2 -11.8) scale(0.06)" stroke="#1B2B6B" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" fill="#F4F0E5">
            <path d="M80 30C63 54 57 82 65 104C77 136 100 166 120 196C140 166 163 136 175 104C183 82 177 55 160 31C142 25 98 25 80 30Z" />
            <path d="M120 122L120 190" fill="none" />
          </g>
        </g>
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
