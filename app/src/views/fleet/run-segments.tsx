// Run ribbon: one segment per run in start order. Monochrome for the
// normal cases (finished is the norm, active shimmers) — color marks only
// problems: failed red, cancelled amber. The accessible label counts
// states out loud, so state is never color-alone.
import type { Lane, RunState } from '@/core/store';
import { cn } from '@/lib/utils';

const SEGMENT: Record<RunState, string> = {
  active: 'bg-foreground/70 mc-run-active',
  finished: 'bg-foreground/30',
  failed: 'bg-severity-critical/90',
  cancelled: 'bg-severity-warning/80',
};

const MAX_SEGMENTS = 24;

export function RunSegments({ lane }: { lane: Lane }) {
  const runs = [...lane.runs.values()];
  if (runs.length === 0) return null;

  const shown = runs.length > MAX_SEGMENTS ? runs.slice(-MAX_SEGMENTS) : runs;
  const counts: Record<RunState, number> = { active: 0, finished: 0, failed: 0, cancelled: 0 };
  for (const run of runs) counts[run.state]++;
  const label = `${runs.length} runs: ${counts.finished} finished, ${counts.failed} failed, ${counts.cancelled} cancelled, ${counts.active} active`;

  return (
    <span
      className="inline-flex h-1.5 w-24 items-stretch gap-px overflow-hidden rounded-full"
      role="img"
      aria-label={label}
    >
      {runs.length > MAX_SEGMENTS && <span className="w-1 shrink-0 bg-muted" aria-hidden />}
      {shown.map((run) => (
        <span key={run.id} className={cn('min-w-0 flex-1', SEGMENT[run.state])} aria-hidden />
      ))}
    </span>
  );
}
