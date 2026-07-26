// Fleet vitals: four stat tiles. Values are plain figures with labels; the
// throughput tile carries a 20-minute arrival sparkline (single series, so
// the label names it — no legend).
import { useEffect, useState } from 'react';
import { Activity, BellRing, Radio, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Store } from '@/core/store';
import { severityRank } from '@/lib/aep';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

function Sparkline({ series }: { series: number[] }) {
  const w = 120;
  const h = 28;
  const max = Math.max(...series, 1);
  const step = w / Math.max(series.length - 1, 1);
  const points = series
    .map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Event arrivals over the last 20 minutes"
      className="shrink-0"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-primary"
      />
    </svg>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  tone,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: 'attention' | 'warning';
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5">
      <Icon
        className={cn(
          'size-4 shrink-0',
          tone === 'attention'
            ? 'text-family-attention'
            : tone === 'warning'
              ? 'text-severity-warning'
              : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <div
          className={cn(
            'text-lg leading-6 font-semibold',
            tone === 'attention' && 'text-family-attention',
          )}
        >
          {value}
        </div>
        <div className="text-xs whitespace-nowrap text-faint">{label}</div>
      </div>
      {children && <div className="ml-auto pl-2">{children}</div>}
    </div>
  );
}

const WARN_WINDOW_MS = 15 * 60_000;

export function StatStrip({ store }: { store: Store }) {
  // The strip refreshes with store changes via the parent; this ticker only
  // keeps the time windows sliding while the stream is quiet.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  let active = 0;
  for (const lane of store.sessions.values()) if (lane.status === 'active') active++;
  const pending = store.pendingAttention().length;

  const series = store.rateSeries(40); // 40 × 30s = 20 min
  const perMin = (series[series.length - 1] ?? 0) + (series[series.length - 2] ?? 0);

  // Walk the arrival tail newest-first until events age out of the window.
  const cutoff = nowTs - WARN_WINDOW_MS;
  let warnings = 0;
  for (let i = store.recent.length - 1; i >= 0; i--) {
    const ev = store.recent[i]!;
    const t = Date.parse(String(ev.time));
    if (!Number.isNaN(t) && t < cutoff) break;
    if (severityRank(ev.severity) >= 3) warnings++;
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
      <Tile icon={Radio} label="active sessions" value={formatCount(active)} />
      <Tile
        icon={BellRing}
        label="pending attention"
        value={String(pending)}
        tone={pending > 0 ? 'attention' : undefined}
      />
      <Tile icon={Activity} label="events / min" value={formatCount(perMin)}>
        <Sparkline series={series} />
      </Tile>
      <Tile
        icon={TriangleAlert}
        label="warnings+ · 15 min"
        value={formatCount(warnings)}
        tone={warnings > 0 ? 'warning' : undefined}
      />
    </div>
  );
}
