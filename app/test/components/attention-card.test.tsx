// Inbox card behavior: option buttons, form rendering + submitted values,
// responding/error states.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AepEvent } from '@aep/sdk';
import type { AttentionItem } from '../../src/core/store';
import { Store } from '../../src/core/store';
import type { Controller } from '../../src/state/controller';
import { ControllerContext } from '../../src/state/use-store';
import { AttentionCard } from '../../src/views/inbox/attention-card';

const NOW = Date.parse('2024-01-01T00:00:30Z');

function item(data: Record<string, unknown>, state: AttentionItem['state'] = 'pending', error?: string): AttentionItem {
  const request = {
    aep: '0.1',
    id: 'req_1',
    type: 'attention.requested',
    time: '2024-01-01T00:00:00Z',
    source: 'aep://test/agent/sim',
    agent: 'sim-agent',
    session: 's_component_test',
    seq: 4,
    epoch: 1,
    severity: 'notice',
    data,
  } as AepEvent;
  const out: AttentionItem = { request, session: 's_component_test', laneKey: 's_component_test', state };
  if (error) out.error = error;
  return out;
}

describe('AttentionCard', () => {
  it('renders prompt + option buttons and sends the tapped option', () => {
    const respond = vi.fn();
    render(
      <AttentionCard
        item={item({
          kind: 'permission',
          prompt: 'Run the build?',
          options: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }],
        })}
        now={NOW}
        respond={respond}
      />,
    );
    expect(screen.getByText('Run the build?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(respond).toHaveBeenCalledWith(expect.anything(), { option: 'allow' });
  });

  it('renders form FIELDS read-only on a request that declares an oob channel (the choices stay visible)', () => {
    const respond = vi.fn();
    render(
      <AttentionCard
        item={item({
          kind: 'form',
          prompt: 'hermes asks a question',
          fields: [{
            id: '1', type: 'select', label: 'Which deployment target?', required: true, other: true,
            choices: [{ id: '1', label: 'staging' }, { id: '2', label: 'production' }],
          }],
          respond_via: ['oob'],
        })}
        now={NOW}
        respond={respond}
      />,
    );
    expect(screen.getByText('Which deployment target?')).toBeTruthy();
    expect(screen.getByText('staging')).toBeTruthy();
    expect(screen.getByText('production')).toBeTruthy();
    expect(screen.getByText(/answered in the agent's own UI/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    expect(screen.queryByLabelText('free-text response')).toBeNull();
  });

  it('renders an oob string field as a labeled free-form hint, never an input', () => {
    render(
      <AttentionCard
        item={item({
          kind: 'form',
          prompt: 'hermes asks a question',
          fields: [{ id: '1', type: 'string', label: 'Anything else?', required: true }],
          respond_via: ['oob'],
        })}
        now={NOW}
        respond={vi.fn()}
      />,
    );
    expect(screen.getByText('Anything else?')).toBeTruthy();
    expect(screen.getByText(/free-form answer/i)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('carries typed free text along with the tapped option', () => {
    const respond = vi.fn();
    render(
      <AttentionCard
        item={item({
          kind: 'permission',
          prompt: 'Run the build?',
          options: [{ id: 'approved', label: 'Approve' }, { id: 'rejected', label: 'Reject' }],
        })}
        now={NOW}
        respond={respond}
      />,
    );
    fireEvent.change(screen.getByLabelText('free-text response'), {
      target: { value: '  too risky on prod  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(respond).toHaveBeenCalledWith(expect.anything(), {
      option: 'rejected',
      text: 'too risky on prod',
    });
  });

  it('sends trimmed free text and skips empty submissions', () => {
    const respond = vi.fn();
    render(<AttentionCard item={item({ kind: 'question', prompt: 'Which env?' })} now={NOW} respond={respond} />);
    const input = screen.getByLabelText('free-text response');
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(respond).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '  staging  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(respond).toHaveBeenCalledWith(expect.anything(), { text: 'staging' });
  });

  it('renders a kind:form request and submits answer.values keyed by field id', () => {
    const respond = vi.fn();
    render(
      <AttentionCard
        item={item({
          kind: 'form',
          prompt: 'Release parameters',
          fields: [
            { id: 'version', type: 'string', label: 'Version', required: true },
            { id: 'dry_run', type: 'boolean', label: 'Dry run' },
          ],
        })}
        now={NOW}
        respond={respond}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Version/), { target: { value: '1.2.3' } });
    fireEvent.click(screen.getByLabelText(/Dry run/));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(respond).toHaveBeenCalledWith(expect.anything(), {
      values: { version: '1.2.3', dry_run: true },
    });
  });

  it('carries field_spec min/max onto the number input (the only range guard in the loop)', () => {
    render(
      <AttentionCard
        item={item({
          kind: 'form',
          prompt: 'How many?',
          fields: [{ id: 'count', type: 'number', label: 'Count', min: 1, max: 8 }],
        })}
        now={NOW}
        respond={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(/Count/) as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.min).toBe('1');
    expect(input.max).toBe('8');
  });

  it('disables actions while responding and surfaces respond errors', () => {
    const respond = vi.fn();
    const { rerender } = render(
      <AttentionCard
        item={item({ kind: 'permission', options: [{ id: 'allow', label: 'Allow' }] }, 'responding')}
        now={NOW}
        respond={respond}
      />,
    );
    const allow = screen.getByRole('button', { name: 'Allow' }) as HTMLButtonElement;
    expect(allow.disabled).toBe(true);
    expect(screen.getByText(/waiting for the stream/)).toBeTruthy();

    rerender(
      <AttentionCard
        item={item({ kind: 'permission', options: [{ id: 'allow', label: 'Allow' }] }, 'pending', 'invalid: missing required field')}
        now={NOW}
        respond={respond}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('missing required field');
    expect((screen.getByRole('button', { name: 'Allow' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('AttentionCard observed-refusal advisory', () => {
  it('warns before typing when the lane already refused respond as unsupported — reply box stays', () => {
    const store = new Store();
    store.recordControlSettle('s_component_test', 'control.attention.respond', {
      state: 'refused',
      reason: 'unsupported',
      detail: 'target does not accept control.attention.respond',
    });
    const controller = { config: { relays: [] }, store } as unknown as Controller;
    render(
      <ControllerContext.Provider value={controller}>
        <AttentionCard item={item({ kind: 'permission', prompt: 'Approve?' })} now={NOW} respond={vi.fn()} />
      </ControllerContext.Provider>,
    );
    expect(screen.getByText(/refused control\.attention\.respond/i).textContent).toContain('unsupported');
    // the send path is never removed — a stale observation must not lock the operator out
    expect(screen.getByLabelText('free-text response')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeTruthy();
  });

  it('shows no advisory when the refusal was invalid (the verb IS accepted)', () => {
    const store = new Store();
    store.recordControlSettle('s_component_test', 'control.attention.respond', {
      state: 'refused',
      reason: 'invalid',
      detail: 'expects one of the offered options',
    });
    const controller = { config: { relays: [] }, store } as unknown as Controller;
    render(
      <ControllerContext.Provider value={controller}>
        <AttentionCard item={item({ kind: 'permission', prompt: 'Approve?' })} now={NOW} respond={vi.fn()} />
      </ControllerContext.Provider>,
    );
    expect(screen.queryByText(/refused control\.attention\.respond/i)).toBeNull();
  });
});

describe('AttentionCard respond_via (AEP-0008)', () => {
  it('renders an oob-only request as information: menu visible, no send affordances', () => {
    const respond = vi.fn();
    render(
      <AttentionCard
        item={item({
          kind: 'permission',
          prompt: 'Approval requested: sudo make install',
          options: [
            { id: 'once', label: 'Allow once' },
            { id: 'session', label: 'Allow for this session' },
            { id: 'always', label: 'Add to permanent allowlist' },
            { id: 'deny', label: 'Deny' },
          ],
          respond_via: ['oob'],
        })}
        now={NOW}
        respond={respond}
      />,
    );
    // the vendor menu is information, not an affordance: no option buttons,
    // no reply box, no submit — the header's session-open chrome may stay
    expect(screen.getByText('Allow once')).toBeTruthy();
    expect(screen.getByText('Add to permanent allowlist')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    expect(screen.queryByLabelText('free-text response')).toBeNull();
    expect(screen.getByText(/answered in the agent's own UI/i)).toBeTruthy();
  });

  it('keeps the full affordance when respond_via includes control', () => {
    const respond = vi.fn();
    render(
      <AttentionCard
        item={item({
          kind: 'permission',
          prompt: 'Allow tool terminal?',
          options: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }],
          respond_via: ['control'],
        })}
        now={NOW}
        respond={respond}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(respond).toHaveBeenCalledWith(expect.anything(), { option: 'deny' });
    expect(screen.getByLabelText('free-text response')).toBeTruthy();
  });

  it('treats a malformed respond_via as absent (send-and-settle stays)', () => {
    const respond = vi.fn();
    render(
      <AttentionCard
        item={item({ kind: 'permission', prompt: 'Approve?', respond_via: 'oob' })}
        now={NOW}
        respond={respond}
      />,
    );
    expect(screen.getByLabelText('free-text response')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeTruthy();
  });
});
