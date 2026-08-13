// Multi-relay contract (ARCHITECTURE.md §4): lane identity is
// (source, session); a LaneSource names a relay or a capture import; the
// capture rebind rule; per-source gating; the persisted relay config.
import { describe, expect, it } from 'vitest';
import type { AepEvent } from '@agenteventprotocol/sdk';
import { Store, laneKey, IMPORT_SOURCE, type LaneSource } from '../src/core/store';
import {
  loadConfig, saveConfig, positionStore, ingestOpsConnectHash,
  DEFAULT_RELAY_URL, type ConfigStorage,
} from '../src/state/config';

let n = 0;
const mk = (type: string, extra: Record<string, unknown> = {}): AepEvent =>
  ({
    aep: '0.1',
    id: `mr_${String(++n).padStart(4, '0')}`,
    type,
    time: new Date(1700000000000 + n * 1000).toISOString(),
    source: 'aep://test/agent/sim',
    agent: 'sim',
    session: 's_mr',
    epoch: 1,
    capture: 'metadata',
    ...extra,
  }) as AepEvent;

const A: LaneSource = { kind: 'relay', relay: 'http://127.0.0.1:8787' };
const B: LaneSource = { kind: 'relay', relay: 'http://127.0.0.1:8790' };

describe('lane identity: (source, session)', () => {
  it('the same session name on two relays is two lanes', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0, agent: 'agent-a' }), { source: A });
    store.apply(mk('session.started', { seq: 0, agent: 'agent-b' }), { source: B });
    expect(store.sessions.size).toBe(2);
    const a = store.sessions.get(laneKey(A, 's_mr'))!;
    const b = store.sessions.get(laneKey(B, 's_mr'))!;
    expect(a.agent).toBe('agent-a');
    expect(b.agent).toBe('agent-b');
    expect(a.session).toBe('s_mr');
    expect(b.session).toBe('s_mr');
    expect(a.key).not.toBe(b.key);
    expect(a.source).toEqual(A);
  });

  it('an anonymous (test/default) apply keys by the bare session id', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0 }));
    expect(store.sessions.get('s_mr')).toBeDefined();
    expect(store.sessions.get('s_mr')!.source).toEqual({ kind: 'relay', relay: '' });
  });

  it('laneKeyOf resolves an applied event back to its lane', () => {
    const store = new Store();
    const ev = mk('session.started', { seq: 0 });
    store.apply(ev, { source: A });
    expect(store.laneKeyOf(ev)).toBe(laneKey(A, 's_mr'));
  });

  it('derivations stay per-lane: a run terminal on relay A never touches relay B', () => {
    const store = new Store();
    store.apply(mk('run.started', { seq: 0, run: 'r1' }), { source: A });
    store.apply(mk('run.started', { seq: 0, run: 'r1' }), { source: B });
    store.apply(mk('run.failed', { seq: 1, run: 'r1', data: { reason: 'x' } }), { source: A });
    expect(store.sessions.get(laneKey(A, 's_mr'))!.runs.get('r1')!.state).toBe('failed');
    expect(store.sessions.get(laneKey(B, 's_mr'))!.runs.get('r1')!.state).toBe('active');
  });

  it('markGap is per source', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0 }), { source: A });
    store.apply(mk('session.started', { seq: 0 }), { source: B });
    store.markGap('s_mr', { source: A });
    expect(store.sessions.get(laneKey(A, 's_mr'))!.gap).toBe(true);
    expect(store.sessions.get(laneKey(B, 's_mr'))!.gap).toBe(false);
  });
});

describe('imports under composite keys', () => {
  it('an import-sourced lane rebinds to the first live claimant, history kept', () => {
    const store = new Store();
    const req = mk('attention.requested', { seq: 0, severity: 'notice' });
    store.apply(req, { source: IMPORT_SOURCE });
    store.apply(mk('tool.requested', { seq: 1 }), { source: IMPORT_SOURCE });
    expect(store.sessions.get(laneKey(IMPORT_SOURCE, 's_mr'))!.source.kind).toBe('import');
    expect(store.pendingAttention()).toHaveLength(0); // history, not actionable

    const live = mk('run.started', { seq: 2, run: 'r1' });
    store.apply(live, { source: A });
    // one lane, re-keyed to the relay, everything retained
    expect(store.sessions.size).toBe(1);
    const lane = store.sessions.get(laneKey(A, 's_mr'))!;
    expect(lane.source).toEqual(A);
    expect(lane.byId.has(req.id)).toBe(true);
    expect(lane.events).toHaveLength(3);
    // the attention index followed the rebind
    const item = store.findAttention(req.id)!;
    expect(item.laneKey).toBe(laneKey(A, 's_mr'));
    expect(store.pendingAttention()).toHaveLength(1); // now live, now actionable
  });

  it('a capture of a session with exactly one live lane merges into it', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0 }), { source: A });
    const hist = mk('tool.requested', { seq: 1 });
    store.apply(hist, { source: IMPORT_SOURCE });
    expect(store.sessions.size).toBe(1); // the capture is that session's history
    const lane = store.sessions.get(laneKey(A, 's_mr'))!;
    expect(lane.source).toEqual(A);
    expect(lane.byId.has(hist.id)).toBe(true);
  });

  it('an import stays its own lane when two live claimants exist (never guess)', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0 }), { source: A });
    store.apply(mk('session.started', { seq: 0 }), { source: B });
    store.apply(mk('session.started', { seq: 0 }), { source: IMPORT_SOURCE });
    expect(store.sessions.size).toBe(3);
    expect(store.sessions.get(laneKey(IMPORT_SOURCE, 's_mr'))!.source.kind).toBe('import');
  });

  it('bulk import history stays out of the live tail; live applies do not', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0 }), { source: IMPORT_SOURCE });
    expect(store.recent).toHaveLength(0);
    store.apply(mk('session.started', { seq: 0, session: 's_other' }), { source: A });
    expect(store.recent).toHaveLength(1);
  });
});

describe('attention items carry their lane key', () => {
  it('pendingAttention items name the owning lane across relays', () => {
    const store = new Store();
    const reqA = mk('attention.requested', { seq: 0 });
    const reqB = mk('attention.requested', { seq: 0 });
    store.apply(reqA, { source: A });
    store.apply(reqB, { source: B });
    const pending = store.pendingAttention();
    expect(pending).toHaveLength(2);
    const keys = pending.map((p) => p.laneKey).sort();
    expect(keys).toEqual([laneKey(A, 's_mr'), laneKey(B, 's_mr')].sort());
    // the wire session id is untouched — commands must carry it
    expect(pending.every((p) => p.session === 's_mr')).toBe(true);
  });
});

describe('persisted relay config', () => {
  const memory = (seed: Record<string, string> = {}): ConfigStorage => {
    const map = new Map(Object.entries(seed));
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
    };
  };

  it('a saved relay set reads back with labels intact', () => {
    const storage = memory();
    saveConfig(
      { relays: [{ url: 'http://a:1', token: '' }, { url: 'http://b:2', token: 'tb', label: 'ci' }] },
      storage,
    );
    expect(loadConfig(storage).relays).toEqual([
      { url: 'http://a:1', token: '' },
      { url: 'http://b:2', token: 'tb', label: 'ci' },
    ]);
  });

  it('corrupted or empty storage degrades to the built-in default relay', () => {
    expect(loadConfig(memory({ 'aep-mc:config': '{{nope' })).relays).toEqual([
      { url: DEFAULT_RELAY_URL, token: '' },
    ]);
    expect(loadConfig(memory()).relays).toEqual([{ url: DEFAULT_RELAY_URL, token: '' }]);
  });

  it('entries missing a url are dropped on load; an all-bad list degrades to default', () => {
    const storage = memory({
      'aep-mc:config': JSON.stringify({ relays: [{ token: 'x' }, { url: 'http://ok:1', token: '' }] }),
    });
    expect(loadConfig(storage).relays).toEqual([{ url: 'http://ok:1', token: '' }]);
    const bad = memory({ 'aep-mc:config': JSON.stringify({ relays: [42] }) });
    expect(loadConfig(bad).relays).toEqual([{ url: DEFAULT_RELAY_URL, token: '' }]);
  });

  it('positionStore.save caps the persisted known-session set at the newest 500', () => {
    // Unbounded accumulation once grew the set until the stream request
    // itself was refused. 500 matches the reference relay's session
    // buffer — entries beyond it replay nothing anywhere.
    const storage = memory();
    const store = positionStore('http://cap:1', storage);
    store.save(Array.from({ length: 700 }, (_, i) => ({ session: `s_${i}`, epoch: 0, seq: i })));
    const back = store.load();
    expect(back.length).toBe(500);
    expect(back[0]?.session).toBe('s_200');
    expect(back[499]?.session).toBe('s_699');
  });
});

describe('the serve connect link (zero-paste onboarding)', () => {
  it('parses #/connections?ops=…&opsToken=… into an ops config', () => {
    const hash = `#/connections?ops=${encodeURIComponent('http://127.0.0.1:8799')}&opsToken=${encodeURIComponent('tok-abc')}`;
    expect(ingestOpsConnectHash(hash)).toEqual({ url: 'http://127.0.0.1:8799', token: 'tok-abc' });
  });

  it('normalizes a trailing slash on the ops URL', () => {
    const hash = `#/connections?ops=${encodeURIComponent('http://127.0.0.1:8799/')}&opsToken=t`;
    expect(ingestOpsConnectHash(hash)).toEqual({ url: 'http://127.0.0.1:8799', token: 't' });
  });

  it('rejects other routes, missing fields, and non-URL junk', () => {
    expect(ingestOpsConnectHash('#/fleet?q=x')).toBeNull();
    expect(ingestOpsConnectHash('#/connections')).toBeNull();
    expect(ingestOpsConnectHash('#/connections?ops=http%3A%2F%2F127.0.0.1%3A8799')).toBeNull();
    expect(ingestOpsConnectHash('#/connections?opsToken=t')).toBeNull();
    expect(ingestOpsConnectHash('#/connections?ops=not-a-url&opsToken=t')).toBeNull();
  });
});
