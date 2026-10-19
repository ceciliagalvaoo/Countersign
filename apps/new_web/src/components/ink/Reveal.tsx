import type { ReactNode } from 'react';
import { cn } from './cn';
import { useInView } from './useInView';

/** A short rise-in when content first scrolls into view. Still under reduced motion. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Seconds. */
  delay?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={cn('rise', inView && 'rise--in', className)} style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}
