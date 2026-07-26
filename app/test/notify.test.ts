// Desktop-notification decision matrix: pure function, no Notification
// object anywhere near it. One notification per request id, only when the
// operator opted in, the browser granted permission, the tab is hidden,
// and the item is actually actionable.
import { describe, expect, it } from 'vitest';
import type { AepEvent } from '@aep/sdk';
import type { AttentionItem } from '../src/core/store';
import { shouldNotify, notificationContent } from '../src/lib/notify';

const item = (
  state: AttentionItem['state'] = 'pending',
  data: Record<string, unknown> = { kind: 'permission', prompt: 'Run tests?\nSecond line.' },
): AttentionItem => ({
  request: {
    aep: '0.1',
    id: 'req_9',
    type: 'attention.requested',
    time: '2024-01-01T00:00:00Z',
    source: 'aep://test/agent/sim',
    agent: 'sim-agent',
    session: 's_notify',
    seq: 3,
    epoch: 1,
    severity: 'notice',
    data,
  } as AepEvent,
  session: 's_notify',
  laneKey: 's_notify',
  state,
});

const ctx = { enabled: true, permission: 'granted' as const, hidden: true };
const none = new Set<string>();

describe('shouldNotify', () => {
  it('fires for a pending item when opted in, granted, and hidden', () => {
    expect(shouldNotify(item(), ctx, none)).toBe(true);
  });
  it('never fires when the toggle is off', () => {
    expect(shouldNotify(item(), { ...ctx, enabled: false }, none)).toBe(false);
  });
  it('never fires without granted permission', () => {
    expect(shouldNotify(item(), { ...ctx, permission: 'default' }, none)).toBe(false);
    expect(shouldNotify(item(), { ...ctx, permission: 'denied' }, none)).toBe(false);
  });
  it('never fires while the tab is visible', () => {
    expect(shouldNotify(item(), { ...ctx, hidden: false }, none)).toBe(false);
  });
  it('never fires for settled or in-flight items', () => {
    for (const state of ['responding', 'answered', 'resolved', 'timeout'] as const) {
      expect(shouldNotify(item(state), ctx, none)).toBe(false);
    }
  });
  it('suppresses duplicates per request id', () => {
    expect(shouldNotify(item(), ctx, new Set(['req_9']))).toBe(false);
  });
});

describe('notificationContent', () => {
  it('titles with the agent and bodies with the first prompt line', () => {
    const { title, body } = notificationContent(item());
    expect(title).toContain('sim-agent');
    expect(body).toBe('Run tests?');
  });
  it('falls back to the request kind when there is no prompt', () => {
    const { body } = notificationContent(item('pending', { kind: 'question' }));
    expect(body).toBe('question');
  });
});
