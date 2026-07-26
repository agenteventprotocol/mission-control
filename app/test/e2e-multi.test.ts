// Headless multi-relay acceptance: one Controller, two fixture relays,
// real Connections, no mocks (ARCHITECTURE.md §7 lists these beats):
//   beat 1 — the same session name on both relays stays two lanes;
//   beat 2 — an inbox answer routes to the relay that owns the lane and
//            settles there; the other relay never sees the loop;
//   beat 3 — a lingering run on relay B is cancelled from the controller:
//            exactly one cause-linked run.cancelled settles B's lane off the
//            stream while relay A never carries the session;
//   beat 4 — killing one relay flips only its status; its pending item
//            stops being answerable (fail-fast surfaced on the item) while
//            the other relay stays live.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { laneKey } from '../src/core/store';
import { Controller } from '../src/state/controller';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const FIXTURES = here('./fixtures/reference');
const PORT_A = Number(process.env.AEP_E2E_MULTI_PORT ?? 18890);
const PORT_B = PORT_A + 1;
const RELAY_A = `http://127.0.0.1:${PORT_A}`;
const RELAY_B = `http://127.0.0.1:${PORT_B}`;
// control flows only on authenticated bindings (AEP-0004 §4.1); distinct
// tokens prove per-relay credentials travel with their connection
const TOKEN_A = 'e2e-token-alpha';
const TOKEN_B = 'e2e-token-beta';
const KA = (session: string): string => laneKey({ kind: 'relay', relay: RELAY_A }, session);
const KB = (session: string): string => laneKey({ kind: 'relay', relay: RELAY_B }, session);

const children = new Map<string, ChildProcess>();
function run(name: string, args: string[], env: Record<string, string> = {}): ChildProcess {
  const child = spawn('node', args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr!.on('data', (d: Buffer) => process.stderr.write(`  [${name}!] ${d}`));
  children.set(name, child);
  return child;
}
const agent = (name: string, relay: string, extra: string[]) =>
  run(name, [join(FIXTURES, 'synthetic-agent.cjs'), '--relay', relay,
    '--token', relay === RELAY_A ? TOKEN_A : TOKEN_B, ...extra]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(desc: string, cond: () => boolean, timeoutMs = 15_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return;
    await sleep(50);
  }
  throw new Error(`timeout waiting for: ${desc}`);
}

const controller = new Controller();

beforeAll(async () => {
  run('relay-a', [join(FIXTURES, 'server.cjs')], { AEP_PORT: String(PORT_A), AEP_TOKEN: TOKEN_A });
  run('relay-b', [join(FIXTURES, 'server.cjs')], { AEP_PORT: String(PORT_B), AEP_TOKEN: TOKEN_B });
  for (const relay of [RELAY_A, RELAY_B]) {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try {
        up = (await fetch(`${relay}/events`)).status < 500; // 401 = up, auth on
      } catch {
        await sleep(100);
      }
    }
    expect(up, `fixture relay ${relay} must come up`).toBe(true);
  }
  controller.connect([
    { url: RELAY_A, token: TOKEN_A, label: 'alpha' },
    { url: RELAY_B, token: TOKEN_B },
  ]);
}, 30_000);

afterAll(() => {
  for (const conn of controller.connections.values()) conn.stop();
  for (const c of children.values()) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
});

describe('multi-relay acceptance (one controller, two fixture relays)', () => {
  it('beat 1: the same session name on both relays stays two lanes', async () => {
    agent('twin-a', RELAY_A, ['--session', 's_twin', '--agent', 'sim-alpha', '--tools', '2']);
    agent('twin-b', RELAY_B, ['--session', 's_twin', '--agent', 'sim-beta', '--tools', '1']);
    await waitFor(
      'both twins laned separately',
      () =>
        controller.store.sessions.get(KA('s_twin'))?.status === 'ended' &&
        controller.store.sessions.get(KB('s_twin'))?.status === 'ended',
    );
    const a = controller.store.sessions.get(KA('s_twin'))!;
    const b = controller.store.sessions.get(KB('s_twin'))!;
    expect(a.agent).toBe('sim-alpha');
    expect(b.agent).toBe('sim-beta');
    expect(a.key).not.toBe(b.key);
    expect(a.session).toBe('s_twin');
    expect(b.session).toBe('s_twin'); // wire id untouched on both
  });

  it('beat 2: an answer routes to the owning relay and settles there', async () => {
    agent('gate-a', RELAY_A, ['--session', 's_gate', '--attention', 'true', '--tools', '1']);
    await waitFor(
      'gate pending in the inbox',
      () => controller.store.pendingAttention().some((i) => i.session === 's_gate'),
    );
    const item = controller.store.pendingAttention().find((i) => i.session === 's_gate')!;
    expect(item.laneKey).toBe(KA('s_gate'));
    expect(controller.canRespond(item)).toBe(true);
    controller.respond(item, { option: 'allow' });
    await waitFor(
      'answer settles on the owning relay',
      () => {
        const lane = controller.store.sessions.get(KA('s_gate'));
        const settled = lane?.attention.get(item.request.id);
        return settled?.state === 'resolved' || settled?.state === 'answered';
      },
    );
    // the other relay never carried the session, let alone the loop
    expect(controller.store.sessions.get(KB('s_gate'))).toBeUndefined();
    expect(
      [...controller.store.sessions.values()].filter((l) => l.session === 's_gate'),
    ).toHaveLength(1);
  });

  it('beat 3: a cancel routes to the owning relay and settles off the stream', async () => {
    agent('linger-b', RELAY_B, [
      '--session',
      's_linger',
      '--agent',
      'sim-linger',
      '--tools',
      '1',
      '--linger',
      '60000',
    ]);
    await waitFor('lingering run active on relay B', () => {
      const lane = controller.store.sessions.get(KB('s_linger'));
      return !!lane && [...lane.runs.values()].some((r) => r.state === 'active');
    });
    const lane = controller.store.sessions.get(KB('s_linger'))!;
    const run = [...lane.runs.values()].find((r) => r.state === 'active')!;

    expect(controller.canCancelRun(lane.key)).toBe(true);
    controller.cancelRun(lane.key, run.id, 'operator requested stop');
    await waitFor('cancelling marker armed', () => lane.runs.get(run.id)?.cancelling === true);

    await waitFor(
      'run.cancelled settles the lane off the stream',
      () => lane.runs.get(run.id)?.state === 'cancelled',
      20_000,
    );
    expect(lane.runs.get(run.id)?.cancelling).toBeFalsy();

    // exactly one cause-linked terminal, and the cause resolves to the
    // control.cancel command the relay fanned out to this live subscriber
    const terminals = lane.events.filter((o) => o.ev.type === 'run.cancelled');
    expect(terminals).toHaveLength(1);
    const rc = terminals[0]!.ev;
    expect(rc.run).toBe(run.id);
    expect(typeof rc.cause).toBe('string');
    const cmd = lane.byId.get(rc.cause as string);
    expect(cmd?.type).toBe('control.cancel');
    expect(cmd?.agent).toBe('mission-control');

    // relay A never carried the session, let alone the cancel loop
    expect(controller.store.sessions.get(KA('s_linger'))).toBeUndefined();
    expect(
      [...controller.store.sessions.values()].filter((l) => l.session === 's_linger'),
    ).toHaveLength(1);
  });

  it('beat 4: a dead relay flips only its own status; its items stop being answerable', async () => {
    agent('gate-b', RELAY_B, [
      '--session',
      's_gate_b',
      '--attention',
      'true',
      '--tools',
      '1',
      '--timeout',
      '60000',
    ]);
    await waitFor(
      'second gate pending',
      () => controller.store.pendingAttention().some((i) => i.session === 's_gate_b'),
    );
    const item = controller.store.pendingAttention().find((i) => i.session === 's_gate_b')!;
    expect(item.laneKey).toBe(KB('s_gate_b'));

    children.get('relay-b')!.kill('SIGKILL'); // exact child, never pkill
    await waitFor(
      'relay B reports error',
      () => controller.statuses.get(RELAY_B)?.state === 'error',
      20_000,
    );
    expect(controller.statuses.get(RELAY_A)?.state).toBe('live');
    expect(controller.status.state).toBe('error'); // aggregate = worst

    expect(controller.canRespond(item)).toBe(false);
    controller.respond(item, { option: 'allow' });
    await waitFor(
      'fail-fast surfaced on the item',
      () => controller.store.findAttention(item.request.id)?.error === 'relay not connected',
    );
    expect(controller.store.findAttention(item.request.id)?.state).toBe('pending');
  });
});
