// Run-cancel discipline: the in-flight `cancelling` marker mirrors the
// attention item's pending → responding rules exactly — optimistic on send,
// reverted (with the error surfaced) on nack or ack-window silence, and the
// run's STATE settling only when a terminal arrives on the stream
// (AEP-0004 §5: a control sender never depends on outcomes it has not
// observed as Events).
import { describe, expect, it } from 'vitest';
import type { AepEvent } from '@aep/sdk';
import { Store, laneKey } from '../src/core/store';
import { Controller } from '../src/state/controller';

let n = 0;
const mk = (type: string, extra: Record<string, unknown> = {}): AepEvent =>
  ({
    aep: '0.1',
    id: `ev_${String(++n).padStart(4, '0')}`,
    type,
    time: new Date(1700000000000 + n * 1000).toISOString(),
    source: 'aep://test/agent/sim',
    agent: 'sim',
    session: 's_cancel',
    epoch: 1,
    capture: 'metadata',
    ...extra,
  }) as AepEvent;

const activeRun = (store: Store): string => {
  store.apply(mk('session.started', { seq: 0 }));
  store.apply(mk('run.started', { seq: 1, run: 'r1' }));
  return 's_cancel'; // anonymous default source: lane key = bare session id
};

describe('cancelling marker (store)', () => {
  it('arms only on an active run; unknown or settled runs are no-ops', () => {
    const store = new Store();
    const key = activeRun(store);
    const lane = store.sessions.get(key)!;

    store.markRunCancelling(key, 'r_missing');
    expect(lane.runs.get('r_missing')).toBeUndefined();

    store.markRunCancelling(key, 'r1');
    expect(lane.runs.get('r1')!.cancelling).toBe(true);
    expect(lane.runs.get('r1')!.state).toBe('active'); // marker, not a state

    store.apply(mk('run.finished', { seq: 2, run: 'r1' }));
    store.markRunCancelling(key, 'r1'); // settled: must not re-arm
    expect(lane.runs.get('r1')!.cancelling).toBeFalsy();
  });

  it('settles ONLY from the stream: run.cancelled clears the marker and sets the state', () => {
    const store = new Store();
    const key = activeRun(store);
    const lane = store.sessions.get(key)!;
    store.markRunCancelling(key, 'r1');

    const cancelled = mk('run.cancelled', {
      seq: 2,
      run: 'r1',
      cause: 'cmd_0001',
      data: { by: 'control', reason: 'operator requested stop' },
    });
    store.apply(cancelled);
    const run = lane.runs.get('r1')!;
    expect(run.state).toBe('cancelled');
    expect(run.cancelling).toBeFalsy();
    expect(run.error).toBeUndefined();
    expect(run.endedId).toBe(cancelled.id);
  });

  it('any terminal settles a cancel in flight (the run beat the command)', () => {
    const store = new Store();
    const key = activeRun(store);
    store.markRunCancelling(key, 'r1');
    store.apply(mk('run.finished', { seq: 2, run: 'r1' }));
    const run = store.sessions.get(key)!.runs.get('r1')!;
    expect(run.state).toBe('finished');
    expect(run.cancelling).toBeFalsy();
  });

  it('nack/timeout reverts the marker and surfaces the error; re-arming clears it', () => {
    const store = new Store();
    const key = activeRun(store);
    const lane = store.sessions.get(key)!;

    store.markRunCancelFailed(key, 'r1', 'refused'); // not in flight: no-op
    expect(lane.runs.get('r1')!.error).toBeUndefined();

    store.markRunCancelling(key, 'r1');
    store.markRunCancelFailed(key, 'r1', 'refused: agent is sovereign');
    const run = lane.runs.get('r1')!;
    expect(run.cancelling).toBeFalsy();
    expect(run.state).toBe('active'); // still cancellable
    expect(run.error).toBe('refused: agent is sovereign');

    store.markRunCancelling(key, 'r1'); // retry re-arms and clears the error
    expect(run.cancelling).toBe(true);
    expect(run.error).toBeUndefined();
  });

  it('bumps the lane version so subscribed views re-render', () => {
    const store = new Store();
    const key = activeRun(store);
    const lane = store.sessions.get(key)!;
    const before = lane.version;
    store.markRunCancelling(key, 'r1');
    expect(lane.version).toBeGreaterThan(before);
  });
});

describe('controller.cancelRun routing guards', () => {
  it('fails fast when the lane has no connected relay, surfaced on the run', () => {
    const controller = new Controller();
    const source = { kind: 'relay', relay: 'http://gone:1' } as const;
    controller.store.apply(mk('session.started', { seq: 0, session: 's_dead' }), { source });
    controller.store.apply(mk('run.started', { seq: 1, run: 'r9', session: 's_dead' }), { source });
    const key = laneKey(source, 's_dead');

    expect(controller.canCancelRun(key)).toBe(false);
    controller.cancelRun(key, 'r9', 'operator requested stop');
    const run = controller.store.sessions.get(key)!.runs.get('r9')!;
    expect(run.cancelling).toBeFalsy();
    expect(run.error).toBe('relay not connected');
    expect(run.state).toBe('active'); // never settled locally
  });

  it('an import-sourced lane is never cancellable (no live backchannel)', () => {
    const controller = new Controller();
    const source = { kind: 'import' } as const;
    controller.store.apply(mk('session.started', { seq: 0, session: 's_cap' }), { source });
    controller.store.apply(mk('run.started', { seq: 1, run: 'r1', session: 's_cap' }), { source });
    expect(controller.canCancelRun(laneKey(source, 's_cap'))).toBe(false);
  });
});
