// Store derivations for the step/state families (plans: the console renders
// what the AG-UI bridge emits). Steps derive from the ORDERED lane — a
// buffered event inserting mid-array must land inside its step — and state
// reconstruction is capture-honest: gated patches count, never fabricate.
import { describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';
import type { AepEvent } from '@agenteventprotocol/sdk';

const SRC = { kind: 'relay', relay: 'ws://fixture' } as const;
let seq = 0;
function ev(partial: Partial<AepEvent> & { type: string }): AepEvent {
  seq += 1;
  return {
    aep: '0.1',
    id: `ev_${String(seq).padStart(3, '0')}`,
    time: new Date(1700000000000 + seq * 1000).toISOString(),
    source: 'aep://host/agent/agui/session/s_1',
    agent: 'agui',
    session: 's_1',
    seq,
    epoch: 1,
    capture: 'metadata',
    ...partial,
  } as AepEvent;
}

function freshStore(): { store: Store } {
  return { store: new Store() };
}

function apply(store: Store, e: AepEvent) {
  store.apply(e, { source: SRC });
}

describe('stepsOf', () => {
  it('annotates members between started and finished, boundary rows included', () => {
    const { store } = freshStore();
    const run = 'run_1';
    const started = ev({ type: 'run.started', run });
    const s1 = ev({ type: 'run.step.started', run, subject: 'plan', ...( { step: 'plan' } as object) });
    const tool = ev({ type: 'tool.requested', run, subject: 'search' });
    const s2 = ev({ type: 'run.step.finished', run, subject: 'plan', ...( { step: 'plan' } as object) });
    const after = ev({ type: 'progress.status', run });
    for (const e of [started, s1, tool, s2, after]) apply(store, e);
    const key = [...store.sessions.keys()][0] as string;
    const steps = store.stepsOf(key);
    expect(steps.get(s1.id)).toBe('plan');
    expect(steps.get(tool.id)).toBe('plan');
    expect(steps.get(s2.id)).toBe('plan');
    expect(steps.get(started.id)).toBeUndefined();
    expect(steps.get(after.id)).toBeUndefined();
  });

  it('is replay-safe: a late-arriving buffered event lands inside its step by order, not arrival', () => {
    const { store } = freshStore();
    const run = 'run_1';
    const s1 = ev({ type: 'run.step.started', run, subject: 'build' });
    const inside = ev({ type: 'tool.requested', run, subject: 'bash' }); // seq inside the step
    const s2 = ev({ type: 'run.step.finished', run, subject: 'build' });
    // arrival order: started, finished, THEN the buffered middle event
    apply(store, s1);
    apply(store, s2);
    apply(store, inside);
    const key = [...store.sessions.keys()][0] as string;
    expect(store.stepsOf(key).get(inside.id)).toBe('build');
  });
});

describe('stateOf', () => {
  it('reconstructs snapshot + ordered deltas', () => {
    const { store } = freshStore();
    apply(store, ev({ type: 'state.snapshot', data: { state: { done: 1, plan: ['a'] } } }));
    apply(store, ev({ type: 'state.delta', data: { ops: 2, delta: [
      { op: 'replace', path: '/done', value: 2 },
      { op: 'add', path: '/plan/-', value: 'b' },
    ] } }));
    const key = [...store.sessions.keys()][0] as string;
    const st = store.stateOf(key);
    expect(st.value).toEqual({ done: 2, plan: ['a', 'b'] });
    expect(st.appliedOps).toBe(2);
    expect(st.gatedOps).toBe(0);
  });

  it('counts gated patches honestly and never fabricates', () => {
    const { store } = freshStore();
    apply(store, ev({ type: 'state.snapshot', data: { state: { done: 1 } } }));
    apply(store, ev({ type: 'state.delta', data: { ops: 3 } })); // body gated at metadata
    const key = [...store.sessions.keys()][0] as string;
    const st = store.stateOf(key);
    expect(st.value).toEqual({ done: 1 }); // untouched — nothing invented
    expect(st.gatedOps).toBe(3);
  });

  it('a gated snapshot registers without a value; a later snapshot resets the gated count', () => {
    const { store } = freshStore();
    apply(store, ev({ type: 'state.snapshot', data: {} })); // state gated away
    apply(store, ev({ type: 'state.delta', data: { ops: 2 } }));
    const key = [...store.sessions.keys()][0] as string;
    let st = store.stateOf(key);
    expect(st.hasSnapshot).toBe(true);
    expect(st.value).toBeUndefined();
    expect(st.gatedOps).toBe(2);
    apply(store, ev({ type: 'state.snapshot', data: { state: { fresh: true } } }));
    st = store.stateOf(key);
    expect(st.value).toEqual({ fresh: true });
    expect(st.gatedOps).toBe(0); // superseded by the snapshot
  });

  it('ops that cannot apply are skipped and counted', () => {
    const { store } = freshStore();
    apply(store, ev({ type: 'state.snapshot', data: { state: { a: 1 } } }));
    apply(store, ev({ type: 'state.delta', data: { delta: [
      { op: 'remove', path: '/missing' },
      { op: 'replace', path: '/a', value: 2 },
    ] } }));
    const key = [...store.sessions.keys()][0] as string;
    const st = store.stateOf(key);
    expect(st.value).toEqual({ a: 2 });
    expect(st.appliedOps).toBe(1);
    expect(st.skippedOps).toBe(1);
  });
});
