// The home view: fleet vitals up top, then one card per session in a
// responsive grid behind the filter bar, severity lens and sort. Also the
// drop target for JSONL captures (offline lanes).
import { useMemo, useState } from 'react';
import { LayoutGrid, Satellite } from 'lucide-react';
import { ImportCapture, importFiles, summarizeImport } from './import-capture';
import { severityRank } from '@/lib/aep';
import type { Lane } from '@/core/store';
import { useController, useStoreVersion, useConnectionStatus } from '@/state/use-store';
import { streamErrorHint } from '@/lib/troubleshoot';
import { useRoute } from '@/state/router';
import { EmptyState } from '@/components/layout/empty-state';
import { ViewHeader } from '@/components/layout/view-header';
import { StatStrip } from './stat-strip';
import { FilterBar, DEFAULT_FILTER, type FleetFilter } from './filter-bar';
import { SessionCard, pendingCount } from './session-card';

function matchesFilter(lane: Lane, filter: FleetFilter, lensRank: number): boolean {
  if (filter.status !== 'all' && lane.status !== filter.status) return false;
  if (filter.relay !== 'all' && !(lane.source.kind === 'relay' && lane.source.relay === filter.relay)) {
    return false;
  }
  if (filter.pendingOnly && pendingCount(lane) === 0) return false;
  if (lensRank > 0) {
    let reaches = false;
    for (const [sev, count] of Object.entries(lane.severityCounts)) {
      if (count && severityRank(sev) >= lensRank) {
        reaches = true;
        break;
      }
    }
    if (!reaches) return false;
  }
  if (filter.query) {
    const q = filter.query.toLowerCase();
    const hay = `${lane.agent ?? ''} ${lane.label ?? ''} ${lane.session}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function sortLanes(lanes: Lane[], sort: FleetFilter['sort']): Lane[] {
  switch (sort) {
    case 'attention':
      return lanes.sort(
        (a, b) => pendingCount(b) - pendingCount(a) || b.lastActivity - a.lastActivity,
      );
    case 'agent':
      return lanes.sort(
        (a, b) => (a.agent ?? '').localeCompare(b.agent ?? '') || b.lastActivity - a.lastActivity,
      );
    default:
      return lanes.sort((a, b) => b.lastActivity - a.lastActivity);
  }
}

export function FleetView() {
  const controller = useController();
  const store = controller.store;
  useStoreVersion(store);
  const [filter, setFilter] = useState<FleetFilter>(DEFAULT_FILTER);
  const [dropSummary, setDropSummary] = useState('');
  // `#/fleet?q=<agent>` seeds the free-text filter (the Connections
  // topology's producer-node navigation lands here); the bar stays editable.
  // Derived-state-during-render (not an effect): seed once per query change.
  const route = useRoute();
  const routeQuery = route.view === 'fleet' ? route.q : undefined;
  const [seenQuery, setSeenQuery] = useState<string | undefined>(undefined);
  if (routeQuery !== seenQuery) {
    setSeenQuery(routeQuery);
    if (routeQuery) setFilter((f) => ({ ...f, query: routeQuery }));
  }

  useConnectionStatus(controller);
  const worst = controller.status;
  const lensRank = useMemo(() => severityRank(filter.lens), [filter.lens]);
  const all = [...store.sessions.values()];
  const visible = sortLanes(
    all.filter((lane) => matchesFilter(lane, filter, lensRank)),
    filter.sort,
  );

  return (
    <div
      className="space-y-3"
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        void importFiles(store, e.dataTransfer.files).then((r) =>
          setDropSummary(summarizeImport(r)),
        );
      }}
    >
      <ViewHeader icon={LayoutGrid} title="Fleet" meta={`${all.length} session${all.length === 1 ? '' : 's'}`}>
        <ImportCapture store={store} lastSummary={dropSummary} />
      </ViewHeader>
      <StatStrip store={store} />
      <FilterBar
        filter={filter}
        onChange={setFilter}
        matches={visible.length}
        total={all.length}
        relays={controller.config.relays}
      />
      {all.length === 0 ? (
        // The empty fleet TEACHES (abstraction first, technical detail on
        // failure): a stream error names itself with a suggestion; a healthy
        // stream says what it is waiting for. Both point at Connections.
        worst.state === 'error' ? (
          <EmptyState icon={Satellite} title="Event stream error">
            <p>
              Mission Control cannot read events from a configured relay
              {worst.detail ? <> (<code>{worst.detail}</code>)</> : null}. {streamErrorHint(worst.detail)}
            </p>
            <p className="mt-1">
              <a className="underline" href="#/connections">Open Connections</a> to see and fix the
              stream, relay by relay.
            </p>
          </EmptyState>
        ) : worst.state === 'live' ? (
          <EmptyState icon={Satellite} title="Connected — waiting for agent events">
            <p>
              The event stream is live; no agent has emitted yet. Start one with a one-click
              scenario — <a className="underline" href="#/connections">Open Connections</a> — or
              run the synthetic demo from the README, and lanes appear here live.
            </p>
          </EmptyState>
        ) : (
          <EmptyState icon={Satellite} title="No sessions yet">
            <p>
              Waiting for events on the connected relay. Start an agent that emits AEP — or run the
              synthetic demo from the README — and lanes will appear here live. The{' '}
              <a className="underline" href="#/connections">Connections view</a> shows and manages
              every relay and local agent.
            </p>
          </EmptyState>
        )
      ) : visible.length === 0 ? (
        <EmptyState icon={Satellite} title="No sessions match the current filters" />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 2xl:grid-cols-2">
          {visible.map((lane) => (
            <SessionCard key={lane.key} store={store} session={lane.key} lens={filter.lens} />
          ))}
        </div>
      )}
    </div>
  );
}
