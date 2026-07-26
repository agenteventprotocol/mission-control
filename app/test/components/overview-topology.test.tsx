// The Connections overview draws the OPS/LOCAL-STACK relationships: the ops
// server is a NODE (not just a text tag on the relay hub), Mission Control
// links to it over the ops API, it manages its relay, and the agents it
// runs carry a managed marker — all lifted through the existing onOpsState
// seam, no new polling.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { OverviewTopology } from '../../src/views/connections/overview-topology';

const introspection = {
  ok: true,
  relay: { sessions: 1, subscribers: 1, connections: 1, uptime_s: 5, control: true },
  connections: [
    {
      role: 'emitter',
      identity: { agent: 'hermes', instance: 'host-1' },
      accepts: [],
      sessions: ['s_1'],
      subscriptions: 0,
    },
  ],
  sse_subscribers: 0,
};

const RELAYS = [{ url: 'http://127.0.0.1:8787', token: 'tok', label: '' }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubIntrospection() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(introspection),
  }));
}

describe('OverviewTopology — the ops node', () => {
  it('draws the local stack as a node with its port, the ops-API link, the manages edge, and managed-agent markers', async () => {
    stubIntrospection();
    render(
      <OverviewTopology
        relays={RELAYS}
        opsRelayUrl="http://127.0.0.1:8787"
        opsRelayUp
        opsEndpoint={{ url: 'http://127.0.0.1:8799', reachable: true }}
        opsManagedAgents={['hermes']}
      />,
    );
    expect(screen.getByText('Local stack (ops)')).toBeTruthy();
    expect(screen.getByText(':8799')).toBeTruthy();
    expect(screen.getByText('ops API (panel ↔ local stack)')).toBeTruthy(); // legend
    expect(screen.getByText('manages (relay + marked agents)')).toBeTruthy(); // legend
    await screen.findByText('hermes'); // the introspection poll landed
    await waitFor(() =>
      expect(screen.getByText(/managed by the local stack \(started via the ops API\)/i)).toBeTruthy());
  });

  it('draws no ops node when the panel has no ops endpoint to report', () => {
    stubIntrospection();
    render(<OverviewTopology relays={RELAYS} />);
    expect(screen.queryByText('Local stack (ops)')).toBeNull();
    expect(screen.queryByText('ops API (panel ↔ local stack)')).toBeNull();
  });
});

describe('OverviewTopology — bridge producers', () => {
  it('draws a live ops bridge as a producer chip: short label, bridge tag, managed dot marker', async () => {
    stubIntrospection();
    render(
      <OverviewTopology
        relays={RELAYS}
        opsRelayUrl="http://127.0.0.1:8787"
        opsRelayUp
        opsEndpoint={{ url: 'http://127.0.0.1:8799', reachable: true }}
        opsManagedAgents={[]}
        opsBridges={['bridge-otlp-in']}
      />,
    );
    expect(screen.getByText('otlp-in')).toBeTruthy();
    expect(screen.getByText('bridge')).toBeTruthy();
    // the bridge daemon is ops-state truth — it carries the same managed
    // marker the panel-managed agents get
    expect(screen.getByText(/managed by the local stack \(started via the ops API\)/i)).toBeTruthy();
    // the hierarchy legend line, in plain words
    expect(screen.getByText(/an agent class \(catalog\) runs as daemon instances; instances emit sessions; sessions carry runs/i)).toBeTruthy();
  });

  it('draws no bridge chip without ops bridge state (polled truth only)', () => {
    stubIntrospection();
    render(<OverviewTopology relays={RELAYS} />);
    expect(screen.queryByText('bridge')).toBeNull();
  });
});
