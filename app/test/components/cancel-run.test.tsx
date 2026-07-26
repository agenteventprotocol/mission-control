// Cancel affordance behavior: confirm-before-send, reason plumbed through,
// disabled-with-reason without a live backchannel, in-flight rendering.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AepEvent } from '@aep/sdk';
import { laneKey, IMPORT_SOURCE, type LaneSource } from '../../src/core/store';
import { Controller } from '../../src/state/controller';
import { ControllerContext } from '../../src/state/use-store';
import { CancelRunButton } from '../../src/components/layout/cancel-run';

let n = 0;
const mk = (type: string, extra: Record<string, unknown> = {}): AepEvent =>
  ({
    aep: '0.1',
    id: `ev_${String(++n).padStart(4, '0')}`,
    type,
    time: new Date(1700000000000 + n * 1000).toISOString(),
    source: 'aep://test/agent/sim',
    agent: 'sim-agent',
    session: 's_ui',
    epoch: 1,
    capture: 'metadata',
    ...extra,
  }) as AepEvent;

function seed(controller: Controller, source: LaneSource) {
  controller.store.apply(mk('session.started', { seq: 0 }), { source });
  controller.store.apply(mk('run.started', { seq: 1, run: 'r1' }), { source });
  const lane = controller.store.sessions.get(laneKey(source, 's_ui'))!;
  return { lane, run: lane.runs.get('r1')! };
}

const ui = (controller: Controller, el: React.ReactNode) =>
  render(<ControllerContext.Provider value={controller}>{el}</ControllerContext.Provider>);

describe('CancelRunButton', () => {
  it('confirms before sending and plumbs the trimmed reason through', () => {
    const controller = new Controller();
    const { lane, run } = seed(controller, { kind: 'relay', relay: 'http://r:1' });
    vi.spyOn(controller, 'canCancelRun').mockReturnValue(true);
    const cancel = vi.spyOn(controller, 'cancelRun').mockImplementation(() => {});

    ui(controller, <CancelRunButton lane={lane} run={run} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run r1' }));
    expect(cancel).not.toHaveBeenCalled(); // dialog first — destructive action

    fireEvent.change(screen.getByLabelText('Cancel reason'), {
      target: { value: '  wrong branch  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Cancel run$/ }));
    expect(cancel).toHaveBeenCalledWith(lane.key, 'r1', 'wrong branch');
  });

  it('is disabled with the honest reason on an imported lane', () => {
    const controller = new Controller();
    const { lane, run } = seed(controller, IMPORT_SOURCE);
    ui(controller, <CancelRunButton lane={lane} run={run} />);
    const button = screen.getByRole('button', { name: 'Cancel run r1' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/no live backchannel/i);
  });

  it('renders the in-flight marker instead of the button while cancelling', () => {
    const controller = new Controller();
    const { lane, run } = seed(controller, { kind: 'relay', relay: 'http://r:1' });
    controller.store.markRunCancelling(lane.key, run.id);
    ui(controller, <CancelRunButton lane={lane} run={run} />);
    expect(screen.queryByRole('button', { name: 'Cancel run r1' })).toBeNull();
    expect(screen.getByText('cancelling…')).toBeTruthy();
  });

  it('renders nothing for a settled run', () => {
    const controller = new Controller();
    const { lane, run } = seed(controller, { kind: 'relay', relay: 'http://r:1' });
    controller.store.apply(mk('run.finished', { seq: 2, run: 'r1' }), {
      source: { kind: 'relay', relay: 'http://r:1' },
    });
    const { container } = ui(controller, <CancelRunButton lane={lane} run={run} />);
    expect(container.innerHTML).toBe('');
  });

  it('offers no cancel on an ended session — the honest no-terminal marker renders instead', () => {
    // AEP-0002 §4.1: a run may never reach a terminal (interrupts fire no
    // hook on some sources); consumers degrade gracefully. Once the session
    // is over there is nothing left to cancel — an active button here lies.
    const controller = new Controller();
    const source = { kind: 'relay', relay: 'http://r:1' } as const;
    const { lane, run } = seed(controller, source);
    vi.spyOn(controller, 'canCancelRun').mockReturnValue(true);
    controller.store.apply(mk('session.ended', { seq: 2 }), { source });
    ui(controller, <CancelRunButton lane={lane} run={run} />);
    expect(screen.queryByRole('button', { name: 'Cancel run r1' })).toBeNull();
    expect(screen.getByText(/no terminal/i)).toBeTruthy();
  });

  it('renders the failed outcome inline even in compact mode — a tooltip is not a troubleshooting surface', () => {
    const controller = new Controller();
    const { lane, run } = seed(controller, { kind: 'relay', relay: 'http://r:1' });
    vi.spyOn(controller, 'canCancelRun').mockReturnValue(true);
    controller.store.markRunCancelling(lane.key, run.id);
    controller.store.markRunCancelFailed(lane.key, run.id, 'unsupported');
    ui(controller, <CancelRunButton lane={lane} run={run} compact />);
    expect(screen.getByText(/cancel failed: unsupported/i)).toBeTruthy();
  });

  it('advises when this target already refused control.cancel this session — advisory only, the send stays available', () => {
    const controller = new Controller();
    const source = { kind: 'relay', relay: 'http://r:1' } as const;
    const { lane, run } = seed(controller, source);
    vi.spyOn(controller, 'canCancelRun').mockReturnValue(true);
    controller.store.recordControlSettle('s_ui', 'control.cancel', { state: 'refused', reason: 'unsupported' }, { source });
    ui(controller, <CancelRunButton lane={lane} run={run} />);
    const button = screen.getByRole('button', { name: 'Cancel run r1' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.title).toMatch(/refused control\.cancel earlier this session/i);
    expect(screen.getByText(/refused control\.cancel earlier this session/i)).toBeTruthy();
  });

  it('never advises off an "invalid" settle — that reason means the verb IS accepted', () => {
    const controller = new Controller();
    const source = { kind: 'relay', relay: 'http://r:1' } as const;
    const { lane, run } = seed(controller, source);
    vi.spyOn(controller, 'canCancelRun').mockReturnValue(true);
    controller.store.recordControlSettle('s_ui', 'control.cancel', { state: 'refused', reason: 'invalid' }, { source });
    ui(controller, <CancelRunButton lane={lane} run={run} />);
    expect(screen.queryByText(/refused control\.cancel earlier this session/i)).toBeNull();
  });
});
