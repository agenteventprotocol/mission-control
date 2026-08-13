// Pause/resume discipline (AEP-0004 §5 core verbs): the gate is ONLY the
// live backchannel — whether the target accepts the verbs, or is in a
// pausable state, is settled by the send itself (targets legitimately refuse
// a pause of nothing or a resume that would start work / bypass a pending
// confirmation; the refusal is the correct, sovereign answer). Connection is
// module-mocked per the controller-connect harness: no sockets open; the
// fake records pauseSession/resumeSession calls.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AepEvent } from '@agenteventprotocol/sdk';

const { instances } = vi.hoisted(() => ({
  instances: [] as Array<{
    opts: { url: string };
    pauseSession: ReturnType<typeof vi.fn>;
    resumeSession: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../src/core/connection', () => {
  class Connection {
    opts: { url: string };
    pauseSession = vi.fn().mockResolvedValue({ type: 'control.accepted' });
    resumeSession = vi.fn().mockResolvedValue({ type: 'control.accepted' });
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

const URL_A = 'http://127.0.0.1:19192';

let n = 0;
const mk = (type: string, extra: Record<string, unknown> = {}): AepEvent =>
  ({
    aep: '0.1',
    id: `ev_${String(++n).padStart(4, '0')}`,
    type,
    time: new Date(1700000000000 + n * 1000).toISOString(),
    source: 'aep://test/agent/openhands/session/s_pr',
    agent: 'openhands',
    session: 's_pr',
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

describe('canPauseResume', () => {
  it('requires only the live relay lane (acceptance settles on the send)', () => {
    const { controller, key } = liveLane();
    expect(controller.canPauseResume(key)).toBe(true);

    // anonymous-source lane: no backchannel, never pausable from here
    const bare = new Controller();
    bare.store.apply(mk('session.started', { seq: 0 }));
    const k2 = [...bare.store.sessions.keys()][0]!;
    expect(bare.canPauseResume(k2)).toBe(false);
  });
});

describe('pauseSession / resumeSession', () => {
  it('sends the session-scoped verbs via the owning relay', async () => {
    const { controller, key } = liveLane();
    await controller.pauseSession(key);
    await controller.resumeSession(key);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.pauseSession).toHaveBeenCalledWith('s_pr');
    expect(instances[0]!.resumeSession).toHaveBeenCalledWith('s_pr');
  });

  it('surfaces a refusal to the caller instead of swallowing it', async () => {
    const { controller, key } = liveLane();
    instances[0]!.resumeSession.mockRejectedValueOnce(
      new Error('refused: nothing to resume — the vendor run call would start work'),
    );
    await expect(controller.resumeSession(key)).rejects.toThrow(/refused/);
  });

  it('fails fast without a live backchannel', async () => {
    const controller = new Controller();
    controller.store.apply(mk('session.started', { seq: 0 }));
    const key = [...controller.store.sessions.keys()][0]!;
    await expect(controller.pauseSession(key)).rejects.toThrow();
    await expect(controller.resumeSession(key)).rejects.toThrow();
  });
});
