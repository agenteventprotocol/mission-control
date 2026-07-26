// Timeline chip: one event. Monochrome by default — color marks only what
// matters: a still-actionable attention request pulses pink, and events at
// warning severity or above carry heat. Identity is the visible type text.
// Details ride on the shared hover card (see event-hover.tsx).
import { memo } from 'react';
import type { AepEvent } from '@aep/sdk';
import { lastSegment, severityRank } from '@/lib/aep';
import { cn } from '@/lib/utils';
import { useEventHover } from './event-hover';

const HEAT_CHIP: Record<string, string> = {
  warning: 'border-severity-warning/60 text-severity-warning',
  error: 'border-severity-error/60 text-severity-error',
  critical: 'border-severity-critical/70 text-severity-critical',
};

function chipAria(ev: AepEvent): string {
  const parts = [ev.type, String(ev.time)];
  if (ev.severity) parts.push(`severity ${ev.severity}`);
  if (typeof ev.seq === 'number') parts.push(`seq ${ev.seq}`);
  return parts.join(', ');
}

export interface ChipProps {
  ev: AepEvent;
  /** Actionable attention chips pulse until settled. */
  pending?: boolean;
  /** Severity-lens floor: events below it render dimmed. */
  lensRank?: number;
  onClick?: (ev: AepEvent) => void;
}

export const Chip = memo(function Chip({ ev, pending, lensRank, onClick }: ChipProps) {
  const hover = useEventHover();
  const rank = severityRank(ev.severity);
  const heat = rank >= 3 ? HEAT_CHIP[ev.severity ?? ''] : undefined;
  const dimmed = lensRank !== undefined && rank < lensRank;
  return (
    <button
      type="button"
      tabIndex={-1}
      data-chip
      aria-label={chipAria(ev)}
      onMouseEnter={(e) => hover.show(ev, e.currentTarget)}
      onMouseLeave={hover.hide}
      onClick={onClick ? () => onClick(ev) : undefined}
      className={cn(
        'inline-flex shrink-0 items-center rounded border border-border bg-muted/50 px-1.5 py-px font-mono text-[11px] leading-4 text-foreground/85 transition-opacity',
        heat,
        pending && 'mc-chip-pending border-family-attention/60 text-family-attention',
        dimmed && 'opacity-30',
        onClick && 'cursor-pointer hover:opacity-80',
      )}
    >
      {lastSegment(ev.type)}
    </button>
  );
});
