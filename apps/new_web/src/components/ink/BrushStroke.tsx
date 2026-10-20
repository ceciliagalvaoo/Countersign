import { useId } from 'react';
import { cn } from './cn';
import { useInView } from './useInView';

export type BrushVariant = 1 | 2 | 3 | 4 | 5 | 6;

type Layer = { d: string; width: number; opacity: number };

/**
 * Six hand-painted cobalt strokes. Each is two or three offset paths at descending opacity,
 * displaced by a turbulence filter so the edges are never mechanical. Used large and asymmetric:
 * page corners, dividers, under a headline.
 */
const VARIANTS: Record<BrushVariant, { viewBox: string; layers: Layer[] }> = {
  // 1: long wavy horizontal sweep (dividers)
  1: {
    viewBox: '0 0 400 40',
    layers: [
      { d: 'M6 26C60 8 120 32 180 20S300 6 394 22', width: 7, opacity: 0.85 },
      { d: 'M8 31C64 15 126 37 186 25S304 12 392 27', width: 4, opacity: 0.5 },
      { d: 'M10 21C66 6 122 28 182 16S298 4 390 18', width: 2.2, opacity: 0.35 },
    ],
  },
  // 2: short thick underline, a signature under a headline
  2: {
    viewBox: '0 0 240 36',
    layers: [
      { d: 'M5 21C40 9 90 28 140 16S210 8 235 18', width: 9, opacity: 0.85 },
      { d: 'M7 27C44 16 94 33 144 22S212 14 233 24', width: 4.5, opacity: 0.5 },
    ],
  },
  // 3: big sweeping arc (page corners)
  3: {
    viewBox: '0 0 300 300',
    layers: [
      { d: 'M288 10C188 22 88 92 28 242', width: 8, opacity: 0.85 },
      { d: 'M296 22C198 34 98 102 40 254', width: 4.5, opacity: 0.5 },
      { d: 'M280 4C182 14 80 84 18 232', width: 2.4, opacity: 0.32 },
    ],
  },
  // 4: loose enclosure, the way you ring something on paper
  4: {
    viewBox: '0 0 320 180',
    layers: [
      { d: 'M40 96C30 42 118 16 190 20C268 24 306 58 296 104C286 150 198 168 128 161C60 154 28 134 40 96', width: 6, opacity: 0.8 },
      { d: 'M46 106C38 52 124 26 196 30C272 34 312 68 302 112C292 156 204 176 134 169C66 162 36 142 46 106', width: 3, opacity: 0.42 },
    ],
  },
  // 5: the countersign flourish: a signature crossed by a second hand
  5: {
    viewBox: '0 0 260 120',
    layers: [
      { d: 'M8 84C40 40 64 30 76 52C88 74 60 96 92 80C124 64 150 30 176 46C198 60 186 86 214 74C230 67 242 58 252 50', width: 7, opacity: 0.85 },
      { d: 'M20 104C88 92 168 90 248 98', width: 4, opacity: 0.55 },
      { d: 'M12 88C44 46 66 38 78 58', width: 2.4, opacity: 0.3 },
    ],
  },
  // 6: wide double wave (section tops, footers)
  6: {
    viewBox: '0 0 500 90',
    layers: [
      { d: 'M6 40C80 8 150 66 230 42C310 18 380 74 494 40', width: 7, opacity: 0.85 },
      { d: 'M6 54C82 24 152 80 232 56C312 32 382 86 494 54', width: 4, opacity: 0.5 },
      { d: 'M8 28C84 0 154 56 234 32C314 8 384 62 492 28', width: 2.2, opacity: 0.32 },
    ],
  },
};

export function BrushStroke({
  variant = 1,
  className,
  flip = false,
  animate = true,
  delay = 0,
}: {
  variant?: BrushVariant;
  className?: string;
  /** Mirror horizontally so one stroke serves both page edges. */
  flip?: boolean;
  animate?: boolean;
  /** Seconds before the stroke starts painting. */
  delay?: number;
}) {
  const { viewBox, layers } = VARIANTS[variant];
  const filterId = useId().replace(/:/g, '');
  const { ref, inView } = useInView<SVGSVGElement>();
  const painting = animate ? inView : true;

  return (
    <svg
      ref={ref}
      viewBox={viewBox}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn('pointer-events-none select-none text-cobalt', flip && '-scale-x-100', className)}
    >
      <defs>
        <filter id={filterId} x="-15%" y="-40%" width="130%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.026" numOctaves={3} seed={variant * 7} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`}>
        {layers.map((layer, i) => (
          <path
            key={i}
            d={layer.d}
            pathLength={1}
            stroke="currentColor"
            strokeWidth={layer.width}
            strokeOpacity={layer.opacity}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(animate && 'ink-draw', animate && painting && 'ink-draw--in')}
            style={animate ? { animationDelay: `${delay + i * 0.09}s` } : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
