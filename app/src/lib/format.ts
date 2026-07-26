/** "just now" / "42s ago" / "3m ago" / "2h ago" for live age labels. */
export function formatAge(deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return '';
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 1) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/** Wall-clock time with milliseconds for timeline rows ("14:03:22.481"). */
export function formatClock(time: string): string {
  const t = Date.parse(time);
  if (Number.isNaN(t)) return time;
  const d = new Date(t);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Compact integer display ("12", "4.2k"). */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}
