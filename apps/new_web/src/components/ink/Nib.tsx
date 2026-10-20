import { cn } from './cn';

/*
 * The Countersign nib. A fountain pen nib drawn from three strokes that meet at one point: the
 * left flank is the investor's mandate, the right flank is the fund's issuer, the slit is the
 * wallet contract the agent cannot change. Ink only reaches the paper where all three meet, and the stroke that leaves the tip is
 * the signature. Same hand as every other stroke in the product: round caps, never filled.
 */
const SHOULDER = 'M80 30C98 25 142 25 160 31';
const LEFT = 'M80 30C63 54 57 82 65 104C77 136 100 166 120 196';
const RIGHT = 'M160 31C177 55 183 82 175 104C163 136 140 166 120 196';
const BREATHER = 'M111 104a9 9 0 1 0 18 0a9 9 0 1 0 -18 0';
const SLIT = 'M120 122C118.6 146 121.2 170 120 190';
const SIGNATURE = 'M120 196C134 214 158 220 180 208C194 200 206 202 222 212';
const BASELINE = 'M20 226C78 220 162 222 222 226';

/** The large nib: draws itself in stroke by stroke, then floats. Landing, sign in, empty states. */
export function Nib({
  size,
  className,
  animate = true,
  strokeWidth = 7,
  title,
}: {
  size?: number | string;
  className?: string;
  animate?: boolean;
  strokeWidth?: number;
  /** Give it a title when it carries meaning; otherwise it is decorative. */
  title?: string;
}) {
  const cssSize = typeof size === 'number' ? `${size}px` : size;
  const draw = animate ? 'ink-draw ink-draw--in' : undefined;
  const stroke = {
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
    pathLength: 1,
  };
  const at = (s: number) => (animate ? { animationDelay: `${s}s` } : undefined);

  return (
    <svg
      viewBox="0 0 240 240"
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn('select-none text-cobalt', className)}
      style={cssSize ? { width: cssSize, height: 'auto' } : undefined}
    >
      <g className={animate ? 'nib-body' : undefined}>
        <path {...stroke} d={LEFT} strokeWidth={strokeWidth} strokeOpacity={0.9} className={draw} style={at(0)} />
        <path {...stroke} d={RIGHT} strokeWidth={strokeWidth} strokeOpacity={0.9} className={draw} style={at(0.16)} />
        <path {...stroke} d={SHOULDER} strokeWidth={strokeWidth * 0.86} strokeOpacity={0.8} className={draw} style={at(0.32)} />
        <path {...stroke} d={BREATHER} strokeWidth={strokeWidth * 0.62} strokeOpacity={0.82} className={draw} style={at(0.5)} />
        <path {...stroke} d={SLIT} strokeWidth={strokeWidth * 0.62} strokeOpacity={0.82} className={draw} style={at(0.62)} />
      </g>
      <path {...stroke} d={SIGNATURE} strokeWidth={strokeWidth * 0.66} strokeOpacity={0.85} className={draw} style={at(0.9)} />
      <path {...stroke} d={BASELINE} strokeWidth={strokeWidth * 0.34} strokeOpacity={0.4} className={draw} style={at(1.15)} />
    </svg>
  );
}

/** The small nib beside the wordmark and in the favicon: same strokes, heavier, no baseline. */
export function NibGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="40 16 190 210" fill="none" aria-hidden="true" focusable="false" className={cn('text-cobalt', className)}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none" strokeWidth={14}>
        <path d={LEFT} />
        <path d={RIGHT} />
        <path d={SHOULDER} />
        <path d={BREATHER} strokeWidth={10} />
        <path d={SLIT} strokeWidth={10} />
        <path d={SIGNATURE} strokeWidth={10} />
      </g>
    </svg>
  );
}
