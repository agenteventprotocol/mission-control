// Per-lane activity pulse: the session's own event arrivals over the last
// 20 minutes as a tiny area sparkline — derived on demand from the lane's
// event times (single series; the accessible label names it).
import { useMemo } from 'react';
import type { Lane } from '@/core/store';

const BUCKETS = 24;
const WINDOW_MS = 20 * 60_000;
const W = 72;
const H = 20;

export function LanePulse({ lane, now }: { lane: Lane; now: number }) {
  const series = useMemo(() => {
    const out = new Array<number>(BUCKETS).fill(0);
    const bucketMs = WINDOW_MS / BUCKETS;
    const start = now - WINDOW_MS;
    // Newest-first walk; stop once events age out of the window.
    for (let i = lane.events.length - 1; i >= 0; i--) {
      const t = Date.parse(String(lane.events[i]!.ev.time));
      if (Number.isNaN(t)) continue;
      if (t < start) break;
      const idx = Math.min(BUCKETS - 1, Math.floor((t - start) / bucketMs));
      out[idx]!++;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lane.events mutates in place; lane.version is its change signal
  }, [lane.events, lane.version, now]);

  const max = Math.max(...series, 1);
  const step = W / (BUCKETS - 1);
  const points = series.map(
    (v, i) => `${(i * step).toFixed(1)},${(H - 1.5 - (v / max) * (H - 4)).toFixed(1)}`,
  );
  const area = `0,${H} ${points.join(' ')} ${W},${H}`;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Session activity over the last 20 minutes"
      className="shrink-0"
    >
      <polygon points={area} className="fill-primary/15" />
      <polyline
        points={points.join(' ')}
        fill="none"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-primary/80"
      />
    </svg>
  );
}
