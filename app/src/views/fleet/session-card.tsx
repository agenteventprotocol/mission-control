// One session tile, alive by construction: status pulse, identity row with
// an activity sparkline, the live chip strip, a footer that narrates the
// lane (run ribbon + latest event), and — when the agent is waiting — an
// inline quick-answer strip, so the fleet view is also the place you
// unblock agents. Renders only what the store derived; subscribes at lane
// granularity.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Severity } from '@aep/sdk';
import type { Store, Lane } from '@/core/store';
import { familyOf, lastSegment, severityRank, shortSessionId } from '@/lib/aep';
import { formatAge, formatCount } from '@/lib/format';
import { summarize } from '@/lib/summary';
import { useController, useLane } from '@/state/use-store';
import { relayDisplay } from '@/lib/relays';
import { navigate } from '@/state/router';
import { Badge } from '@/components/ui/badge';
import { CancelRunButton } from '@/components/layout/cancel-run';
import { Chip } from '@/components/event/chip';
import { cn } from '@/lib/utils';
import { QuickAnswer } from './quick-answer';
import { LanePulse } from './lane-pulse';
import { RunSegments } from './run-segments';

/** Cards show the tail of long lanes; the full history lives in the session view. */
const STRIP_CAP = 240;
const FOLLOW_EPSILON_PX = 4;

export function pendingCount(lane: Lane): number {
  if (lane.source.kind === 'import') return 0; // captured history is never a call to action
  let n = 0;
  for (const item of lane.attention.values()) {
    if (item.state === 'pending' || item.state === 'responding') n++;
  }
  return n;
}

function ChipStrip({ lane, lensRank }: { lane: Lane; lensRank: number }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  const shown = lane.events.length > STRIP_CAP ? lane.events.slice(-STRIP_CAP) : lane.events;
  const hidden = lane.events.length - shown.length;

  // Auto-follow the tail unless the user scrolled back (per-lane, sticky).
  useEffect(() => {
    const el = stripRef.current;
    if (el && following.current) el.scrollLeft = el.scrollWidth;
  }, [lane.version]);

  return (
    <div
      ref={stripRef}
      className="flex items-center gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]"
      onScroll={(e) => {
        const el = e.currentTarget;
        following.current = el.scrollWidth - el.clientWidth - el.scrollLeft <= FOLLOW_EPSILON_PX;
      }}
    >
      {hidden > 0 && (
        <span className="shrink-0 font-mono text-[11px] text-faint">+{formatCount(hidden)} earlier</span>
      )}
      {shown.map(({ ev }) => {
        const item = lane.attention.get(ev.id);
        const pending =
          lane.source.kind === 'relay' && !!item && (item.state === 'pending' || item.state === 'responding');
        return <Chip key={ev.id} ev={ev} pending={pending} lensRank={lensRank} />;
      })}
    </div>
  );
}

function LatestLine({ lane, now }: { lane: Lane; now: number }) {
  const last = lane.events[lane.events.length - 1]?.ev;
  if (!last) return null;
  const family = familyOf(last.type);
  const summary = summarize(last);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs">
      <span className="shrink-0 font-mono text-muted-foreground">
        {family !== 'unknown' ? `${family}.` : ''}
        {lastSegment(last.type)}
      </span>
      {summary && <span className="truncate text-faint">{summary}</span>}
      <span className="shrink-0 text-faint tabular-nums">
        · {formatAge(now - Date.parse(String(last.time)))}
      </span>
    </span>
  );
}

export const SessionCard = memo(function SessionCard({
  store,
  session,
  lens,
}: {
  store: Store;
  session: string;
  lens: Severity;
}) {
  const lane = useLane(store, session);
  const relays = useController().config.relays;
  // Refresh relative ages + the pulse window even when the lane is idle.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const lensRank = useMemo(() => severityRank(lens), [lens]);
  if (!lane) return null;

  const pending = pendingCount(lane);
  const runsDone = [...lane.runs.values()].filter((r) => r.state !== 'active').length;
  const active = lane.status === 'active';
  // The card offers cancel for its newest active run; per-run affordances
  // live in the session view. Hover-revealed (kept visible mid-flight).
  const cancellableRun = [...lane.runs.values()].filter((r) => r.state === 'active').at(-1);

  return (
    <article
      className={cn(
        'group overflow-hidden rounded-xl border bg-card transition-colors',
        pending > 0 ? 'border-family-attention/40' : 'hover:border-primary/35',
        !active && 'opacity-65 hover:opacity-90',
      )}
      data-session={lane.session}
    >
      <button
        type="button"
        onClick={() => navigate({ view: 'session', session: lane.key })}
        className="flex w-full cursor-pointer items-center gap-2.5 px-3 pt-2.5 pb-2 text-left hover:bg-accent/50"
        aria-label={`Open session ${lane.session} (${lane.status})`}
      >
        <span
          className={cn('size-2 shrink-0 rounded-full', active ? 'bg-foreground text-foreground mc-live-dot' : 'bg-faint/50')}
          aria-hidden
        />
        <span className="truncate font-medium">{lane.agent ?? '(unknown agent)'}</span>
        {lane.label && (
          <span className="hidden min-w-0 truncate text-sm text-muted-foreground md:inline">
            {lane.label}
          </span>
        )}
        <span className="shrink-0 font-mono text-xs text-faint">#{shortSessionId(lane.session)}</span>
        {lane.gap && <Badge variant="gap">gap</Badge>}
        {lane.source.kind === 'import' && <Badge variant="outline">imported</Badge>}
        {lane.source.kind === 'relay' && relays.length > 1 && (
          <Badge variant="outline">{relayDisplay(lane.source, relays)}</Badge>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          <LanePulse lane={lane} now={now} />
          <ChevronRight className="size-3.5 text-faint" aria-hidden />
        </span>
      </button>
      <ChipStrip lane={lane} lensRank={lensRank} />
      <div className="flex items-center gap-2.5 border-t border-grid px-3 py-1.5">
        <RunSegments lane={lane} />
        {lane.runs.size > 0 && (
          <span className="shrink-0 text-xs text-faint tabular-nums">
            {runsDone}/{lane.runs.size}
          </span>
        )}
        {cancellableRun && (
          <CancelRunButton
            lane={lane}
            run={cancellableRun}
            compact
            className={cn(
              'shrink-0',
              !cancellableRun.cancelling &&
                !cancellableRun.error &&
                'opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
            )}
          />
        )}
        <LatestLine lane={lane} now={now} />
        <span className="ml-auto shrink-0 text-xs text-faint tabular-nums">
          {formatCount(lane.events.length)} ev
        </span>
      </div>
      <QuickAnswer lane={lane} />
    </article>
  );
});
