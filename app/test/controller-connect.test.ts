// Controller.connect() reconciliation — the SECOND call is the real-world
// path (the relay-settings dialog re-submits the whole set): a token edit
// tears down and reopens with the new token, a removed relay is stopped and
// its lanes dropped, an unchanged URL keeps its live Connection untouched,
// and a re-added relay opens fresh. Connection is module-mocked so no
// sockets open; the fakes record lifecycle calls and expose the onState
// closure each open() wires, so the aggregate-status ranking is driven
// through the real callback path.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnState } from '../src/core/connection';

interface FakeOpts {
  url: string;
  token?: string;
  onState: (state: ConnState, detail?: string) => void;
}

const { instances } = vi.hoisted(() => ({
  instances: [] as Array<{ opts: FakeOpts; started: number; stopped: number }>,
}));

vi.mock('../src/core/connection', () => {
  class Connection {
    opts: FakeOpts;
    started = 0;
    stopped = 0;
    constructor(opts: FakeOpts) {
      this.opts = opts;
      instances.push(this);
    }
    start(): void {
      this.started++;
    }
    stop(): void {
      this.stopped++;
    }
    persist(): void {}
  }
  return { Connection };
});

import { Controller } from '../src/state/controller';

const URL_A = 'http://127.0.0.1:19191';
const URL_B = 'http://127.0.0.1:19292';

beforeEach(() => {
  instances.length = 0;
});

describe('Controller.connect() reconciliation', () => {
  it('a token edit stops the old Connection and opens a new one with the new token', () => {
    const c = new Controller();
    c.connect([{ url: URL_A, token: 'alpha' }]);
    expect(instances).toHaveLength(1);
    const first = instances[0]!;
    expect(first.opts.token).toBe('alpha');
    expect(first.started).toBe(1);

    c.connect([{ url: URL_A, token: 'beta' }]);
    expect(first.stopped).toBe(1);
    expect(instances).toHaveLength(2);
    const second = instances[1]!;
    expect(second.opts.token).toBe('beta');
    expect(second.started).toBe(1);
    expect(c.connections.get(URL_A)).toBe(second);
    expect(c.statuses.get(URL_A)).toEqual({ state: 'connecting' });
  });

  it('a removed relay is stopped, its status cleared, and its lanes dropped', () => {
    const c = new Controller();
    const dropSource = vi.spyOn(c.store, 'dropSource');
    c.connect([
      { url: URL_A, token: '' },
      { url: URL_B, token: '' },
    ]);
    expect(instances).toHaveLength(2);

    c.connect([{ url: URL_A, token: '' }]);
    const removed = instances.find((i) => i.opts.url === URL_B)!;
    expect(removed.stopped).toBe(1);
    expect(c.connections.has(URL_B)).toBe(false);
    expect(c.statuses.has(URL_B)).toBe(false);
    expect(dropSource).toHaveBeenCalledExactlyOnceWith({ kind: 'relay', relay: URL_B });
    // the survivor was never touched
    const kept = instances.find((i) => i.opts.url === URL_A)!;
    expect(kept.stopped).toBe(0);
    expect(c.connections.get(URL_A)).toBe(kept);
  });

  it('an unchanged URL + token keeps the SAME live Connection (no stop, no reopen)', () => {
    const c = new Controller();
    c.connect([{ url: URL_A, token: 'alpha' }]);
    c.connect([{ url: URL_A, token: 'alpha' }]);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.stopped).toBe(0);
    expect(instances[0]!.started).toBe(1);
    expect(c.connections.get(URL_A)).toBe(instances[0]);
  });

  it('re-adding a removed relay opens a fresh Connection and reseeds its status', () => {
    const c = new Controller();
    c.connect([{ url: URL_A, token: '' }]);
    c.connect([]);
    expect(c.connections.size).toBe(0);
    expect(c.statuses.size).toBe(0);

    c.connect([{ url: URL_A, token: '' }]);
    expect(instances).toHaveLength(2);
    expect(instances[1]!.started).toBe(1);
    expect(c.connections.get(URL_A)).toBe(instances[1]);
    expect(c.statuses.get(URL_A)).toEqual({ state: 'connecting' });
  });
});

describe('Controller.status aggregate ranking', () => {
  it('is idle only when nothing is configured, then the WORST configured relay', () => {
    const c = new Controller();
    expect(c.status).toEqual({ state: 'idle' });

    c.connect([
      { url: URL_A, token: '' },
      { url: URL_B, token: '' },
    ]);
    // open() seeds 'connecting'; drive the wired onState closures like the transport would
    expect(c.status.state).toBe('connecting');
    instances[0]!.opts.onState('live');
    instances[1]!.opts.onState('live');
    expect(c.status.state).toBe('live');

    instances[1]!.opts.onState('connecting');
    expect(c.status.state).toBe('connecting'); // connecting outranks live

    instances[1]!.opts.onState('error', 'boom');
    expect(c.status.state).toBe('error'); // a dead relay is never masked
    expect(c.status.detail).toBe('boom');

    instances[1]!.opts.onState('live');
    expect(c.status.state).toBe('live');
  });
});
