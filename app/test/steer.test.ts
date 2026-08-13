// Steering discipline (the vendor-verb path of AEP-0004 §5): the verb is
// DERIVED from the lane's agent attr — one consumer code path for every
// adapter that adopts the shared shape — and discovery is send-and-settle:
// canInstruct() gates only on the live backchannel + a known agent, and a
// target that never opted in surfaces the refusal where the send happened
// (the relay's sender-side `unsupported` is the correct, sovereign answer).
// Connection is module-mocked per the controller-connect harness: no
// sockets open; the fake records instruct() calls.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AepEvent } from '@agenteventprotocol/sdk';

const { instances } = vi.hoisted(() => ({
  instances: [] as Array<{
    opts: { url: string };
    instruct: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../src/core/connection', () => {
  class Connection {
    opts: { url: string };
    instruct = vi.fn().mockResolvedValue({ type: 'control.accepted' });
    constructor(opts: { url: string }) {
      this.opts = opts;
      instances.push(this);
    }
    start(): void {}
    stop(): void {}
    persist(): void {}
  }
  return { Connection };
});

import { Controller } from '../src/state/controller';

const URL_A = 'http://127.0.0.1:19191';

let n = 0;
const mk = (type: string, extra: Record<string, unknown> = {}): AepEvent =>
  ({
    aep: '0.1',
    id: `ev_${String(++n).padStart(4, '0')}`,
    type,
    time: new Date(1700000000000 + n * 1000).toISOString(),
    source: 'aep://test/agent/claude-code/session/s_steer',
    agent: 'claude-code',
    session: 's_steer',
    epoch: 1,
    capture: 'metadata',
    ...extra,
  }) as AepEvent;

beforeEach(() => {
  instances.length = 0; // config storage no-ops under jsdom (no localStorage)
});

function liveLane(): { controller: Controller; key: string } {
  const controller = new Controller();
  controller.connect([{ url: URL_A, token: 't' }]);
  const relayKey = [...controller.connections.keys()][0]!;
  controller.store.apply(mk('session.started', { seq: 0 }), {
    source: { kind: 'relay', relay: relayKey },
  });
  const key = [...controller.store.sessions.keys()][0]!;
  return { controller, key };
}

describe('canInstruct', () => {
  it('requires a live relay lane AND a known agent attr', () => {
    const { controller, key } = liveLane();
    expect(controller.canInstruct(key)).toBe(true);

    // anonymous-source lane: no backchannel, never steerable
    const bare = new Controller();
    bare.store.apply(mk('session.started', { seq: 0 }));
    const k2 = [...bare.store.sessions.keys()][0]!;
    expect(bare.canInstruct(k2)).toBe(false);

    // a lane without an agent attr cannot derive the verb
    controller.store.sessions.get(key)!.agent = undefined;
    expect(controller.canInstruct(key)).toBe(false);
  });
});

describe('instruct', () => {
  it('derives the vendor verb input from the agent attr and sends via the owning relay', async () => {
    const { controller, key } = liveLane();
    await controller.instruct(key, 'Prefer staging.');
    expect(instances).toHaveLength(1);
    expect(instances[0]!.instruct).toHaveBeenCalledWith(
      { session: 's_steer', agent: 'claude-code' },
      'Prefer staging.',
    );
  });

  it('surfaces a refusal to the caller instead of swallowing it', async () => {
    const { controller, key } = liveLane();
    instances[0]!.instruct.mockRejectedValueOnce(
      new Error('unsupported: target does not accept'),
    );
    await expect(controller.instruct(key, 'x')).rejects.toThrow(/unsupported/);
  });

  it('fails fast without a live backchannel', async () => {
    const controller = new Controller();
    controller.store.apply(mk('session.started', { seq: 0 }));
    const key = [...controller.store.sessions.keys()][0]!;
    await expect(controller.instruct(key, 'x')).rejects.toThrow();
  });
});
