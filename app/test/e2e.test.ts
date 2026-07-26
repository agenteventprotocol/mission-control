// Headless end-to-end acceptance against the vendored reference-relay
// fixture, driven by the fixture synthetic agent — real Connection + Store
// instances, no mocks, no network beyond loopback:
//   beat 1 — live events land laned, ordered, fully derived;
//   beat 2 — kill-and-reattach resumes from persisted positions with no
//            gaps (including events emitted while detached), and the
//            documented protocol limit (a session born AND ended while
//            detached is unreachable) still holds;
//   beat 3 — answering from the inbox completes the control round-trip:
//            ack received, attention.answered/resolved observed on the
//            stream, run terminal;
//   beat 5 — the step/state families derive live: posted step boundaries
//            group run events in order, and the state panel's reducer is
//            capture-honest (gated patches count, never fabricate).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from '@aep/sdk';
import type { AepEvent, ResumePosition } from '@aep/sdk';
import { Store, laneKey } from '../src/core/store';
import { Connection } from '../src/core/connection';
import type { PositionStore } from '../src/core/connection';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const FIXTURES = here('./fixtures/reference');
const PORT = Number(process.env.AEP_E2E_PORT ?? 18790);
const RELAY = `http://127.0.0.1:${PORT}`;
// control flows only on authenticated bindings (AEP-0004 §4.1)
const TOKEN = 'e2e-token';
const BARE_PORT = PORT + 1; // a tokenless relay for the watch-only beat
const BARE_RELAY = `http://127.0.0.1:${BARE_PORT}`;
// lanes are keyed by (relay, session)
const K = (session: string): string => laneKey({ kind: 'relay', relay: RELAY }, session);

const workDir = mkdtempSync(join(tmpdir(), 'aep-mc-e2e-'));
const POS_FILE = join(workDir, 'positions.json');

const positionStore: PositionStore = {
  load() {
    try {
      return existsSync(POS_FILE)
        ? (JSON.parse(readFileSync(POS_FILE, 'utf8')) as ResumePosition[])
        : [];
    } catch {
      return [];
    }
  },
  save(positions) {
    writeFileSync(POS_FILE, JSON.stringify(positions));
  },
};

const children: ChildProcess[] = [];
function run(args: string[], env: Record<string, string> = {}): ChildProcess {
  const child = spawn('node', args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr!.on('data', (d: Buffer) => process.stderr.write(`  [child!] ${d}`));
  children.push(child);
  return child;
}
const agent = (extra: string[]) =>
  run([join(FIXTURES, 'synthetic-agent.cjs'), '--relay', RELAY, '--token', TOKEN, ...extra]);
const exited = (child: ChildProcess) =>
  new Promise<number | null>((r) =>
    child.exitCode !== null ? r(child.exitCode) : child.once('exit', r),
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(desc: string, cond: () => boolean, timeoutMs = 15_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return;
    await sleep(50);
  }
  throw new Error(`timeout waiting for: ${desc}`);
}

let connA: Connection;
let connB: Connection;
const storeA = new Store();
const storeB = new Store();

beforeAll(async () => {
  run([join(FIXTURES, 'server.cjs')], { AEP_PORT: String(PORT), AEP_TOKEN: TOKEN });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try {
      up = (await fetch(`${RELAY}/events`, { headers: { authorization: `Bearer ${TOKEN}` } })).status < 500;
    } catch {
      await sleep(100);
    }
  }
  expect(up, 'fixture relay must come up').toBe(true);
});

afterAll(() => {
  connA?.stop();
  connB?.stop();
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  rmSync(workDir, { recursive: true, force: true });
});

// ---- session under our control, split across the detach in beat 2 ----------
let eSeq = 0;
const mkE = (
  type: string,
  data: Record<string, unknown> | null,
  extra: Record<string, unknown> = {},
): AepEvent =>
  ({
    aep: '0.1',
    id: ulid(),
    type,
    time: new Date().toISOString(),
    source: 'aep://e2e/agent/sim-e/session/s_e2e_e',
    agent: 'sim-e',
    session: 's_e2e_e',
    seq: eSeq++,
    epoch: 1,
    severity: 'info',
    capture: 'redacted',
    ...(data ? { data } : {}),
    ...extra,
  }) as AepEvent;

async function postE(events: AepEvent[]): Promise<void> {
  const res = await fetch(`${RELAY}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-ndjson',
      'aep-version': '0.1',
      authorization: `Bearer ${TOKEN}`,
    },
    body: events.map((e) => JSON.stringify(e)).join('\n'),
  });
  expect(res.status, await res.clone().text()).toBe(202);
}

describe('mission control acceptance (fixture relay + synthetic agents)', () => {
  it('beat 1: live events land laned, ordered, fully derived', async () => {
    connA = new Connection({
      url: RELAY,
      token: TOKEN,
      store: storeA,
      positions: positionStore,
      agent: 'mission-control',
      host: 'e2e',
    });
    connA.start();

    const a1 = agent(['--session', 's_e2e_a', '--mode', 'http', '--tools', '3', '--agent', 'sim-a']);
    const a2 = agent(['--session', 's_e2e_b', '--mode', 'ws', '--tools', '2', '--agent', 'sim-b']);
    await Promise.all([exited(a1), exited(a2)]);

    await waitFor('both sessions complete and ended', () => {
      const la = storeA.sessions.get(K('s_e2e_a'));
      const lb = storeA.sessions.get(K('s_e2e_b'));
      return (
        la?.status === 'ended' &&
        la.events.length === 10 &&
        lb?.status === 'ended' &&
        lb.events.length === 8
      );
    });

    const la = storeA.sessions.get(K('s_e2e_a'))!;
    expect(la.events.map((o) => o.ev.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([...la.runs.values()].every((r) => r.state !== 'active')).toBe(true);
    expect(la.agent).toBe('sim-a');

    const lb = storeA.sessions.get(K('s_e2e_b'))!;
    const ords = lb.events.map((o) => o.ord);
    expect(ords.every((v, i) => i === 0 || v >= ords[i - 1]!)).toBe(true);
  });

  it('beat 2: kill mid-session, emit while away, reattach — no gaps', async () => {
    const eStart = mkE('session.started', { client: { name: 'sim-e' } });
    const eRun = mkE('run.started', { trigger: 'user' }, { run: 'r_e', cause: eStart.id });
    await postE([
      eStart,
      eRun,
      mkE('tool.requested', { tool: { name: 'Bash', call_id: 't0' } }, { run: 'r_e', cause: eRun.id }),
    ]);
    await waitFor(
      'first half of session e observed live',
      () => storeA.sessions.get(K('s_e2e_e'))?.events.length === 3,
    );

    connA.stop(); // persists the known-session set
    const posBefore = positionStore.load();
    expect(posBefore).toHaveLength(3);
    expect(posBefore.every((p) => typeof p.seq === 'number')).toBe(true);

    // While detached: session e finishes, and an entirely unknown session c
    // starts AND ends (the documented protocol limit).
    await postE([
      mkE('tool.completed', { tool: { name: 'Bash', call_id: 't0' }, duration_ms: 40 }, { run: 'r_e' }),
      mkE('run.finished', { duration_ms: 900 }, { run: 'r_e' }),
      mkE('session.ended', { reason: 'normal', runs: 1 }),
    ]);
    await exited(agent(['--session', 's_e2e_c', '--mode', 'http', '--tools', '1', '--agent', 'sim-c']));

    connB = new Connection({
      url: RELAY,
      token: TOKEN,
      store: storeB,
      positions: positionStore,
      agent: 'mission-control',
      host: 'e2e',
    });
    connB.start();

    await waitFor('reattach rebuilds session e complete and ended', () => {
      const le = storeB.sessions.get(K('s_e2e_e'));
      return le?.status === 'ended' && le.events.length === 6;
    });
    const le = storeB.sessions.get(K('s_e2e_e'))!;
    expect(le.events.map((o) => o.ev.seq), 'gap-free across the detach').toEqual([0, 1, 2, 3, 4, 5]);

    await waitFor(
      'lanes a/b fully rebuilt from bounded replay',
      () =>
        storeB.sessions.get(K('s_e2e_a'))?.events.length === 10 &&
        storeB.sessions.get(K('s_e2e_b'))?.events.length === 8,
    );
    // Documented protocol limit: no session discovery for consumers, so a
    // session born and ended entirely while detached is unreachable.
    expect(storeB.sessions.has('s_e2e_c')).toBe(false);
  });

  it('beat 3: answering from the inbox completes the control round-trip', async () => {
    const a4 = agent([
      '--session',
      's_e2e_d',
      '--mode',
      'ws',
      '--attention',
      '--tools',
      '1',
      '--agent',
      'sim-d',
    ]);
    await waitFor('attention.requested arrives pending in the inbox', () =>
      storeB.pendingAttention().some((i) => i.session === 's_e2e_d'),
    );

    const item = storeB.pendingAttention().find((i) => i.session === 's_e2e_d')!;
    const ack = await connB.respond(item, { option: 'allow' });
    expect(ack.type).toBe('control.accepted');

    await waitFor('answered + resolved observed on the stream; run terminal', () => {
      const ld = storeB.sessions.get(K('s_e2e_d'));
      const it = ld?.attention.get(item.request.id);
      return (
        it?.state === 'resolved' &&
        (it.answer as { option?: string } | undefined)?.option === 'allow' &&
        !!ld &&
        [...ld.runs.values()].every((r) => r.state !== 'active')
      );
    });

    const ld = storeB.sessions.get(K('s_e2e_d'))!;
    const types = [...ld.byId.values()].map((e) => e.type);
    // the command is visible on the stream (foreign-emitter, seq-less)
    expect(types).toContain('control.attention.respond');
    expect(types).toContain('attention.answered');
    expect(types).toContain('attention.resolved');
    expect(types).toContain('run.finished');

    await exited(a4);
  });

  it('beat 4: a watch-only (tokenless) relay refuses the answer; the item reverts with the error surfaced', async () => {
    run([join(FIXTURES, 'server.cjs')], { AEP_PORT: String(BARE_PORT) });
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try {
        up = (await fetch(`${BARE_RELAY}/events`)).status < 500;
      } catch {
        await sleep(100);
      }
    }
    expect(up, 'bare relay must come up').toBe(true);

    const storeC = new Store();
    const connC = new Connection({
      url: BARE_RELAY,
      store: storeC,
      positions: { load: () => [], save: () => {} },
      agent: 'mission-control',
      host: 'e2e',
    });
    connC.start();
    const a5 = run([
      join(FIXTURES, 'synthetic-agent.cjs'), '--relay', BARE_RELAY,
      '--session', 's_e2e_bare', '--mode', 'ws', '--attention', '--tools', '1', '--agent', 'sim-bare',
    ]);
    await waitFor('gate arrives over the tokenless relay (observation still works)', () =>
      storeC.pendingAttention().some((i) => i.session === 's_e2e_bare'),
    );

    const bareKey = laneKey({ kind: 'relay', relay: BARE_RELAY }, 's_e2e_bare');
    const item = storeC.pendingAttention().find((i) => i.session === 's_e2e_bare')!;
    const t0 = Date.now();
    await expect(connC.respond(item, { option: 'allow' })).rejects.toMatchObject({
      reason: 'unauthorized',
    });
    // the refusal is stated, not a window timeout: it settles fast
    expect(Date.now() - t0).toBeLessThan(5_000);
    const after = storeC.sessions.get(bareKey)!.attention.get(item.request.id)!;
    expect(after.state).toBe('pending'); // reverted — still answerable elsewhere
    expect(after.error).toMatch(/unauthorized/);

    connC.stop();
    a5.kill('SIGTERM');
  });

  it('beat 5: step and state families derive live from posted events', async () => {
    let sSeq = 0;
    const mkS = (
      type: string,
      data: Record<string, unknown> | null,
      extra: Record<string, unknown> = {},
    ): AepEvent =>
      ({
        aep: '0.1',
        id: ulid(),
        type,
        time: new Date().toISOString(),
        source: 'aep://e2e/agent/agui/session/s_e2e_steps',
        agent: 'agui',
        session: 's_e2e_steps',
        seq: sSeq++,
        epoch: 1,
        capture: 'metadata',
        ...(data ? { data } : {}),
        ...extra,
      }) as AepEvent;

    const run = 'run_steps_1';
    await postE([
      mkS('run.started', { trigger: 'user' }, { run }),
      mkS('run.step.started', null, { run, subject: 'plan', step: 'plan' }),
      mkS('tool.requested', { tool: { name: 'search', call_id: 'c1' } }, { run, subject: 'search' }),
      mkS('run.step.finished', null, { run, subject: 'plan', step: 'plan' }),
      mkS('state.snapshot', { state: { done: 1, plan: ['search'] } }, { run }),
      mkS('state.delta', { ops: 2, delta: [
        { op: 'replace', path: '/done', value: 2 },
        { op: 'add', path: '/plan/-', value: 'answer' },
      ] }, { run }),
      mkS('state.delta', { ops: 3 }, { run }), // body gated at metadata: counted, never faked
      mkS('run.finished', null, { run }),
    ]);

    const key = K('s_e2e_steps');
    await waitFor('the step/state session fully lands', () =>
      (storeB.sessions.get(key)?.events.length ?? 0) >= 8,
    );

    const steps = storeB.stepsOf(key);
    const lane = storeB.sessions.get(key)!;
    const toolEv = lane.events.find((o) => o.ev.type === 'tool.requested')!.ev;
    const startedEv = lane.events.find((o) => o.ev.type === 'run.started')!.ev;
    expect(steps.get(toolEv.id)).toBe('plan'); // grouped inside its step
    expect(steps.get(startedEv.id)).toBeUndefined(); // before the boundary

    const st = storeB.stateOf(key);
    expect(st.value).toEqual({ done: 2, plan: ['search', 'answer'] });
    expect(st.appliedOps).toBe(2);
    expect(st.gatedOps).toBe(3); // honest: counted from data.ops, nothing reconstructed
  });

  it('beat 6: a from=all cold start sees history it never knew, and the roster declares the live claim', async () => {
    // history posted by a foreign emitter this observer holds NO positions
    // for: without replay-all a positionless cold start would get live-only
    const sHist = `s_e2e_hist_${ulid().slice(-6).toLowerCase()}`;
    let hSeq = 0;
    const mkH = (type: string, data: Record<string, unknown> | null): AepEvent =>
      ({
        aep: '0.1', id: ulid(), type, time: new Date().toISOString(),
        source: `aep://e2e/agent/sim-h/session/${sHist}`, agent: 'sim-h',
        session: sHist, seq: hSeq++, epoch: 1, capture: 'metadata',
        ...(data ? { data } : {}),
      }) as AepEvent;
    await postE([mkH('session.started', { client: { name: 'sim-h' } }), mkH('session.ended', { reason: 'normal' })]);

    // a live WS claimant with a declared control block, lingering
    const claimant = agent(['--session', 's_e2e_ro', '--mode', 'ws', '--tools', '1', '--agent', 'sim-ro', '--linger', '30000']);

    const store = new Store();
    const conn = new Connection({
      url: RELAY, token: TOKEN, store,
      positions: { load: () => [], save: () => {} }, // a true cold start
      agent: 'mission-control', host: 'e2e',
    });
    conn.start();
    try {
      await waitFor('replay-all delivered the never-known history', () => {
        const lane = store.sessions.get(K(sHist));
        return lane?.status === 'ended' && lane.events.length === 2;
      });
      await waitFor('the roster declared the live claim on its lane',
        () => (store.sessions.get(K('s_e2e_ro'))?.declared?.length ?? 0) >= 1);
      const claim = store.sessions.get(K('s_e2e_ro'))!.declared![0]!;
      expect(claim.agent).toBe('sim-ro');
      expect(claim.accepts).toContain('control.attention.respond');
      expect(conn.rosterSupported()).toBe(true);
    } finally {
      conn.stop();
      claimant.kill('SIGTERM');
    }
  });
});
