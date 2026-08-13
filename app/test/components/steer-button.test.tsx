// The observed-refusal advisory generalized beyond the attention card:
// once THIS session settled a control verb
// refused·unsupported, the affordance says so up front — advisory only,
// keyed on the generic lane.control settles (observed capability is
// stale-able, so the send path is never gated; `invalid` never advises —
// that reason means the verb IS accepted).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AepEvent } from '@agenteventprotocol/sdk';
import { laneKey, type LaneSource } from '../../src/core/store';
import { Controller } from '../../src/state/controller';
import { ControllerContext } from '../../src/state/use-store';
import { SteerButton } from '../../src/components/layout/steer';
import { PauseResumeControls } from '../../src/components/layout/pause-resume';

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

const SOURCE: LaneSource = { kind: 'relay', relay: 'http://r:1' };

function seed(controller: Controller) {
  controller.store.apply(mk('session.started', { seq: 0 }), { source: SOURCE });
  return controller.store.sessions.get(laneKey(SOURCE, 's_ui'))!;
}

const ui = (controller: Controller, el: React.ReactNode) =>
  render(<ControllerContext.Provider value={controller}>{el}</ControllerContext.Provider>);

describe('control-affordance refusal advisories', () => {
  it('SteerButton advises when the steering verb settled refused·unsupported this session', () => {
    const controller = new Controller();
    const lane = seed(controller);
    vi.spyOn(controller, 'canInstruct').mockReturnValue(true);
    controller.store.recordControlSettle(
      's_ui', 'x.sim-agent.control.instruct',
      { state: 'refused', reason: 'unsupported' }, { source: SOURCE },
    );
    ui(controller, <SteerButton lane={lane} />);
    const button = screen.getByRole('button', { name: /steer/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.title).toMatch(/refused x\.sim-agent\.control\.instruct earlier this session/i);
  });

  it('PauseResumeControls advise per verb off their own settles', () => {
    const controller = new Controller();
    const lane = seed(controller);
    vi.spyOn(controller, 'canPauseResume').mockReturnValue(true);
    controller.store.recordControlSettle(
      's_ui', 'control.pause', { state: 'refused', reason: 'unsupported' }, { source: SOURCE },
    );
    ui(controller, <PauseResumeControls lane={lane} />);
    const pause = screen.getByRole('button', { name: 'Pause session s_ui' }) as HTMLButtonElement;
    const resume = screen.getByRole('button', { name: 'Resume session s_ui' }) as HTMLButtonElement;
    expect(pause.disabled).toBe(false);
    expect(pause.title).toMatch(/refused control\.pause earlier this session/i);
    expect(resume.title).not.toMatch(/refused/i);
  });
});
