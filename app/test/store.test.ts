// Reducer contract tests: ordering, idempotence, lifecycle derivations,
// seq-less foreign-emitter events, DAG edges, severity counts, live tail.
import { describe, expect, it } from 'vitest';
import type { AepEvent } from '@agenteventprotocol/sdk';
import { Store } from '../src/core/store';

let n = 0;
const mk = (type: string, extra: Record<string, unknown> = {}): AepEvent =>
  ({
    aep: '0.1',
    id: `ev_${String(++n).padStart(4, '0')}`,
    type,
    time: new Date(1700000000000 + n * 1000).toISOString(),
    source: 'aep://test/agent/sim',
    agent: 'sim',
    session: 's_test',
    epoch: 1,
    capture: 'metadata',
    ...extra,
  }) as AepEvent;

describe('ordering + idempotence', () => {
  it('insert-sorts out-of-order owner events and dedupes on id', () => {
    const store = new Store();
    const a = mk('session.started', { seq: 0, data: { label: 'demo' } });
    const b = mk('run.started', { seq: 1, run: 'r1', cause: a.id });
    const c = mk('tool.requested', { seq: 2, run: 'r1', cause: b.id });
    expect(store.apply(a)).toBe(true);
    expect(store.apply(c)).toBe(true);
    expect(store.apply(b)).toBe(true);
    const lane = store.sessions.get('s_test')!;
    expect(lane.events.map((o) => o.ev.seq)).toEqual([0, 1, 2]);
    expect(store.apply({ ...b })).toBe(false);
    expect(store.totalEvents).toBe(3);
    expect(lane.label).toBe('demo');
    expect(lane.agent).toBe('sim');
    expect(lane.status).toBe('active');
  });

  it('orders epoch 2 after epoch 1 at equal seq', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0, epoch: 1 }));
    store.apply(mk('log.emitted', { seq: 0, epoch: 2 }));
    const ords = store.sessions.get('s_test')!.events.map((o) => o.ord);
    expect(ords[1]!).toBeGreaterThan(ords[0]!);
  });

  it('keeps seq-less foreign-emitter events in arrival order without displacing owner events', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0 }));
    const cmd = mk('control.attention.respond', { agent: 'mission-control' });
    delete (cmd as Record<string, unknown>).seq;
    store.apply(cmd);
    store.apply(mk('run.started', { seq: 1, run: 'r1' }));
    const lane = store.sessions.get('s_test')!;
    const types = lane.events.map((o) => o.ev.type);
    expect(types[0]).toBe('session.started');
    expect(types).toContain('control.attention.respond');
    // unknown/control type tolerated (consumer conformance)
    expect(lane.byId.has(cmd.id)).toBe(true);
  });
});

describe('run + attention lifecycle', () => {
  it('walks pending → responding → (nack) pending → resolved off the stream', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0 }));
    store.apply(mk('run.started', { seq: 1, run: 'r1' }));
    const req = mk('attention.requested', {
      seq: 2,
      run: 'r1',
      severity: 'notice',
      data: {
        kind: 'permission',
        prompt: 'rm -rf build/?',
        options: [{ id: 'allow' }, { id: 'deny' }],
      },
    });
    store.apply(req);
    expect(store.pendingAttention()).toHaveLength(1);
    expect(store.pendingAttention()[0]!.request.id).toBe(req.id);

    store.markResponding(req.id);
    expect(store.pendingAttention()).toHaveLength(1); // still actionable
    expect(store.findAttention(req.id)!.state).toBe('responding');

    store.markRespondFailed(req.id, 'busy');
    expect(store.findAttention(req.id)!.state).toBe('pending');
    expect(store.findAttention(req.id)!.error).toBe('busy');

    store.apply(
      mk('attention.answered', { seq: 3, subject: req.id, data: { answer: { option: 'allow' } } }),
    );
    store.apply(mk('attention.resolved', { seq: 4, subject: req.id }));
    store.apply(mk('run.finished', { seq: 5, run: 'r1' }));
    store.apply(mk('session.ended', { seq: 6 }));

    const lane = store.sessions.get('s_test')!;
    const item = lane.attention.get(req.id)!;
    expect(item.state).toBe('resolved');
    expect((item.answer as { option?: string }).option).toBe('allow');
    expect(store.pendingAttention()).toHaveLength(0);
    expect(lane.runs.get('r1')!.state).toBe('finished');
    expect(lane.status).toBe('ended');
  });

  it('treats timeout as terminal even when an answer arrives later', () => {
    const store = new Store();
    const req = mk('attention.requested', { seq: 0, data: { kind: 'permission' } });
    store.apply(req);
    store.apply(mk('attention.timeout', { seq: 1, subject: req.id }));
    store.apply(
      mk('attention.answered', { seq: 2, subject: req.id, data: { answer: { option: 'allow' } } }),
    );
    expect(store.findAttention(req.id)!.state).toBe('timeout');
    expect(store.pendingAttention()).toHaveLength(0);
  });
});

describe('gap + change tracking + derived counts', () => {
  it('marks a lane on replay-exhausted', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0 }));
    store.markGap('s_test');
    expect(store.sessions.get('s_test')!.gap).toBe(true);
  });

  it('bumps store and lane versions on every change', () => {
    const store = new Store();
    const v0 = store.version;
    store.apply(mk('session.started', { seq: 0 }));
    const lane = store.sessions.get('s_test')!;
    const lv = lane.version;
    expect(store.version).toBeGreaterThan(v0);
    store.apply(mk('run.started', { seq: 1, run: 'r1' }));
    expect(lane.version).toBeGreaterThan(lv);
  });

  it('counts severities per lane (absent severity counts as info)', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0 }));
    store.apply(mk('log.emitted', { seq: 1, severity: 'warning' }));
    store.apply(mk('log.emitted', { seq: 2, severity: 'warning' }));
    store.apply(mk('log.emitted', { seq: 3, severity: 'critical' }));
    const counts = store.sessions.get('s_test')!.severityCounts;
    expect(counts.info).toBe(1);
    expect(counts.warning).toBe(2);
    expect(counts.critical).toBe(1);
  });

  it('keeps a global arrival-order tail across sessions', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0, session: 's_a' }));
    store.apply(mk('session.started', { seq: 0, session: 's_b' }));
    store.apply(mk('run.started', { seq: 1, run: 'r1', session: 's_a' }));
    expect(store.recent.map((ev) => ev.session)).toEqual(['s_a', 's_b', 's_a']);
  });

  it('buckets arrivals into the rate series (30s windows, newest last)', () => {
    const store = new Store();
    let clock = 1_000_000_000_000;
    store.now = () => clock;
    store.apply(mk('session.started', { seq: 0 }));
    store.apply(mk('log.emitted', { seq: 1 }));
    clock += 30_000; // next window
    store.apply(mk('log.emitted', { seq: 2 }));
    const series = store.rateSeries(4);
    expect(series).toEqual([0, 0, 2, 1]);
  });

  it('lists settled attention as the decision history, newest first', () => {
    const store = new Store();
    const a = mk('attention.requested', { seq: 0, data: { kind: 'permission' } });
    const b = mk('attention.requested', { seq: 1, data: { kind: 'question' } });
    const c = mk('attention.requested', { seq: 2, data: { kind: 'permission' } });
    for (const ev of [a, b, c]) store.apply(ev);
    store.apply(mk('attention.answered', { seq: 3, subject: a.id, data: { answer: { option: 'allow' } } }));
    store.apply(mk('attention.resolved', { seq: 4, subject: a.id }));
    store.apply(mk('attention.timeout', { seq: 5, subject: b.id }));

    const settled = store.settledAttention();
    expect(settled.map((i) => i.request.id)).toEqual([b.id, a.id]); // newest request first
    expect(settled.map((i) => i.state)).toEqual(['timeout', 'resolved']);
    expect(store.pendingAttention().map((i) => i.request.id)).toEqual([c.id]);
  });
});

describe('causal graph', () => {
  it('builds cause edges and only id-resolving subject edges', () => {
    const store = new Store();
    const a = mk('session.started', { seq: 0 });
    const b = mk('run.started', { seq: 1, run: 'r1', cause: a.id });
    const c = mk('tool.requested', { seq: 2, run: 'r1', cause: b.id, subject: 'Bash' });
    const d = mk('tool.completed', { seq: 3, run: 'r1', cause: c.id, subject: 'Bash' });
    const e = mk('attention.requested', { seq: 4, run: 'r1', cause: d.id });
    const f = mk('attention.resolved', { seq: 5, subject: e.id, cause: e.id });
    for (const ev of [a, b, c, d, e, f]) store.apply(ev);
    const dag = store.dag('s_test');
    expect(dag.nodes).toHaveLength(6);
    expect(dag.edges.filter((x) => x.kind === 'cause')).toHaveLength(5);
    // tool names are resources, not events — never edges
    expect(dag.edges.filter((x) => x.kind === 'subject')).toHaveLength(0);
  });
});

describe('observed control settles + kind families', () => {
  it('records the last settle per verb on the lane — observed, never declared', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0 }));
    store.recordControlSettle('s_test', 'control.attention.respond', {
      state: 'refused',
      reason: 'unsupported',
      detail: 'target does not accept control.attention.respond',
    });
    const lane = store.sessions.get('s_test')!;
    const settle = lane.control.get('control.attention.respond')!;
    expect(settle.state).toBe('refused');
    expect(settle.reason).toBe('unsupported');
    expect(settle.at).toBeGreaterThan(0);
    // a later settle overwrites: the panel shows the LAST observed truth
    store.recordControlSettle('s_test', 'control.attention.respond', { state: 'accepted' });
    expect(lane.control.get('control.attention.respond')!.state).toBe('accepted');
    expect(lane.control.get('control.attention.respond')!.reason).toBeUndefined();
    expect(lane.control.size).toBe(1);
  });

  it('bumps the lane version and notifies on a settle', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0 }));
    const lane = store.sessions.get('s_test')!;
    const before = lane.version;
    let notified: string | null | undefined;
    store.subscribe((k) => {
      notified = k;
    });
    store.recordControlSettle('s_test', 'control.cancel', { state: 'accepted' });
    expect(lane.version).toBeGreaterThan(before);
    expect(notified).toBe('s_test');
  });

  it('folds observed kind families from applied events (durable across the raw tail)', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0 }));
    store.apply(mk('tool.completed', { seq: 1, run: 'r1' }));
    store.apply(mk('x.hermes.approval.decision', { seq: 2 }));
    const lane = store.sessions.get('s_test')!;
    expect([...lane.kindsSeen]).toEqual(expect.arrayContaining(['session', 'tool', 'x.hermes']));
    expect(lane.kindsSeen.has('x')).toBe(false);
  });
});
