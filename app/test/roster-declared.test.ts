// The declared-capability column (AEP-0003 §4.1 roster) and the from=all
// cold start (§5 replay-all) — the two consumer surfaces the protocol
// gained, consumed honestly: declared data is a labeled snapshot BESIDE the
// observed-settle map, never a gate on the send path; ambiguity (a session
// with two live claimants) is rendered, never merged; a relay that does not
// advertise a surface never receives the request (roster) or gets the
// enumerated fallback (from).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AepEvent } from '@agenteventprotocol/sdk';
import type * as AepSdk from '@agenteventprotocol/sdk';

const { subscribeCalls, rosterMock } = vi.hoisted(() => ({
  subscribeCalls: [] as Array<Record<string, unknown>>,
  rosterMock: vi.fn(),
}));

vi.mock('@agenteventprotocol/sdk', async (importOriginal) => {
  const real = await importOriginal<typeof AepSdk>();
  return {
    ...real,
    subscribe: vi.fn((opts: Record<string, unknown>) => {
      subscribeCalls.push(opts);
      return { close: vi.fn(), positions: () => [] };
    }),
    ControlClient: class {
      roster = rosterMock;
      send = vi.fn();
      close = vi.fn();
    },
  };
});

import { Store, laneKey } from '../src/core/store';
import { Connection } from '../src/core/connection';

const SOURCE = { kind: 'relay' as const, relay: 'http://127.0.0.1:19640' };

let n = 0;
const mk = (type: string, session: string): AepEvent =>
  ({
    aep: '0.1',
    id: `ev_${String(++n).padStart(4, '0')}`,
    type,
    time: new Date(1700000000000 + n * 1000).toISOString(),
    source: `aep://test/agent/hermes/session/${session}`,
    agent: 'hermes',
    session,
    seq: n,
    epoch: 1,
    capture: 'metadata',
  }) as AepEvent;

describe('store: the declared column (recordRoster)', () => {
  it('records roster entries per lane verbatim, as claims, with a snapshot timestamp', () => {
    const store = new Store();
    store.apply(mk('session.started', 's_ro'), { source: SOURCE });
    store.recordRoster(
      [{ session: 's_ro', agent: 'hermes', instance: 'host-1',
        control: { accepts: ['control.attention.respond'], ack_window_ms: 9000 },
        emits: ['session', 'tool'] }],
      { source: SOURCE },
    );
    const lane = store.sessions.get(laneKey(SOURCE, 's_ro'))!;
    expect(lane.declared).toHaveLength(1);
    expect(lane.declared![0]!.accepts).toEqual(['control.attention.respond']);
    expect(lane.declared![0]!.ackWindowMs).toBe(9000);
    expect(lane.declared![0]!.agent).toBe('hermes');
    expect(lane.declared![0]!.emits).toEqual(['session', 'tool']);
    expect(lane.declaredAt).toBeGreaterThan(0);
  });

  it('keeps two claimants of one session as TWO claims — visible ambiguity, never merged', () => {
    const store = new Store();
    store.apply(mk('session.started', 's_amb'), { source: SOURCE });
    store.recordRoster(
      [
        { session: 's_amb', agent: 'agent-a', control: { accepts: ['control.cancel'] } },
        { session: 's_amb', agent: 'agent-b', control: { accepts: ['control.pause'] } },
      ],
      { source: SOURCE },
    );
    const lane = store.sessions.get(laneKey(SOURCE, 's_amb'))!;
    expect(lane.declared).toHaveLength(2);
    expect(lane.declared!.map((c) => c.agent).sort()).toEqual(['agent-a', 'agent-b']);
  });

  it('clears a lane to an EMPTY claim list when the roster no longer lists it (absence = no live route)', () => {
    const store = new Store();
    store.apply(mk('session.started', 's_gone'), { source: SOURCE });
    store.recordRoster([{ session: 's_gone', agent: 'hermes', control: { accepts: [] } }], { source: SOURCE });
    expect(store.sessions.get(laneKey(SOURCE, 's_gone'))!.declared).toHaveLength(1);
    store.recordRoster([], { source: SOURCE });
    expect(store.sessions.get(laneKey(SOURCE, 's_gone'))!.declared).toHaveLength(0);
  });

  it('never touches lanes from a DIFFERENT source (each relay answers for itself)', () => {
    const store = new Store();
    const other = { kind: 'relay' as const, relay: 'http://127.0.0.1:19641' };
    store.apply(mk('session.started', 's_other'), { source: other });
    store.recordRoster([], { source: SOURCE });
    expect(store.sessions.get(laneKey(other, 's_other'))!.declared).toBeUndefined();
  });
});

describe('connection: the from=all cold start and the gated roster', () => {
  beforeEach(() => {
    subscribeCalls.length = 0;
    rosterMock.mockReset();
    vi.unstubAllGlobals();
  });

  const positions = { load: () => [{ session: 's_known', epoch: 1, seq: 7 }], save: () => {} };

  const stubDiscovery = (caps: Record<string, unknown> | null) => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      caps === null
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ aep: ['0.1'], capabilities: caps }) },
    ));
  };

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("uses from:'all' when the discovery document advertises replay.all", async () => {
    stubDiscovery({ replay: { buffer: 100, all: true } });
    const conn = new Connection({ url: SOURCE.relay, store: new Store(), positions });
    conn.start();
    await flush();
    expect(subscribeCalls).toHaveLength(1);
    expect(subscribeCalls[0]!.from).toBe('all');
    conn.stop();
  });

  it('falls back to the enumerated known-session set when replay.all is not advertised', async () => {
    stubDiscovery({ replay: { buffer: 100 } });
    const conn = new Connection({ url: SOURCE.relay, store: new Store(), positions });
    conn.start();
    await flush();
    expect(subscribeCalls).toHaveLength(1);
    expect(subscribeCalls[0]!.from).toEqual([{ session: 's_known', epoch: 0, seq: -1 }]);
    conn.stop();
  });

  it('falls back the same way when the discovery fetch fails (older relays stay first-class)', async () => {
    stubDiscovery(null);
    const conn = new Connection({ url: SOURCE.relay, store: new Store(), positions });
    conn.start();
    await flush();
    expect(subscribeCalls).toHaveLength(1);
    expect(subscribeCalls[0]!.from).toEqual([{ session: 's_known', epoch: 0, seq: -1 }]);
    conn.stop();
  });

  it('fetchRoster NEVER sends the frame when capabilities.roster was not advertised', async () => {
    stubDiscovery({ replay: { buffer: 100 } });
    const store = new Store();
    const conn = new Connection({ url: SOURCE.relay, store, positions });
    conn.start();
    await flush();
    expect(conn.rosterSupported()).toBe(false);
    expect(await conn.fetchRoster()).toBeNull();
    expect(rosterMock).not.toHaveBeenCalled();
    conn.stop();
  });

  it('fetchRoster requests, records into the store, and returns the entries when advertised', async () => {
    stubDiscovery({ roster: {}, replay: { buffer: 100 } });
    rosterMock.mockResolvedValue([
      { session: 's_ro', agent: 'hermes', control: { accepts: ['control.attention.respond'] } },
    ]);
    const store = new Store();
    store.apply(mk('session.started', 's_ro'), { source: SOURCE });
    const conn = new Connection({ url: SOURCE.relay, store, positions });
    conn.start();
    await flush();
    expect(conn.rosterSupported()).toBe(true);
    const entries = await conn.fetchRoster();
    expect(rosterMock).toHaveBeenCalledTimes(1);
    expect(entries).toHaveLength(1);
    const lane = store.sessions.get(laneKey(SOURCE, 's_ro'))!;
    expect(lane.declared).toHaveLength(1);
    expect(lane.declared![0]!.accepts).toEqual(['control.attention.respond']);
    conn.stop();
  });
});
