// Pause/resume affordance behavior: direct send (no confirm dialog — both
// verbs are reversible and the target refuses anything dishonest), refusal
// surfaced inline as the sovereign answer, disabled-with-reason without a
// live backchannel, and the accepted note pointing at the cause-linked
// outcome (no paused badge is invented — the consumer cannot durably know
// the state at the metadata ceiling).
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AepEvent } from '@agenteventprotocol/sdk';
import { laneKey, IMPORT_SOURCE, type LaneSource } from '../../src/core/store';
import { Controller } from '../../src/state/controller';
import { ControllerContext } from '../../src/state/use-store';
import { PauseResumeControls } from '../../src/components/layout/pause-resume';

let n = 0;
const mk = (type: string, extra: Record<string, unknown> = {}): AepEvent =>
  ({
    aep: '0.1',
    id: `ev_${String(++n).padStart(4, '0')}`,
    type,
    time: new Date(1700000000000 + n * 1000).toISOString(),
    source: 'aep://test/agent/openhands',
    agent: 'openhands',
    session: 's_pr_ui',
    epoch: 1,
    capture: 'metadata',
    ...extra,
  }) as AepEvent;

function seed(controller: Controller, source: LaneSource) {
  controller.store.apply(mk('session.started', { seq: 0 }), { source });
  return controller.store.sessions.get(laneKey(source, 's_pr_ui'))!;
}

const ui = (controller: Controller, el: React.ReactNode) =>
  render(<ControllerContext.Provider value={controller}>{el}</ControllerContext.Provider>);

describe('PauseResumeControls', () => {
  it('sends pause directly (reversible — no confirm dialog) and reports the ack', async () => {
    const controller = new Controller();
    const lane = seed(controller, { kind: 'relay', relay: 'http://r:1' });
    vi.spyOn(controller, 'canPauseResume').mockReturnValue(true);
    const pause = vi.spyOn(controller, 'pauseSession').mockResolvedValue();

    ui(controller, <PauseResumeControls lane={lane} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause session s_pr_ui' }));
    expect(pause).toHaveBeenCalledWith(lane.key);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/pause accepted/));
    expect(screen.getByRole('status').textContent).toMatch(/cause-linked/);
  });

  it('surfaces a resume refusal inline as the sovereign answer', async () => {
    const controller = new Controller();
    const lane = seed(controller, { kind: 'relay', relay: 'http://r:1' });
    vi.spyOn(controller, 'canPauseResume').mockReturnValue(true);
    vi.spyOn(controller, 'resumeSession').mockRejectedValue(
      new Error('refused: nothing to resume — the vendor run call would start work'),
    );

    ui(controller, <PauseResumeControls lane={lane} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume session s_pr_ui' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/resume refused: .*start work/),
    );
  });

  it('disables both buttons with the honest reason on an imported capture', () => {
    const controller = new Controller();
    const lane = seed(controller, IMPORT_SOURCE);

    ui(controller, <PauseResumeControls lane={lane} />);
    const pauseBtn = screen.getByRole('button', {
      name: 'Pause session s_pr_ui',
    }) as HTMLButtonElement;
    const resumeBtn = screen.getByRole('button', {
      name: 'Resume session s_pr_ui',
    }) as HTMLButtonElement;
    expect(pauseBtn.disabled).toBe(true);
    expect(resumeBtn.disabled).toBe(true);
    expect(pauseBtn.title).toMatch(/no live backchannel/);
  });
});
