// The DOM-wired half of the notification story (the pure decision matrix is
// covered in test/notify.test.ts): AttentionPresence assembles the context
// from the real document/Notification globals, sets the tab-title badge,
// fires at most ONE desktop notification per request id across re-renders,
// and wires the notification click to focus + dock-open.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { AepEvent } from '@aep/sdk';
import { Controller } from '../../src/state/controller';
import { AttentionPresence } from '../../src/App';

const created: Array<{
  title: string;
  opts: { body?: string; tag?: string };
  instance: { onclick: null | (() => void) };
}> = [];

class NotificationMock {
  static permission = 'granted';
  onclick: null | (() => void) = null;
  constructor(title: string, opts: { body?: string; tag?: string } = {}) {
    created.push({ title, opts, instance: this });
  }
}

let n = 0;
const mk = (type: string, extra: Record<string, unknown> = {}): AepEvent =>
  ({
    aep: '0.1',
    id: `ev_${String(++n).padStart(4, '0')}`,
    type,
    time: new Date(1700000000000 + n * 1000).toISOString(),
    source: 'aep://test/agent/sim',
    agent: 'sim',
    session: 's_presence',
    epoch: 1,
    seq: n,
    ...extra,
  }) as AepEvent;

const request = (id: string, prompt: string): AepEvent =>
  mk('attention.requested', { id, severity: 'notice', data: { kind: 'permission', prompt } });

const setHidden = (hidden: boolean) =>
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });

beforeEach(() => {
  created.length = 0;
  n = 0;
  document.title = 'AEP Mission Control';
  NotificationMock.permission = 'granted';
  (globalThis as Record<string, unknown>).Notification = NotificationMock;
  setHidden(true);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).Notification;
  setHidden(false);
});

describe('AttentionPresence wiring', () => {
  it('badges the title and fires one notification per pending request while hidden', () => {
    const controller = new Controller();
    controller.store.apply(mk('session.started'));
    controller.store.apply(request('req_1', 'Deploy to staging?'));
    const onNewRequest = vi.fn();

    render(
      <AttentionPresence controller={controller} notifyEnabled={true} onNewRequest={onNewRequest} />,
    );
    expect(document.title).toBe('(1) AEP Mission Control');
    expect(created).toHaveLength(1);
    expect(created[0]!.title).toBe('sim needs you');
    expect(created[0]!.opts).toEqual({ body: 'Deploy to staging?', tag: 'req_1' });
    expect(onNewRequest).toHaveBeenCalledTimes(1);

    // clicking the notification focuses the window and opens the dock
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    act(() => created[0]!.instance.onclick?.());
    expect(focus).toHaveBeenCalledTimes(1);
    expect(onNewRequest).toHaveBeenCalledTimes(2);
  });

  it('never re-notifies a known request; a NEW pending arriving live notifies once', async () => {
    const controller = new Controller();
    controller.store.apply(mk('session.started'));
    controller.store.apply(request('req_1', 'First?'));
    const onNewRequest = vi.fn();

    const { rerender } = render(
      <AttentionPresence controller={controller} notifyEnabled={true} onNewRequest={onNewRequest} />,
    );
    rerender(
      <AttentionPresence controller={controller} notifyEnabled={true} onNewRequest={onNewRequest} />,
    );
    expect(created).toHaveLength(1); // notified-ref dedupe across re-renders
    expect(onNewRequest).toHaveBeenCalledTimes(1); // known-ref dedupe

    // a second request lands on the live store: the subscription re-renders
    // (rAF-batched) and exactly one more notification fires
    await act(async () => {
      controller.store.apply(request('req_2', 'Second?'));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(created).toHaveLength(2);
    expect(created[1]!.opts.tag).toBe('req_2');
    expect(document.title).toBe('(2) AEP Mission Control');
    expect(onNewRequest).toHaveBeenCalledTimes(2);
  });

  it('a visible tab badges the title but never notifies', () => {
    setHidden(false);
    const controller = new Controller();
    controller.store.apply(mk('session.started'));
    controller.store.apply(request('req_1', 'Quiet?'));

    render(<AttentionPresence controller={controller} notifyEnabled={true} onNewRequest={() => {}} />);
    expect(document.title).toBe('(1) AEP Mission Control');
    expect(created).toHaveLength(0);
  });

  it('the opt-out default stays silent and an empty inbox clears the badge', () => {
    const controller = new Controller();
    controller.store.apply(mk('session.started'));
    controller.store.apply(request('req_1', 'Opted out?'));

    const { unmount } = render(
      <AttentionPresence controller={controller} notifyEnabled={false} onNewRequest={() => {}} />,
    );
    expect(created).toHaveLength(0);
    expect(document.title).toBe('(1) AEP Mission Control'); // badge is not opt-in
    unmount();

    render(<AttentionPresence controller={new Controller()} notifyEnabled={true} onNewRequest={() => {}} />);
    expect(document.title).toBe('AEP Mission Control');
  });
});
