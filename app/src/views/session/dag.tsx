// Causal graph as an interactive canvas: layered layout (parents always
// precede children in store order, so depth = 1 + max parent depth) with a
// barycenter pass to keep edges short, bezier cause/subject edges, card
// nodes on a dot-grid, and wheel-zoom + drag-pan with fit/reset controls.
// Data comes from store.dag(); the replay window filters which nodes/edges
// are DRAWN — nothing is re-derived.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { AepEvent } from '@agenteventprotocol/sdk';
import type { Dag, DagEdge } from '@/core/store';
import { lastSegment } from '@/lib/aep';
import { formatClock } from '@/lib/format';
import { useEventHover } from '@/components/event/event-hover';
import { cn } from '@/lib/utils';

const NODE_W = 168;
const NODE_H = 46;
const X_GAP = 72;
const Y_GAP = 22;
const PAD = 32;
const MIN_K = 0.25;
const MAX_K = 2.5;

// Monochrome nodes; the accent bar carries significance only — severity
// heat from `warning` up, attention pink on attention.requested.
const HEAT_ACCENT: Record<string, string> = {
  warning: 'fill-severity-warning',
  error: 'fill-severity-error',
  critical: 'fill-severity-critical',
};

function accentFor(ev: AepEvent): string {
  if (ev.type === 'attention.requested') return 'fill-family-attention';
  if (ev.type.startsWith('run.step.')) return 'fill-foreground/50'; // step boundaries read as structure
  const sev = ev.severity ?? 'info';
  return HEAT_ACCENT[sev] ?? 'fill-foreground/25';
}

interface Layout {
  nodes: Array<{ ev: AepEvent; x: number; y: number }>;
  edges: DagEdge[];
  centers: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

/** Layered layout + one barycenter ordering pass per layer. */
function layout(nodes: AepEvent[], edges: DagEdge[]): Layout {
  const parentsOf = new Map<string, DagEdge[]>();
  for (const e of edges) {
    const list = parentsOf.get(e.to);
    if (list) list.push(e);
    else parentsOf.set(e.to, [e]);
  }
  const depthOf = new Map<string, number>();
  const layers: AepEvent[][] = [];
  for (const ev of nodes) {
    let d = 0;
    for (const p of parentsOf.get(ev.id) ?? []) {
      const pd = depthOf.get(p.from);
      if (pd !== undefined) d = Math.max(d, pd + 1);
    }
    depthOf.set(ev.id, d);
    (layers[d] ??= []).push(ev);
  }

  // Barycenter: order each layer by the mean row of its parents in the
  // previous ordering, so edges stay short and crossings stay rare.
  const rowOf = new Map<string, number>();
  layers.forEach((layerNodes, li) => {
    if (li > 0) {
      layerNodes.sort((a, b) => {
        const bary = (ev: AepEvent): number => {
          const parents = parentsOf.get(ev.id) ?? [];
          const rows = parents
            .map((p) => rowOf.get(p.from))
            .filter((r): r is number => r !== undefined);
          return rows.length ? rows.reduce((s, r) => s + r, 0) / rows.length : rowOf.size;
        };
        return bary(a) - bary(b);
      });
    }
    layerNodes.forEach((ev, ri) => rowOf.set(ev.id, ri));
  });

  const numLayers = Math.max(layers.length, 1);
  const maxRows = layers.reduce((m, l) => Math.max(m, l.length), 1);
  const width = PAD * 2 + numLayers * NODE_W + (numLayers - 1) * X_GAP;
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * Y_GAP;

  const centers = new Map<string, { x: number; y: number }>();
  const placed: Layout['nodes'] = [];
  layers.forEach((layerNodes, li) => {
    const x = PAD + li * (NODE_W + X_GAP) + NODE_W / 2;
    const totalH = layerNodes.length * NODE_H + (layerNodes.length - 1) * Y_GAP;
    const startY = (height - totalH) / 2;
    layerNodes.forEach((ev, ri) => {
      const y = startY + ri * (NODE_H + Y_GAP) + NODE_H / 2;
      centers.set(ev.id, { x, y });
      placed.push({ ev, x, y });
    });
  });
  return { nodes: placed, edges, centers, width, height };
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const sx = from.x + NODE_W / 2;
  const tx = to.x - NODE_W / 2;
  const dx = Math.min(Math.max((tx - sx) / 2, 28), 84);
  return `M ${sx} ${from.y} C ${sx + dx} ${from.y}, ${tx - dx} ${to.y}, ${tx} ${to.y}`;
}

export function CausalGraph({
  session,
  dag,
  upToIds,
  selectedId,
  onSelect,
}: {
  session: string;
  dag: Dag;
  /** Replay window: only these event ids are drawn (undefined = all). */
  upToIds?: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const hover = useEventHover();
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const { nodes, edges, centers, width, height } = useMemo(() => {
    const visible = upToIds
      ? {
          nodes: dag.nodes.filter((n) => upToIds.has(n.id)),
          edges: dag.edges.filter((e) => upToIds.has(e.from) && upToIds.has(e.to)),
        }
      : dag;
    return layout(visible.nodes, visible.edges);
  }, [dag, upToIds]);

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const k = Math.min(el.clientWidth / width, el.clientHeight / height, 1.2) * 0.94;
    setView({
      x: (el.clientWidth - width * k) / 2,
      y: (el.clientHeight - height * k) / 2,
      k,
    });
  }, [width, height]);

  // Fit once per session (not on every new event — that would fight the user).
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (fittedFor.current !== session) {
      fittedFor.current = session;
      fit();
    }
  }, [session, fit]);

  const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const el = containerRef.current;
      const px = cx ?? (el ? el.clientWidth / 2 : 0);
      const py = cy ?? (el ? el.clientHeight / 2 : 0);
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      const scale = k / v.k;
      return { k, x: px - (px - v.x) * scale, y: py - (py - v.y) * scale };
    });
  }, []);

  // Wheel zoom needs a non-passive listener to own the scroll gesture.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  if (nodes.length === 0) {
    return <div className="p-6 text-sm text-faint">No events in range.</div>;
  }

  return (
    <div ref={containerRef} className="relative h-full min-h-0 overflow-hidden rounded-[inherit]">
      <svg
        role="img"
        aria-label={`Causal graph for session ${session}`}
        className="block size-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { px: e.clientX, py: e.clientY, ox: view.x, oy: view.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const { px, py, ox, oy } = drag.current;
          setView((v) => ({ ...v, x: ox + (e.clientX - px), y: oy + (e.clientY - py) }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <defs>
          <pattern id="mc-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.2" className="fill-grid" />
          </pattern>
          <marker
            id="mc-arrow"
            viewBox="0 0 10 10"
            refX="8.5"
            refY="5"
            markerWidth="6.5"
            markerHeight="6.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9" fill="none" strokeWidth="1.8" className="stroke-faint" />
          </marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect
            x={-4000}
            y={-4000}
            width={8000 + width}
            height={8000 + height}
            fill="url(#mc-dots)"
          />
          <g fill="none">
            {edges.map((e, i) => {
              const from = centers.get(e.from);
              const to = centers.get(e.to);
              if (!from || !to) return null;
              const touched = e.from === selectedId || e.to === selectedId;
              return (
                <path
                  key={i}
                  d={edgePath(from, to)}
                  markerEnd="url(#mc-arrow)"
                  strokeWidth={touched ? 2 : e.kind === 'cause' ? 1.5 : 1.2}
                  className={cn(
                    touched ? 'stroke-ring' : 'stroke-faint/70',
                    e.kind === 'subject' && '[stroke-dasharray:5_4] opacity-75',
                  )}
                />
              );
            })}
          </g>
          <g>
            {nodes.map(({ ev, x, y }) => {
              const selected = ev.id === selectedId;
              const left = x - NODE_W / 2;
              const top = y - NODE_H / 2;
              return (
                <g
                  key={ev.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`Inspect ${ev.type} event`}
                  className="cursor-pointer outline-none [&:focus-visible>rect:first-of-type]:stroke-ring"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onSelect(ev.id)}
                  onMouseEnter={(e) => hover.show(ev, e.currentTarget)}
                  onMouseLeave={hover.hide}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(ev.id);
                    }
                  }}
                >
                  <rect
                    x={left}
                    y={top}
                    width={NODE_W}
                    height={NODE_H}
                    rx={10}
                    strokeWidth={selected ? 2 : 1.25}
                    className={cn(
                      'fill-popover transition-[stroke-width]',
                      selected ? 'stroke-ring' : 'stroke-input',
                    )}
                  />
                  <rect
                    x={left + 6}
                    y={top + 8}
                    width={3}
                    height={NODE_H - 16}
                    rx={1.5}
                    className={accentFor(ev)}
                  />
                  <text
                    x={left + 17}
                    y={top + 19}
                    className="fill-foreground font-mono text-[11px] font-medium"
                  >
                    {lastSegment(ev.type)}
                  </text>
                  <text x={left + 17} y={top + 35} className="fill-faint font-mono text-[9px]">
                    {typeof ev.seq === 'number' ? `#${ev.seq} · ` : ''}
                    {formatClock(String(ev.time))}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1 rounded-lg border bg-popover/90 p-1 shadow-sm backdrop-blur">
        <button
          type="button"
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.25)}
        >
          <Minus className="size-3.5" aria-hidden />
        </button>
        <span className="w-10 text-center text-[11px] text-faint tabular-nums">
          {Math.round(view.k * 100)}%
        </span>
        <button
          type="button"
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.25)}
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Fit graph to view"
          onClick={fit}
        >
          <Maximize className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
