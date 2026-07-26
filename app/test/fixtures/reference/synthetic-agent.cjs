#!/usr/bin/env node
// Test fixture: vendored snapshot of the AEP synthetic agent (code home:
// https://github.com/agenteventprotocol/reference). Not part of any published
// artifact — it exists so the headless e2e can drive the fixture relay with
// realistic sessions offline: emits over WS (duplex; can raise an attention
// gate and honor the control round-trip, AEP-0004) or HTTP POST (emit-only).
// With --linger <ms> the run keeps a heartbeat work loop open, and a routed
// control.cancel stops it: ack, then a cause-linked run.cancelled (§5/§6).
// With --close-grace <ms> the duplex stays open that long after
// session.ended — like a real agent that stays connected between runs — so
// late commands meet a live target (and nack `refused`, not no-route).
'use strict';

const os = require('os');
const { ulid, sha256Digest16 } = require('./aep.cjs');

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) =>
    a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : null,
  ).filter(Boolean),
);
const RELAY = (args.relay ?? process.env.AEP_RELAY ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const TOKEN = args.token ?? process.env.AEP_TOKEN ?? null;
const AGENT = args.agent ?? 'claude-sim';
const SESSION = args.session ?? `s_${ulid().slice(-8).toLowerCase()}`;
const MODE = args.mode ?? 'ws';
const ATTENTION = !!args.attention;
const TOOLS = Number(args.tools ?? 2);
const LINGER = Number(args.linger ?? 0);
const CLOSE_GRACE = Number(args['close-grace'] ?? 300);
const HOST = os.hostname();

let seq = 0;
const mk = (type, data, extra = {}) => {
  const ev = {
    aep: '0.1', id: ulid(), type, time: new Date().toISOString(),
    source: `aep://${HOST}/agent/${AGENT}/session/${SESSION}`,
    agent: AGENT, session: SESSION, seq: seq++, epoch: 1,
    severity: 'info', capture: 'redacted', ...extra,
  };
  if (data && Object.keys(data).length) ev.data = data;
  return ev;
};

async function emitHttp(events) {
  const res = await fetch(`${RELAY}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-ndjson',
      'aep-version': '0.1',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: events.map((e) => JSON.stringify(e)).join('\n'),
  });
  if (res.status !== 202) throw new Error(`ingest failed: ${res.status} ${await res.text()}`);
}

function script() {
  const run = `r_${SESSION}`;
  const events = [];
  const started = mk('session.started', { client: { name: AGENT }, label: 'demo session' });
  events.push(started);
  const runStarted = mk('run.started', { trigger: 'user', prompt: 'refactor the auth module' }, { run, cause: started.id });
  events.push(runStarted);
  let prev = runStarted;
  for (let i = 0; i < TOOLS; i++) {
    const input = { command: `make step-${i}` };
    const reqT = mk('tool.requested',
      { tool: { name: 'Bash', call_id: `t_${i}` }, args_digest: sha256Digest16(input) },
      { run, subject: 'Bash', cause: prev.id });
    const doneT = mk('tool.completed',
      { tool: { name: 'Bash', call_id: `t_${i}` }, duration_ms: 40 + i * 7, 'gen_ai.usage.input_tokens': 100 + i, 'gen_ai.usage.output_tokens': 50 + i },
      { run, subject: 'Bash', cause: reqT.id });
    events.push(reqT, doneT);
    prev = doneT;
  }
  return { run, events, prev };
}

async function main() {
  const { run, events, prev } = script();

  if (MODE === 'http') {
    await emitHttp(events);
    await emitHttp([
      mk('run.finished', { duration_ms: 1234 }, { run, cause: events[1].id }),
      mk('session.ended', { reason: 'normal', runs: 1 }, {}),
    ]);
    console.log(`${AGENT}: emitted ${seq} events over HTTP (session ${SESSION})`);
    return;
  }

  // WS mode: duplex, attention gate + control round-trip (AEP-0004)
  const url = RELAY.replace(/^http/, 'ws') + '/socket' + (TOKEN ? `?access_token=${encodeURIComponent(TOKEN)}` : '');
  const ws = new WebSocket(url);
  const send = (obj) => ws.send(JSON.stringify(obj));
  await new Promise((resolve, reject) => {
    ws.onopen = () => send({
      type: 'hello', versions: ['0.1'], role: 'emitter',
      identity: { agent: AGENT, instance: `${HOST}/${process.pid}` },
      capabilities: {
        emits: ['session', 'run', 'tool', 'attention', 'progress'],
        capture: ['none', 'metadata', 'redacted'],
        control: { accepts: ['control.attention.respond', 'control.cancel'], ack_window_ms: 10000 },
      },
    });
    ws.onerror = (e) => reject(new Error('ws error'));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.type === 'hello') resolve();
    };
  });

  // Persistent command dispatcher (AEP-0004 target side): dedupe on command id
  // (§2.3 — a retransmit is the same command), exactly one ack per command
  // (§3), declared-scope honoring with nack for the rest (§7).
  const state = { run, runStartedAt: Date.now(), cancelled: false, pendingAttention: null };
  const seenCommands = new Set();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === 'ping') { send({ type: 'pong', t: msg.t }); return; }
    if (typeof msg.type !== 'string' || !msg.type.startsWith('control.')) return;
    if (msg.id) {
      if (seenCommands.has(msg.id)) return;
      seenCommands.add(msg.id);
    }
    if (msg.type === 'control.attention.respond') {
      if (state.pendingAttention && msg.subject === state.pendingAttention.req.id) {
        send(mk('control.accepted', {}, { cause: msg.id }));
        state.pendingAttention.settle({ cmd: msg, option: msg.data?.answer?.option ?? 'deny' });
      } else {
        // unknown or already-settled request: silence would read as a timeout
        // nack sender-side (§3) — say what happened instead
        send(mk('control.rejected', { reason: 'invalid' }, { cause: msg.id }));
      }
      return;
    }
    if (msg.type === 'control.cancel') {
      if (!state.run || state.cancelled) {
        send(mk('control.rejected', { reason: 'refused' }, { cause: msg.id }));
        return;
      }
      send(mk('control.accepted', {}, { cause: msg.id })); // "will try" (§3)
      state.cancelled = true; // the work loop observes this and stops
      if (state.pendingAttention) {
        // an open gate cannot outlive its run: settle it truthfully
        send(mk('attention.resolved', { resolution: 'dismissed' },
          { subject: state.pendingAttention.req.id, cause: msg.id }));
        state.pendingAttention.settle('cancelled');
      }
      send(mk('run.cancelled', {
        by: 'control',
        // reason is redacted-annotated; this agent emits at capture
        // "redacted", so the operator's text may be carried through (gated)
        ...(typeof msg.data?.reason === 'string' ? { reason: msg.data.reason } : {}),
        duration_ms: Math.max(0, Date.now() - state.runStartedAt),
      }, { run: state.run, cause: msg.id, severity: 'notice' }));
      state.run = null;
      return;
    }
    send(mk('control.rejected', { reason: 'unsupported' }, { cause: msg.id })); // §7: accepts is authoritative
  };

  for (const ev of events) send(ev);

  if (LINGER > 0) {
    // lingering work: the run stays open with droppable heartbeats until the
    // budget elapses or a cancel stops the loop
    const t0 = Date.now();
    while (Date.now() - t0 < LINGER && !state.cancelled) {
      send(mk('progress.status', {}, { run, severity: 'debug' }));
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  if (state.cancelled) {
    // run.cancelled already emitted by the command dispatcher
  } else if (ATTENTION) {
    const req = mk('attention.requested', {
      kind: 'permission',
      prompt: 'Permission requested: Bash — rm -rf build/ (clean the build tree)',
      options: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }],
      respond_via: ['control'],
    }, { run, subject: 'Bash', severity: 'notice', cause: prev.id });
    send(req);
    console.log(`${AGENT}: waiting on attention ${req.id}`);

    const answer = await new Promise((resolve) => {
      const timer = setTimeout(() => { state.pendingAttention = null; resolve(null); },
        Number(args.timeout ?? 30_000));
      state.pendingAttention = {
        req,
        settle: (a) => { clearTimeout(timer); state.pendingAttention = null; resolve(a); },
      };
    });

    if (answer === 'cancelled') {
      // the dispatcher dismissed the gate and emitted run.cancelled
    } else if (answer) {
      const ans = mk('attention.answered', { answer: { option: answer.option }, via: 'control' },
        { subject: req.id, cause: answer.cmd.id });
      send(ans);
      send(mk('attention.resolved',
        { resolution: 'answered', latency_ms: Math.max(0, Math.round(Date.now() - Date.parse(req.time))) },
        { subject: req.id, cause: ans.id }));
      send(mk(answer.option === 'allow' ? 'run.finished' : 'run.cancelled',
        answer.option === 'allow' ? { duration_ms: 2100 } : { by: 'control' },
        { run, cause: ans.id }));
      console.log(`${AGENT}: attention answered ${answer.option}`);
    } else {
      send(mk('attention.timeout', { after_ms: 30000 }, { subject: req.id, cause: req.id, severity: 'notice' }));
      send(mk('run.failed', { reason: 'attention_timeout' }, { run }));
      console.log(`${AGENT}: attention timed out`);
    }
  } else {
    send(mk('run.finished', { duration_ms: 900 }, { run }));
  }
  state.run = null; // one terminal per run: a late cancel now nacks "refused"

  send(mk('session.ended', { reason: 'normal', runs: 1 }, {}));
  setTimeout(() => { ws.close(); console.log(`${AGENT}: done (${seq} events, session ${SESSION})`); }, CLOSE_GRACE);
}

main().catch((e) => { console.error(e); process.exit(1); });
