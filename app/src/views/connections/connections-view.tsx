// The Connections view (#/connections): operator visibility and control over
// the plumbing — each configured relay's live topology (browser-direct off
// the relay's introspection endpoint), and the local reference stack over
// the setup tool's ops API. Everything here is polled operational state;
// the event-sourced store and the session views stay untouched.
import { useCallback, useState } from 'react';
import { useController, useConnectionStatus } from '@/state/use-store';
import type { OpsState } from '@/lib/ops';
import { RelayCard } from './relay-card';
import { OpsPanel } from './ops-panel';
import { OverviewTopology } from './overview-topology';
import { RelayEditor } from './relay-editor';

export function ConnectionsView() {
  const controller = useController();
  useConnectionStatus(controller);
  const relays = controller.config.relays;
  // which relay the local stack manages — and whether ITS probe says up, so
  // the matching card and the overview can reconcile that vantage with the
  // browser's own reach (they are different facts; conflating them is how a
  // "start it" hint ends up pointing at a running relay)
  const [opsRelay, setOpsRelay] = useState<{ url: string; managed: boolean; up: boolean } | null>(null);
  // the ops server itself + the agents it manages, lifted so the overview
  // can DRAW the local stack's relationships (node + edges) instead of a
  // text tag — the endpoint rides only while the panel actually reaches it
  const [opsEndpoint, setOpsEndpoint] = useState<{ url: string; reachable: boolean } | null>(null);
  const [opsManagedAgents, setOpsManagedAgents] = useState<string[]>([]);
  // live non-manual bridge daemons, lifted the same way — the overview
  // draws them as producer chips (ops-state truth, not stream-derived)
  const [opsBridges, setOpsBridges] = useState<string[]>([]);
  const onOpsState = useCallback((s: OpsState | null, endpoint?: { url: string; reachable: boolean }) => {
    setOpsRelay(s ? { url: s.relay.url.trim().replace(/\/$/, ''), managed: s.relay.managed, up: s.relay.up } : null);
    setOpsEndpoint(s && endpoint ? endpoint : null);
    setOpsManagedAgents(s ? s.agents.filter((a) => a.managed).map((a) => a.id) : []);
    setOpsBridges(s ? s.bridges.filter((b) => !b.manual && b.daemon?.up).map((b) => b.id) : []);
  }, []);

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 overflow-y-auto p-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Overview</h2>
        <p className="text-xs text-muted-foreground">
          Every configured relay, port-labeled, with its producers and Mission Control&rsquo;s own
          stream connection — the edge color is the same state the status dot reports.
        </p>
        <OverviewTopology
          relays={relays}
          opsRelayUrl={opsRelay?.url ?? null}
          opsRelayUp={Boolean(opsRelay?.up)}
          opsEndpoint={opsEndpoint}
          opsManagedAgents={opsManagedAgents}
          opsBridges={opsBridges}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Relays</h2>
          <RelayEditor />
        </div>
        <p className="text-xs text-muted-foreground">
          Who is connected to each relay, what they accept, and which sessions they own — from
          each relay&rsquo;s own introspection endpoint. Read-only and token-gated; an
          implementation surface of the reference relay, not part of the protocol.
        </p>
        {relays.map((relay) => (
          <RelayCard
            key={relay.url}
            relay={relay}
            managedByOps={Boolean(opsRelay?.managed && opsRelay.url === relay.url.trim().replace(/\/$/, ''))}
            stackReportsUp={Boolean(opsRelay?.up && opsRelay.url === relay.url.trim().replace(/\/$/, ''))}
          />
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Local stack</h2>
        <OpsPanel onState={onOpsState} />
      </section>
    </div>
  );
}
