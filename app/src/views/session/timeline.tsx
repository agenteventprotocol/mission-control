// Session timeline: a virtualized vertical list of the lane's events in
// store order. The replay scrubber caps the visible range; a text filter
// narrows rows without touching store state.
import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Lane, OrderedEvent } from '@/core/store';
import { familyOf, lastSegment } from '@/lib/aep';
import { formatClock } from '@/lib/format';
import { summarize } from '@/lib/summary';
import { cn } from '@/lib/utils';

const SEVERITY_BAR: Record<string, string> = {
  debug: 'bg-severity-debug/60',
  info: 'bg-transparent',
  notice: 'bg-severity-notice',
  warning: 'bg-severity-warning',
  error: 'bg-severity-error',
  critical: 'bg-severity-critical',
};

export function Timeline({
  lane,
  window: win,
  live,
  filter,
  selectedId,
  onSelect,
  steps,
}: {
  lane: Lane;
  /** Replay window [start, end): only these indices render. */
  window: [number, number];
  /** Live = follow the tail; a replay window never auto-scrolls. */
  live: boolean;
  filter: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Event id -> open step label (store.stepsOf); boundaries style as headers. */
  steps?: Map<string, string>;
}) {
  const rows = useMemo(() => {
    const windowed = lane.events.slice(win[0], win[1]);
    if (!filter) return windowed;
    const q = filter.toLowerCase();
    return windowed.filter(({ ev }) => {
      const hay = `${ev.type} ${summarize(ev)} ${ev.severity ?? ''} ${ev.run ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lane.events mutates in place; lane.version is its change signal
  }, [lane.events, lane.version, win[0], win[1], filter]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 12,
  });

  // Follow the tail when new rows arrive — only while live, and unless the
  // user scrolled back.
  const following = useRef(true);
  useEffect(() => {
    if (live && following.current && rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }
  }, [live, rows.length, virtualizer]);

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        following.current = el.scrollHeight - el.clientHeight - el.scrollTop <= 40;
      }}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index] as OrderedEvent;
          const { ev } = row;
          const family = familyOf(ev.type);
          const selected = ev.id === selectedId;
          const step = steps?.get(ev.id);
          const stepBoundary = ev.type === 'run.step.started' || ev.type === 'run.step.finished';
          return (
            <button
              key={ev.id}
              type="button"
              onClick={() => onSelect(ev.id)}
              className={cn(
                'absolute top-0 left-0 flex w-full cursor-pointer items-center gap-2.5 border-b border-grid px-2 text-left text-xs hover:bg-accent/60',
                stepBoundary && 'bg-muted/40 font-medium',
                selected && 'bg-accent',
              )}
              style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
              aria-pressed={selected}
            >
              <span
                className={cn('h-4 w-0.5 shrink-0 rounded-full', SEVERITY_BAR[ev.severity ?? 'info'])}
                title={`severity: ${ev.severity ?? 'info'}`}
                aria-label={`severity: ${ev.severity ?? 'info'}`}
              />
              <span className="w-24 shrink-0 font-mono text-faint tabular-nums">
                {formatClock(String(ev.time))}
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-faint tabular-nums">
                {typeof ev.seq === 'number' ? ev.seq : '·'}
              </span>
              <span className="w-40 shrink-0 truncate font-mono text-foreground/90">
                <span className="text-faint">{family !== 'unknown' ? `${family}.` : ''}</span>
                {lastSegment(ev.type)}
              </span>
              <span className="truncate text-muted-foreground">{summarize(ev)}</span>
              {step && (
                <span
                  className="shrink-0 rounded border border-grid px-1.5 font-mono text-[10px] text-faint"
                  title={`step: ${step}`}
                >
                  {step}
                </span>
              )}
              {typeof ev.run === 'string' && (
                <span className="ml-auto shrink-0 rounded bg-muted px-1.5 font-mono text-[10px] text-faint">
                  {ev.run.length > 10 ? ev.run.slice(-10) : ev.run}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
