// Capture import contract: a JSONL file fed through the same reducer as the
// live stream must produce identical lane state, tolerate a torn final line
// with a counted skip, keep imported attention out of the actionable inbox,
// and never leak bulk history into the live-arrival surfaces (tail, rate).
import { describe, expect, it } from 'vitest';
import type { AepEvent } from '@agenteventprotocol/sdk';
import { IMPORT_SOURCE, Store, laneKey } from '../src/core/store';
import { importCapture } from '../src/core/import';

let n = 0;
const mk = (type: string, extra: Record<string, unknown> = {}): AepEvent =>
  ({
    aep: '0.1',
    id: `ev_${String(++n).padStart(4, '0')}`,
    type,
    time: new Date(1700000000000 + n * 1000).toISOString(),
    source: 'aep://test/agent/sim',
    agent: 'sim',
    session: 's_cap',
    epoch: 1,
    capture: 'metadata',
    ...extra,
  }) as AepEvent;

const capture = (events: AepEvent[]): string =>
  events.map((ev) => JSON.stringify(ev)).join('\n') + '\n';

function fixtureSession(): AepEvent[] {
  const started = mk('session.started', { seq: 0, data: { label: 'captured run' } });
  const run = mk('run.started', { seq: 1, run: 'r1', cause: started.id });
  const req = mk('attention.requested', {
    seq: 2,
    run: 'r1',
    severity: 'notice',
    data: { kind: 'permission', prompt: 'proceed?', options: [{ id: 'allow' }, { id: 'deny' }] },
  });
  return [
    started,
    run,
    req,
    mk('attention.answered', { seq: 3, subject: req.id, data: { answer: { option: 'allow' } } }),
    mk('attention.resolved', { seq: 4, subject: req.id, cause: req.id }),
    mk('log.emitted', { seq: 5, severity: 'warning' }),
    mk('run.finished', { seq: 6, run: 'r1' }),
    mk('session.ended', { seq: 7 }),
  ];
}

describe('import parity with live delivery', () => {
  it('produces the same lane state as receiving the same events live', () => {
    const events = fixtureSession();
    const live = new Store();
    for (const ev of events) live.apply(ev);
    const imported = new Store();
    const result = importCapture(imported, capture(events));

    expect(result.applied).toBe(events.length);
    expect(result.skipped).toBe(0);
    expect(result.sessions).toEqual(['s_cap']);

    const a = live.sessions.get('s_cap')!;
    const b = imported.sessions.get(laneKey(IMPORT_SOURCE, 's_cap'))!;
    expect(b.events.map((o) => o.ev.id)).toEqual(a.events.map((o) => o.ev.id));
    expect(b.events.map((o) => o.ord)).toEqual(a.events.map((o) => o.ord));
    expect(b.status).toBe(a.status);
    expect(b.agent).toBe(a.agent);
    expect(b.label).toBe(a.label);
    expect(b.severityCounts).toEqual(a.severityCounts);
    expect([...b.runs.values()].map((r) => r.state)).toEqual(
      [...a.runs.values()].map((r) => r.state),
    );
    expect(b.attention.size).toBe(a.attention.size);
    expect([...b.attention.values()].map((i) => i.state)).toEqual(
      [...a.attention.values()].map((i) => i.state),
    );
  });

  it('dedupes on id against events already received live', () => {
    const events = fixtureSession();
    const store = new Store();
    for (const ev of events.slice(0, 4)) store.apply(ev);
    const result = importCapture(store, capture(events));
    expect(result.applied).toBe(events.length - 4);
    // a single live claimant exists, so the capture merged into that lane
    expect(store.sessions.get('s_cap')!.events).toHaveLength(events.length);
    expect(store.sessions.get('s_cap')!.source.kind).toBe('relay');
  });
});

describe('torn and corrupt lines', () => {
  it('skips a torn final line with a count and applies the rest', () => {
    const events = fixtureSession();
    const text = capture(events).trimEnd();
    const torn = text.slice(0, text.length - 25); // cut inside the last JSON object
    const store = new Store();
    const result = importCapture(store, torn);
    expect(result.skipped).toBe(1);
    expect(result.applied).toBe(events.length - 1);
  });

  it('ignores blank lines without counting them as skips', () => {
    const events = fixtureSession().slice(0, 2);
    const store = new Store();
    const result = importCapture(store, `\n${JSON.stringify(events[0])}\n\n${JSON.stringify(events[1])}\n\n`);
    expect(result.applied).toBe(2);
    expect(result.skipped).toBe(0);
  });
});

describe('imported lanes are offline', () => {
  it('flags the lane and keeps unsettled attention out of the actionable inbox', () => {
    const started = mk('session.started', { seq: 0, session: 's_inert' });
    const req = mk('attention.requested', {
      seq: 1,
      session: 's_inert',
      data: { kind: 'permission', prompt: 'never settled' },
    });
    const store = new Store();
    const result = importCapture(store, capture([started, req]));
    expect(result.applied).toBe(2);

    const lane = store.sessions.get(laneKey(IMPORT_SOURCE, 's_inert'))!;
    expect(lane.source.kind).toBe('import');
    // The item exists (history is intact) but is never actionable.
    expect(lane.attention.get(req.id)!.state).toBe('pending');
    expect(store.pendingAttention()).toHaveLength(0);
  });

  it('never flags a lane that already exists live, and un-flags on live traffic', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0, session: 's_live' }));
    importCapture(store, capture([mk('log.emitted', { seq: 1, session: 's_live' })]));
    expect(store.sessions.get('s_live')!.source.kind).toBe('relay');

    importCapture(store, capture([mk('session.started', { seq: 0, session: 's_later' })]));
    expect(store.sessions.get(laneKey(IMPORT_SOURCE, 's_later'))!.source.kind).toBe('import');
    store.apply(mk('log.emitted', { seq: 1, session: 's_later' }));
    expect(store.sessions.get('s_later')!.source.kind).toBe('relay');
  });

  it('keeps bulk history out of the live tail and the arrival-rate series', () => {
    const store = new Store();
    let clock = 1_000_000_000_000;
    store.now = () => clock;
    store.apply(mk('session.started', { seq: 0, session: 's_live2' }));
    importCapture(store, capture(fixtureSession()));
    expect(store.recent).toHaveLength(1);
    expect(store.recent[0]!.session).toBe('s_live2');
    expect(store.rateSeries(2)).toEqual([0, 1]);
    clock += 1;
  });
});
