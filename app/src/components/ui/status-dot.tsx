// The one status dot: connection/process state as color, always from the
// semantic tokens (never raw palette classes) and never color-alone — the
// call site keeps its own visible label or title. `pulse` opts into the
// breathing live animation (`mc-live-dot` needs currentColor, so live also
// sets text-live).
import { cn } from '@/lib/utils';

export type StatusDotState = 'live' | 'connecting' | 'error' | 'off';

const DOT: Record<StatusDotState, string> = {
  live: 'bg-live text-live',
  connecting: 'bg-severity-warning',
  error: 'bg-severity-error',
  off: 'bg-muted-foreground/40',
};

/**
 * The same state→color mapping as CSS values, for consumers that draw lines
 * instead of dots (SVG edge strokes, legend swatches). `off` maps to the
 * border neutral there — an idle EDGE reads as chrome, not as a gray dot.
 */
export const STATUS_DOT_COLOR: Record<StatusDotState, string> = {
  live: 'var(--color-live)',
  connecting: 'var(--color-severity-warning)',
  error: 'var(--color-severity-error)',
  off: 'var(--color-border)',
};

export function StatusDot({
  state,
  pulse = false,
  className,
}: {
  state: StatusDotState;
  /** Breathing ring while live (no-op for the other states). */
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        DOT[state],
        pulse && state === 'live' && 'mc-live-dot',
        className,
      )}
    />
  );
}
