// Fleet quick-answer strip: the same AEP-0008 respond_via rule as the full
// card — a request that declares its channel without "control" renders as
// information (no buttons, no reply box), everything else keeps the
// one-tap answer affordances.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AepEvent } from '@aep/sdk';
import { Store } from '../../src/core/store';
import type { Controller } from '../../src/state/controller';
import { ControllerContext } from '../../src/state/use-store';
import { QuickAnswer } from '../../src/views/fleet/quick-answer';

function laneWith(data: Record<string, unknown>) {
  const store = new Store();
  store.apply({
    aep: '0.1',
    id: 'ev_s',
    type: 'session.started',
    time: '2024-01-01T00:00:00Z',
    source: 'aep://test/agent/sim',
    agent: 'sim-agent',
    session: 's_qa_test',
    seq: 0,
    epoch: 1,
    data: {},
  } as AepEvent);
  store.apply({
    aep: '0.1',
    id: 'req_qa_1',
    type: 'attention.requested',
    time: '2024-01-01T00:00:01Z',
    source: 'aep://test/agent/sim',
    agent: 'sim-agent',
    session: 's_qa_test',
    seq: 1,
    epoch: 1,
    severity: 'notice',
    data,
  } as AepEvent);
  return { store, lane: store.sessions.get('s_qa_test')! };
}

function renderStrip(data: Record<string, unknown>) {
  const respond = vi.fn();
  const { store, lane } = laneWith(data);
  const controller = { config: { relays: [] }, store, respond } as unknown as Controller;
  render(
    <ControllerContext.Provider value={controller}>
      <QuickAnswer lane={lane} />
    </ControllerContext.Provider>,
  );
  return respond;
}

describe('QuickAnswer respond_via (AEP-0008)', () => {
  it('renders an oob-only request as information: no buttons, no reply box', () => {
    renderStrip({
      kind: 'permission',
      prompt: 'Approval requested: sudo make install',
      options: [
        { id: 'once', label: 'Allow once' },
        { id: 'deny', label: 'Deny' },
      ],
      respond_via: ['oob'],
    });
    expect(screen.getByText(/Approval requested/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
    expect(screen.queryByLabelText('quick reply')).toBeNull();
    expect(screen.getByText(/answered in the agent's own UI/i)).toBeTruthy();
  });

  it('keeps one-tap options when respond_via includes control', () => {
    const respond = renderStrip({
      kind: 'permission',
      prompt: 'Allow tool terminal?',
      options: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }],
      respond_via: ['control'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(respond).toHaveBeenCalledWith(expect.anything(), { option: 'allow' });
  });

  it('keeps the reply box when respond_via is absent (send-and-settle)', () => {
    renderStrip({ kind: 'question', prompt: 'Which env?' });
    expect(screen.getByLabelText('quick reply')).toBeTruthy();
  });
});
