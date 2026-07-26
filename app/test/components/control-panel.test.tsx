// Control panel, two provenance-labeled halves: the DECLARED block (roster
// snapshot — AEP-0003 §4.1: claims verbatim, visible ambiguity, the honest
// no-live-claim state, absent entirely until a roster was recorded) and the
// OBSERVED settles (untried core verbs, settle chips accepted / refused ·
// reason, the agent's steer verb, the observed kind families).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AepEvent } from '@aep/sdk';
import { Store } from '../../src/core/store';
import { ControlPanel } from '../../src/views/session/control-panel';

let n = 0;
const mk = (type: string, extra: Record<string, unknown> = {}): AepEvent =>
  ({
    aep: '0.1',
    id: `cp_${String(++n).padStart(3, '0')}`,
    type,
    time: new Date(1700000000000 + n * 1000).toISOString(),
    source: 'aep://test/agent/sim',
    agent: 'hermes',
    session: 's_cp',
    epoch: 1,
    capture: 'metadata',
    ...extra,
  }) as AepEvent;

function laneWith(settles: Array<[string, Parameters<Store['recordControlSettle']>[2]]> = []) {
  const store = new Store();
  store.apply(mk('session.started', { seq: 0 }));
  store.apply(mk('tool.completed', { seq: 1, run: 'r1' }));
  for (const [type, settle] of settles) store.recordControlSettle('s_cp', type, settle);
  return store.sessions.get('s_cp')!;
}

describe('ControlPanel', () => {
  it('states the declared-vs-observed posture and lists the core verbs untried', () => {
    render(<ControlPanel lane={laneWith()} />);
    expect(screen.getByText(/never gates sending|Neither gates sending/i)).toBeTruthy();
    for (const verb of [
      'control.attention.respond',
      'control.cancel',
      'control.pause',
      'control.resume',
    ]) {
      expect(screen.getByText(verb)).toBeTruthy();
    }
    expect(screen.getAllByText('untried').length).toBeGreaterThanOrEqual(4);
  });

  it('shows NO declared block until a roster was recorded (undefined = never asked)', () => {
    render(<ControlPanel lane={laneWith()} />);
    expect(screen.queryByTestId('declared-block')).toBeNull();
  });

  it('renders a single claim: identity + declared accepts verbatim, snapshot-labeled', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0, session: 's_d1' }));
    store.recordRoster(
      [{ session: 's_d1', agent: 'hermes', instance: 'host-1',
        control: { accepts: ['control.attention.respond', 'x.hermes.control.instruct'] } }],
      {},
    );
    const declaredLane = [...store.sessions.values()].find((l) => l.session === 's_d1')!;
    render(<ControlPanel lane={declaredLane} />);
    expect(screen.getByTestId('declared-block')).toBeTruthy();
    expect(screen.getByText(/roster snapshot/i)).toBeTruthy();
    expect(screen.getByText('hermes@host-1')).toBeTruthy();
    expect(screen.getAllByText('x.hermes.control.instruct').length).toBeGreaterThanOrEqual(1);
  });

  it('says so honestly when the roster stopped listing the session (no live route)', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0, session: 's_d2' }));
    store.recordRoster([], {});
    const lane = [...store.sessions.values()].find((l) => l.session === 's_d2')!;
    render(<ControlPanel lane={lane} />);
    expect(screen.getByText(/No live claim on the relay right now/)).toBeTruthy();
  });

  it('renders TWO claimants as visible ambiguity, never merged', () => {
    const store = new Store();
    store.apply(mk('session.started', { seq: 0, session: 's_d3' }));
    store.recordRoster(
      [
        { session: 's_d3', agent: 'agent-a', control: { accepts: ['control.cancel'] } },
        { session: 's_d3', agent: 'agent-b', control: { accepts: [] } },
      ],
      {},
    );
    const lane = [...store.sessions.values()].find((l) => l.session === 's_d3')!;
    render(<ControlPanel lane={lane} />);
    expect(screen.getByText(/2 live connections claim this session name/)).toBeTruthy();
    expect(screen.getByText('agent-a')).toBeTruthy();
    expect(screen.getByText('agent-b')).toBeTruthy();
    expect(screen.getByText('accepts nothing')).toBeTruthy();
  });

  it("includes the lane agent's steer verb from the profile", () => {
    render(<ControlPanel lane={laneWith()} />);
    expect(screen.getByText('x.hermes.control.instruct')).toBeTruthy();
  });

  it('renders settles: accepted, and refused with the nack reason + detail', () => {
    const lane = laneWith([
      [
        'control.attention.respond',
        { state: 'refused', reason: 'unsupported', detail: 'target does not accept it' },
      ],
      ['control.cancel', { state: 'accepted' }],
    ]);
    render(<ControlPanel lane={lane} />);
    expect(screen.getByText('refused · unsupported')).toBeTruthy();
    expect(screen.getByText(/target does not accept it/)).toBeTruthy();
    expect(screen.getByText('accepted')).toBeTruthy();
  });

  it('lists verbs seen only in settles (beyond the core + steer set)', () => {
    const lane = laneWith([['x.openhands.control.interrupt', { state: 'accepted' }]]);
    render(<ControlPanel lane={lane} />);
    expect(screen.getByText('x.openhands.control.interrupt')).toBeTruthy();
  });

  it('shows the observed kind families', () => {
    render(<ControlPanel lane={laneWith()} />);
    expect(screen.getByText('session')).toBeTruthy();
    expect(screen.getByText('tool')).toBeTruthy();
  });
});
