// The cross-relay overview, readable at a glance: three LABELED columns —
// Agents → Relays → Mission Control — with a plain-words legend for the
// edge colors. The relay↔MC edge is colored by the SAME per-relay stream
// state that drives the rail status dot, so "which relay is which port, and
// is MC actually listening to it" is answered in one glance and never
// contradicts the rail. Producer chips navigate to Fleet; relay chips
// scroll to their card. Polled operational state, outside the event store.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { RelayEntry } from '@/state/config';
import type { Controller } from '@/state/controller';
import { useOptionalController } from '@/state/use-store';
import { navigate } from '@/state/router';
import { streamErrorHint } from '@/lib/troubleshoot';
import { STATUS_DOT_COLOR } from '@/components/ui/status-dot';
import { fetchRelayIntrospection, type RelayIntrospection } from '@/lib/ops';

const POLL_MS = 5000;
const ROW = 40;
const NODE_W = 150;
const NODE_H = 30;
const WIDTH = 640;
const HEADER_H = 22;

/** Anchor id for a relay's card, shared with RelayCard so hub clicks land. */
export function relayCardAnchor(url: string): string {
  return `relay-card-${url.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

function relayPort(url: string): string {
  try {
    const u = new URL(url);
    return u.port || (u.protocol === 'https:' ? '443' : '80');
  } catch {
    return '';
  }
}

/** Subscribe to controller changes when one is mounted; no-op otherwise. */
function useMaybeConnectionVersion(controller: Controller | null): void {
  const subscribe = useCallback(
    (onChange: () => void) => (controller ? controller.subscribe(onChange) : () => {}),
    [controller],
  );
  useSyncExternalStore(subscribe, () => controller?.version ?? 0);
}

// Edge strokes ride the shared status-dot palette (SVG cannot mount the
// span component, so it consumes the color map): same state, same color as
// the rail dot.
const STREAM_EDGE: Record<string, string> = {
  live: STATUS_DOT_COLOR.live,
  connecting: STATUS_DOT_COLOR.connecting,
  error: STATUS_DOT_COLOR.error,
  idle: STATUS_DOT_COLOR.off,
};

const LEGEND: Array<{ state: string; label: string }> = [
  { state: 'live', label: 'events flowing' },
  { state: 'connecting', label: 'connecting' },
  { state: 'error', label: 'stream error' },
  { state: 'idle', label: 'not connected' },
];

export function OverviewTopology({ relays, opsRelayUrl, opsRelayUp, opsEndpoint, opsManagedAgents, opsBridges }: {
  relays: RelayEntry[];
  /** The relay the local-stack ops API manages, when known — tagged on its hub. */
  opsRelayUrl?: string | null;
  /** Whether the local stack's own probe reports that relay up — the edge
      hint reconciles that vantage with the browser's failure. */
  opsRelayUp?: boolean;
  /** The local-stack ops server itself (serve): drawn as its own node with
      the Mission-Control→ops edge colored by the panel's reachability —
      the "how does ops relate to the rest" answer, on the diagram. */
  opsEndpoint?: { url: string; reachable: boolean } | null;
  /** Agents the local stack manages (daemons it starts) — marked on their chips. */
  opsManagedAgents?: string[];
  /** Live non-manual bridge daemons from the ops state — drawn as producer
      chips in the Agents column of the local stack's relay band. Polled ops
      truth only, never derived from the event stream. */
  opsBridges?: string[];
}) {
  const controller = useOptionalController();
  useMaybeConnectionVersion(controller);
  const [intros, setIntros] = useState<Record<string, RelayIntrospection | null>>({});

  useEffect(() => {
    let alive = true;
    let seq = 0; // overlapping ticks: only the newest result may land
    const tick = async () => {
      const mine = ++seq;
      const entries = await Promise.all(
        relays.map(async (r) => {
          const url = r.url.trim().replace(/\/$/, '');
          return [url, await fetchRelayIntrospection(url, r.token)] as const;
        }),
      );
      if (alive && mine === seq) setIntros(Object.fromEntries(entries));
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [relays]);

  if (relays.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
        No relays configured yet — connect the local stack below, or add one under Manage relays.
      </p>
    );
  }

  // one band per relay; each band is as tall as its producer list (bridge
  // daemons count as producers in the local stack's own band)
  const bands = relays.map((r) => {
    const url = r.url.trim().replace(/\/$/, '');
    const producers = (intros[url]?.connections ?? []).filter((p) => p.role !== 'consumer');
    const bridges = opsRelayUrl === url ? (opsBridges ?? []) : [];
    return { entry: r, url, producers, bridges, rows: Math.max(producers.length + bridges.length, 1) };
  });
  const bandsHeight = HEADER_H + bands.reduce((h, b) => h + b.rows * ROW, 0) + 20;
  const mcX = WIDTH - NODE_W - 4;
  const mcY = HEADER_H + (bandsHeight - HEADER_H) / 2 - NODE_H / 2;
  const hubX = WIDTH / 2 - NODE_W / 2;
  // the ops node sits under Mission Control in its column; the canvas grows
  // to fit it when the panel has an endpoint to draw
  const opsX = mcX;
  const opsY = mcY + NODE_H + 26;
  const height = opsEndpoint ? Math.max(bandsHeight, opsY + NODE_H + 16) : bandsHeight;

  const edge = (x1: number, y1: number, x2: number, y2: number) =>
    `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;

  const layout = bands.reduce<{
    acc: Array<(typeof bands)[number] & { y: number; hubY: number }>;
    y: number;
  }>(
    (s, b) => {
      s.acc.push({ ...b, y: s.y, hubY: s.y + (b.rows * ROW - NODE_H) / 2 - 5 });
      return { acc: s.acc, y: s.y + b.rows * ROW };
    },
    { acc: [], y: HEADER_H + 10 },
  ).acc;

  const scrollToCard = (url: string) => {
    document.getElementById(relayCardAnchor(url))?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div data-testid="overview-topology" className="space-y-2">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" role="img" aria-label="All relays overview">
        {/* column headers: what each column IS */}
        <text x={4 + NODE_W / 2} y={13} textAnchor="middle" className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
          Agents
        </text>
        <text x={hubX + NODE_W / 2} y={13} textAnchor="middle" className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
          Relays
        </text>
        <text x={mcX + NODE_W / 2} y={13} textAnchor="middle" className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
          Mission Control
        </text>
        {layout.map((b) => {
          const status = controller?.statuses.get(b.url);
          const streamState = status?.state ?? 'idle';
          const streamTitle = streamState === 'error'
            ? `Mission Control stream: error — ${status?.detail ?? ''} ${streamErrorHint(status?.detail, {
                stackReportsUp: Boolean(opsRelayUp) && opsRelayUrl === b.url && !intros[b.url],
              })}`
            : `Mission Control stream: ${streamState === 'idle' ? 'not connected' : streamState}`;
          return (
            <g key={b.url}>
              {Array.from({ length: b.producers.length + b.bridges.length }, (_, i) => (
                <path
                  key={`pe-${i}`}
                  d={edge(NODE_W + 8, b.y + i * ROW + NODE_H / 2, hubX - 4, b.hubY + NODE_H / 2)}
                  fill="none" stroke="var(--color-border)" strokeWidth={1.5}
                />
              ))}
              <path
                d={edge(hubX + NODE_W + 4, b.hubY + NODE_H / 2, mcX - 4, mcY + NODE_H / 2)}
                fill="none"
                stroke={STREAM_EDGE[streamState] ?? STREAM_EDGE.idle}
                strokeWidth={1.5}
                strokeDasharray={streamState === 'live' ? undefined : '4 3'}
              >
                <title>{streamTitle}</title>
              </path>
              {b.producers.length === 0 && b.bridges.length === 0 && (
                <g transform={`translate(4,${b.y})`}>
                  <rect width={NODE_W} height={NODE_H} rx={8} fill="none" stroke="var(--color-border)" strokeDasharray="3 3" />
                  <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    no agents connected yet
                  </text>
                </g>
              )}
              {b.producers.map((p, i) => {
                const agent = p.identity?.agent ?? '(anonymous)';
                const managed = (opsManagedAgents ?? []).includes(agent);
                return (
                  <g
                    key={`p-${i}`}
                    transform={`translate(4,${b.y + i * ROW})`}
                    role="button"
                    aria-label={`Open ${agent} in Fleet`}
                    className="cursor-pointer"
                    onClick={() => navigate({ view: 'fleet', q: agent })}
                  >
                    <title>{`Open ${agent} in Fleet`}</title>
                    <rect width={NODE_W} height={NODE_H} rx={8} fill="var(--color-card)" stroke="var(--color-border)" />
                    <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
                      {agent}
                    </text>
                    {managed && (
                      <circle cx={NODE_W - 8} cy={8} r={3} fill="var(--color-primary)">
                        <title>managed by the local stack (started via the ops API)</title>
                      </circle>
                    )}
                  </g>
                );
              })}
              {b.bridges.map((bid, i) => {
                const row = b.producers.length + i;
                return (
                  <g key={`b-${bid}`} transform={`translate(4,${b.y + row * ROW})`}>
                    <title>{`${bid} — a protocol bridge daemon the local stack manages; the sessions it emits carry the upstream agent's id`}</title>
                    <rect width={NODE_W} height={NODE_H} rx={8} fill="var(--color-card)" stroke="var(--color-border)" />
                    <text x={NODE_W / 2} y={13} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
                      {bid.replace(/^bridge-/, '')}
                    </text>
                    <text x={NODE_W / 2} y={25} textAnchor="middle" className="fill-muted-foreground text-[9px]">
                      bridge
                    </text>
                    <circle cx={NODE_W - 8} cy={8} r={3} fill="var(--color-primary)">
                      <title>managed by the local stack (started via the ops API)</title>
                    </circle>
                  </g>
                );
              })}
              <g
                transform={`translate(${hubX},${b.hubY})`}
                role="button"
                aria-label={`Show relay ${b.entry.label ?? b.url} details`}
                className="cursor-pointer"
                onClick={() => scrollToCard(b.url)}
              >
                <title>{`Relay ${b.url} — click for details`}</title>
                <rect width={NODE_W} height={NODE_H} rx={8} fill="var(--color-primary)" stroke="var(--color-border)" opacity={0.9} />
                <text x={NODE_W / 2} y={13} textAnchor="middle" className="fill-primary-foreground text-[11px] font-semibold">
                  {b.entry.label ?? 'relay'}
                </text>
                <text x={NODE_W / 2} y={25} textAnchor="middle" className="fill-primary-foreground text-[9px]">
                  :{relayPort(b.url)}{opsRelayUrl === b.url ? ' · local stack' : ''}
                </text>
              </g>
            </g>
          );
        })}
        <g transform={`translate(${mcX},${mcY})`}>
          <rect width={NODE_W} height={NODE_H} rx={8} fill="var(--color-card)" stroke="var(--color-border)" />
          <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
            Mission Control
          </text>
        </g>
        {opsEndpoint && (
          <g>
            {/* the panel talks to the ops API: browser-side reachability colors it */}
            <path
              d={`M ${mcX + NODE_W / 2} ${mcY + NODE_H} L ${opsX + NODE_W / 2} ${opsY}`}
              fill="none"
              stroke={opsEndpoint.reachable ? STREAM_EDGE.live : STREAM_EDGE.error}
              strokeWidth={1.5}
              strokeDasharray={opsEndpoint.reachable ? undefined : '4 3'}
            >
              <title>{`ops API ${opsEndpoint.url} — ${opsEndpoint.reachable ? 'reachable' : 'unreachable'} from this browser`}</title>
            </path>
            {/* the ops server manages its relay (start/stop/restart) */}
            {layout.filter((b) => opsRelayUrl === b.url).map((b) => (
              <path
                key={`ops-manage-${b.url}`}
                d={edge(hubX + NODE_W + 4, b.hubY + NODE_H / 2 + 6, opsX - 4, opsY + NODE_H / 2)}
                fill="none"
                stroke="var(--color-border)"
                strokeWidth={1.5}
                strokeDasharray="2 3"
              >
                <title>the local stack manages this relay (start / stop / restart over the ops API)</title>
              </path>
            ))}
            <g transform={`translate(${opsX},${opsY})`}>
              <title>{`the setup tool's ops server (${opsEndpoint.url}) — Mission Control manages the local stack through it; every action has a CLI mirror`}</title>
              <rect width={NODE_W} height={NODE_H} rx={8} fill="var(--color-card)" stroke="var(--color-border)" strokeDasharray="3 3" />
              <text x={NODE_W / 2} y={13} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
                Local stack (ops)
              </text>
              <text x={NODE_W / 2} y={25} textAnchor="middle" className="fill-muted-foreground text-[9px]">
                :{relayPort(opsEndpoint.url)}
              </text>
            </g>
          </g>
        )}
      </svg>
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground" aria-label="Legend">
        {LEGEND.map(({ state, label }) => (
          <span key={state} className="flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-0.5 w-4 rounded"
              style={{ background: STREAM_EDGE[state] }}
            />
            {label}
          </span>
        ))}
        {opsEndpoint && (
          <>
            <span className="flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-0.5 w-4 rounded"
                style={{ background: opsEndpoint.reachable ? STREAM_EDGE.live : STREAM_EDGE.error }}
              />
              ops API (panel ↔ local stack)
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden className="inline-block h-0.5 w-4 rounded border-b border-dashed border-border" />
              manages (relay + marked agents)
            </span>
          </>
        )}
        <span className="ml-auto">agent chips open Fleet · relay chips open their card</span>
        {/* the hierarchy, in plain words — what a chip, a daemon, and a lane ARE */}
        <span className="basis-full">
          an agent class (catalog) runs as daemon instances; instances emit sessions; sessions carry runs
        </span>
      </div>
    </div>
  );
}
