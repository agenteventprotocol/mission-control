// Session detail: header facts, a dual-ended replay range, timeline +
// causal graph tabs, and the inspector panel. Everything renders from lane
// fields the store already derived; the replay window only caps what is
// DISPLAYED (a replay of how the session unfolded), never re-derives state.
import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Boxes,
  Check,
  Copy,
  GitBranch,
  History,
  Rows3,
  SearchX,
  SlidersHorizontal,
} from 'lucide-react';
import { useController, useLane } from '@/state/use-store';
import { relayDisplay } from '@/lib/relays';
import { navigate } from '@/state/router';
import { formatCount } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CancelRunButton } from '@/components/layout/cancel-run';
import { SteerButton } from '@/components/layout/steer';
import { PauseResumeControls } from '@/components/layout/pause-resume';
import { EmptyState } from '@/components/layout/empty-state';
import { Timeline } from './timeline';
import { StatePanel } from './state-panel';
import { ControlPanel } from './control-panel';
import { CausalGraph } from './dag';
import { Inspector } from './inspector';

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex cursor-pointer items-center gap-1 font-mono text-xs text-faint hover:text-foreground"
      title="Copy session id"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard unavailable — leave silent */
        }
      }}
    >
      {id}
      {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
    </button>
  );
}

export function SessionView({ session }: { session: string }) {
  const controller = useController();
  const lane = useLane(controller.store, session);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  // Replay window [start, end); null = live (the full, growing lane).
  const [range, setRange] = useState<[number, number] | null>(null);

  const total = lane?.events.length ?? 0;
  const live = range === null;
  const winStart = live ? 0 : Math.min(range[0], total);
  const winEnd = live ? total : Math.min(range[1], total);
  const win: [number, number] = [winStart, winEnd];

  const dag = useMemo(
    () => controller.store.dag(session),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dag derives from lane state
    [controller.store, session, lane?.version],
  );
  const steps = useMemo(
    () => controller.store.stepsOf(session),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- steps derive from lane state
    [controller.store, session, lane?.version],
  );
  const laneState = useMemo(
    () => controller.store.stateOf(session),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state derives from lane state
    [controller.store, session, lane?.version],
  );
  const windowIds = useMemo(() => {
    if (live || !lane) return undefined;
    return new Set(lane.events.slice(winStart, winEnd).map((o) => o.ev.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lane.events mutates in place; lane.version is its change signal
  }, [lane, lane?.version, live, winStart, winEnd]);

  if (!lane) {
    return (
      <EmptyState icon={SearchX} title="Unknown session">
        <p>
          <span className="font-mono">{session}</span> is not in the store. It may not have reached
          this observer yet — or it started and ended entirely while no observer was attached, which
          bounded replay cannot recover (see the protocol notes in the docs).
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate({ view: 'fleet' })}>
          <ArrowLeft aria-hidden /> Back to fleet
        </Button>
      </EmptyState>
    );
  }

  const runsDone = [...lane.runs.values()].filter((r) => r.state !== 'active').length;
  const activeRuns = [...lane.runs.values()].filter((r) => r.state === 'active');
  const pending = [...lane.attention.values()].filter(
    (i) => i.state === 'pending' || i.state === 'responding',
  ).length;
  const selected = selectedId ? lane.byId.get(selectedId) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate({ view: 'fleet' })}
          aria-label="Back to fleet"
          title="Back to fleet"
        >
          <ArrowLeft />
        </Button>
        <h1 className="text-base font-semibold">{lane.agent ?? '(unknown agent)'}</h1>
        {lane.label && <span className="text-sm text-muted-foreground">{lane.label}</span>}
        <CopyId id={lane.session} />
        <Badge variant={lane.status === 'active' ? 'active' : 'ended'}>{lane.status}</Badge>
        {lane.gap && (
          <Badge variant="gap" title="The relay's replay buffer no longer reaches this observer's position — older history is gone, not hidden.">
            history gap
          </Badge>
        )}
        {lane.source.kind === 'import' && <Badge variant="outline">imported</Badge>}
        {lane.source.kind === 'relay' && controller.config.relays.length > 1 && (
          <Badge variant="outline" title={lane.source.relay}>
            {relayDisplay(lane.source, controller.config.relays)}
          </Badge>
        )}
        {lane.trimmed > 0 && (
          <Badge
            variant="default"
            title="This lane reached its retention bound; the oldest raw events were dropped (run, attention, and severity state keep the whole story)."
          >
            {formatCount(lane.trimmed)} earlier events trimmed
          </Badge>
        )}
        {activeRuns.map((run) => (
          <CancelRunButton key={run.id} lane={lane} run={run} />
        ))}
        {lane.source.kind === 'relay' && <SteerButton lane={lane} />}
        {lane.source.kind === 'relay' && <PauseResumeControls lane={lane} />}
        <span className="ml-auto flex items-center gap-3 text-xs text-faint tabular-nums">
          <span>{formatCount(total)} events</span>
          <span>
            {runsDone}/{lane.runs.size} runs
          </span>
          {pending > 0 && <span className="text-family-attention">{pending} pending</span>}
        </span>
      </header>

      {/* Replay range: both ends adjustable — window any slice of history. */}
      <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2">
        <History className="size-4 shrink-0 text-faint" aria-hidden />
        <Slider
          aria-label="Replay window"
          min={0}
          max={total}
          step={1}
          value={win}
          onValueChange={(next) => {
            const [a = 0, b = total] = next;
            setRange(a === 0 && b === total ? null : [a, b]);
          }}
          className="max-w-lg"
        />
        <span className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {live ? `${total}/${total}` : `${win[0]}–${win[1]} of ${total}`}
        </span>
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-faint">
            <span className="size-1.5 rounded-full bg-foreground text-foreground mc-live-dot" aria-hidden />
            live — drag either end to replay
          </span>
        ) : (
          <>
            <span className="rounded-full bg-severity-warning/15 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-severity-warning">
              replay
            </span>
            <Button variant="outline" size="sm" onClick={() => setRange(null)}>
              Back to live
            </Button>
          </>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,460px)]">
        <Tabs defaultValue="timeline" className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <TabsList>
              <TabsTrigger value="timeline">
                <Rows3 aria-hidden /> Timeline
              </TabsTrigger>
              <TabsTrigger value="graph">
                <GitBranch aria-hidden /> Causal graph
              </TabsTrigger>
              <TabsTrigger value="state">
                <Boxes aria-hidden /> State
              </TabsTrigger>
              <TabsTrigger value="control">
                <SlidersHorizontal aria-hidden /> Control
              </TabsTrigger>
            </TabsList>
            <Input
              className="max-w-56"
              placeholder="Filter events…"
              aria-label="Filter events"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <TabsContent value="timeline" className="min-h-0 flex-1 rounded-xl border bg-card">
            <Timeline
              lane={lane}
              window={win}
              live={live}
              filter={filter}
              selectedId={selectedId}
              onSelect={setSelectedId}
              steps={steps}
            />
          </TabsContent>
          <TabsContent value="graph" className="min-h-0 flex-1 rounded-xl border bg-card">
            <CausalGraph
              session={lane.session}
              dag={dag}
              upToIds={windowIds}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </TabsContent>
          <TabsContent value="state" className="min-h-0 flex-1 rounded-xl border bg-card">
            <StatePanel state={laneState} />
          </TabsContent>
          <TabsContent value="control" className="min-h-0 flex-1 rounded-xl border bg-card">
            <ControlPanel lane={lane} />
          </TabsContent>
        </Tabs>
        <aside className="min-h-64 rounded-xl border bg-card lg:min-h-0">
          <Inspector ev={selected} />
        </aside>
      </div>
    </div>
  );
}
