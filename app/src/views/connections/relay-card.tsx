// One configured relay: vitals + live topology, fetched browser-direct from
// the relay's own introspection endpoint with the token the operator already
// configured. Polled while mounted; the core store is never involved.
import { useEffect, useState } from 'react';
import { Waypoints } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { StatusDot } from '@/components/ui/status-dot';
import type { RelayEntry } from '@/state/config';
import type { Controller } from '@/state/controller';
import { fetchRelayIntrospection, type RelayIntrospection } from '@/lib/ops';
import { navigate } from '@/state/router';
import { useOptionalController, useConnectionStatus } from '@/state/use-store';
import { streamErrorHint } from '@/lib/troubleshoot';
import { relayCardAnchor } from './overview-topology';

/**
 * The same per-relay stream state that drives the rail dot, rendered ON the
 * card — the introspection poll and Mission Control's own subscription are
 * different facts, and showing both side by side keeps them from silently
 * contradicting each other.
 */
function StreamStatus({ url, stackReportsUp }: { url: string; stackReportsUp?: boolean }) {
  const controller = useOptionalController();
  if (!controller) return null;
  return <StreamStatusInner url={url} controller={controller} stackReportsUp={stackReportsUp} />;
}

function StreamStatusInner({ url, controller, stackReportsUp }: { url: string; controller: Controller; stackReportsUp?: boolean }) {
  useConnectionStatus(controller);
  const status = controller.statuses.get(url);
  const state = status?.state ?? 'idle';
  return (
    <div className="space-y-1">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <StatusDot state={state === 'idle' ? 'off' : state} />
        Mission Control stream: {state === 'idle' ? 'not connected' : state}
        {state === 'error' && status?.detail && (
          <code className="text-[10px] text-destructive">{status.detail}</code>
        )}
      </span>
      {state === 'error' && (
        <p className="text-[11px] text-muted-foreground">{streamErrorHint(status?.detail, { stackReportsUp })}</p>
      )}
    </div>
  );
}

const POLL_MS = 5000;

function uptime(s: number): string {
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

export function RelayCard({ relay, managedByOps, stackReportsUp }: { relay: RelayEntry; managedByOps?: boolean; stackReportsUp?: boolean }) {
  const [intro, setIntro] = useState<RelayIntrospection | null>(null);
  const [failed, setFailed] = useState(false);
  const url = relay.url.trim().replace(/\/$/, '');

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const result = await fetchRelayIntrospection(url, relay.token);
      if (!alive) return;
      setIntro(result);
      setFailed(result === null);
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [url, relay.token]);

  return (
    <section id={relayCardAnchor(url)} className="scroll-mt-4 rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Waypoints className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">{relay.label ?? url}</h3>
        <span className="text-xs text-muted-foreground">{url}</span>
        {managedByOps && (
          <Badge variant="outline" title="This is the relay the Local stack section manages.">
            managed by local stack
          </Badge>
        )}
        {intro && (
          <Badge variant={intro.relay.control ? 'default' : 'outline'} className="ml-auto">
            control {intro.relay.control ? 'on' : 'off'}
          </Badge>
        )}
      </header>
      <div className="mt-2">
        {/* a successful introspection poll proves the browser DOES reach the
            relay — the split-vantage reading only holds while it does not */}
        <StreamStatus url={url} stackReportsUp={Boolean(stackReportsUp) && intro === null} />
      </div>

      {failed && (
        <p className="mt-3 text-xs text-muted-foreground">
          No introspection from this relay (older build, wrong token, or the relay is down) —
          the endpoint is <code className="text-[11px]">GET /connections</code> on the
          reference relay.
        </p>
      )}

      {intro && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            up {uptime(intro.relay.uptime_s)} · {intro.relay.sessions} sessions ·{' '}
            {intro.relay.connections} connections · {intro.relay.subscribers} subscriptions
            {intro.sse_subscribers > 0 ? ` (${intro.sse_subscribers} over SSE)` : ''}
          </p>
          <ul className="mt-3 space-y-2">
            {intro.connections.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-medium">{p.identity?.agent ?? '(anonymous)'}</span>
                {p.identity?.instance && (
                  <span className="text-muted-foreground">@{p.identity.instance}</span>
                )}
                {p.role === 'consumer' && (
                  <Badge variant="outline" className="text-[10px]">consumer</Badge>
                )}
                {(p.accepts ?? []).map((verb) => (
                  <Badge key={verb} variant="outline" className="font-mono text-[10px]">
                    {verb}
                  </Badge>
                ))}
                {p.sessions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="cursor-pointer rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                    title={`Open session ${s} in Fleet`}
                    onClick={() => navigate({ view: 'session', session: s })}
                  >
                    {s}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
