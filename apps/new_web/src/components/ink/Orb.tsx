import { cn } from './cn';

export type OrbState = 'idle' | 'thinking' | 'replied';

const STATE_LABEL: Record<OrbState, string> = {
  idle: 'Agent, waiting for your message',
  thinking: 'Agent, working',
  replied: 'Agent, replied',
};

/**
 * The agent's presence: an aurora sphere, blues only, the one place in the product where gradients
 * are allowed. It breathes while idle, its light runs faster with ripples while the agent works,
 * and it pulses once when a reply lands. It never appears on the approval card: the card is
 * decoded from the transaction, not written by the agent.
 */
export function Orb({
  size = 64,
  state = 'idle',
  className,
  decorative = false,
}: {
  size?: number | string;
  state?: OrbState;
  className?: string;
  /** Hide from assistive tech when a nearby caption already says the state. */
  decorative?: boolean;
}) {
  const cssSize = typeof size === 'number' ? `${size}px` : size;
  return (
    <div
      className={cn('orb', className)}
      data-state={state}
      style={{ ['--orb-size' as string]: cssSize }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : STATE_LABEL[state]}
      aria-hidden={decorative ? true : undefined}
    >
      <span className="orb-ring" />
      <span className="orb-ring orb-ring--2" />
      <span className="orb-ring orb-ring--3" />
      <div className="orb-body absolute inset-0">
        <div className="orb-shell">
          <div className="orb-aurora orb-aurora--1" />
          <div className="orb-aurora orb-aurora--2" />
          <div className="orb-aurora orb-aurora--3" />
          <div className="orb-aurora orb-aurora--4" />
        </div>
        <div className="orb-gloss" />
      </div>
    </div>
  );
}

/**
 * The small orb glyph that marks anything the agent wrote: its messages, the mandate fields it
 * filled, the plan it proposed. The investor has to be able to see where the model was.
 */
export function OrbGlyph({ className, title = 'Written by the agent' }: { className?: string; title?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-3.5 w-3.5 shrink-0 rounded-full align-[-2px]',
        'bg-[radial-gradient(circle_at_32%_28%,#35C8E8_0%,#2547C9_52%,#3A1F9E_100%)]',
        className,
      )}
      role="img"
      aria-label={title}
      title={title}
    />
  );
}
