// Per-lane retention bound: lanes drop their oldest events past the cap
// (mirroring the relay's own bounded replay buffer), count what was
// trimmed, keep the id-dedupe set consistent across the boundary, and keep
// derived lifecycle state working even when the raw events are gone.
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
    ...extra,
  }) as AepEvent;

describe('per-lane cap', () => {
  it('drops oldest past the cap, keeps newest, and counts the trim', () => {
    const store = new Store();
    store.laneCap = 5;
    const events = Array.from({ length: 8 }, (_, i) => mk('log.emitted', { seq: i }));
    for (const ev of events) store.apply(ev);

    const lane = store.sessions.get('s_cap')!;
    expect(lane.events.map((o) => o.ev.seq)).toEqual([3, 4, 5, 6, 7]);
    expect(lane.trimmed).toBe(3);
    expect(lane.byId.size).toBe(5);
    // counters keep the whole story even when raw events are gone
    expect(store.totalEvents).toBe(8);
    expect(lane.severityCounts.info).toBe(8);
    // the replay window's floor is the earliest retained event
    expect(lane.events[0]!.ev.seq).toBe(3);
  });

  it('keeps the dedupe set consistent: a dropped id re-buffers instead of vanishing silently', () => {
    const store = new Store();
    store.laneCap = 5;
    const events = Array.from({ length: 8 }, (_, i) => mk('log.emitted', { seq: i }));
    for (const ev of events) store.apply(ev);
    const lane = store.sessions.get('s_cap')!;

    // The dropped event is no longer "known" — re-applying it is a real
    // apply (returns true), and the cap policy then trims it again as the
    // oldest, counted.
    const trimmedBefore = lane.trimmed;
    expect(store.apply(events[0]!)).toBe(true);
    expect(lane.trimmed).toBe(trimmedBefore + 1);
    expect(lane.byId.has(events[0]!.id)).toBe(false);
    expect(lane.events.map((o) => o.ev.seq)).toEqual([3, 4, 5, 6, 7]);
    // a retained event is still a duplicate
    expect(store.apply(events[5]!)).toBe(false);
  });

  it('keeps attention lifecycle working after the request event was trimmed away', () => {
    const store = new Store();
    store.laneCap = 3;
    const req = mk('attention.requested', { seq: 0, data: { kind: 'permission' } });
    store.apply(req);
    for (let i = 1; i <= 4; i++) store.apply(mk('log.emitted', { seq: i }));
    const lane = store.sessions.get('s_cap')!;
    expect(lane.byId.has(req.id)).toBe(false); // raw event trimmed

    store.apply(
      mk('attention.answered', { seq: 5, subject: req.id, data: { answer: { option: 'allow' } } }),
    );
    const item = lane.attention.get(req.id)!;
    expect(item.state).toBe('answered'); // derived state survived the trim
  });

  it('applies the same cap to imported lanes', () => {
    const store = new Store();
    store.laneCap = 5;
    const events = Array.from({ length: 7 }, (_, i) =>
      mk('log.emitted', { seq: i, session: 's_imp' }),
    );
    importCapture(store, events.map((ev) => JSON.stringify(ev)).join('\n'));
    const lane = store.sessions.get(laneKey(IMPORT_SOURCE, 's_imp'))!;
    expect(lane.events).toHaveLength(5);
    expect(lane.trimmed).toBe(2);
    expect(lane.source.kind).toBe('import');
  });
});
