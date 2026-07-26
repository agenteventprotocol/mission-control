#!/usr/bin/env node
// Test fixture: vendored snapshot of the AEP reference relay (code home:
// https://github.com/agenteventprotocol/reference). Not part of any published
// artifact — it exists so the headless e2e can exercise the full stack offline.
// Scope (AEP-0003): ingest + attr-match fan-out + bounded replay (incl.
// from=all replay-all, §5) + the roster frame (§4.1) + token auth. Nothing
// else: no UI, no durable store, no scheduling.
'use strict';

const http = require('http');
const { URL } = require('url');
const path = require('path');
const { WebSocketServer } = require('ws');
const {
  validateFilter, attrMatch, downlevel, loadCaptureAnnotations,
  envelopeError, isCommandType, sevRank,
} = require('./aep.cjs');

const PORT = Number(process.env.AEP_PORT ?? 8787);
const TOKEN = process.env.AEP_TOKEN || null;
const BUFFER = Number(process.env.AEP_BUFFER ?? 10000);   // replay depth per session
const MAX_SESSIONS = Number(process.env.AEP_MAX_SESSIONS ?? 500);
const SOFT_BP = 1 << 20;   // drop debug/info beyond this buffered amount
const HARD_BP = 8 << 20;   // disconnect (never silently drop notice+) beyond this

// Capture annotations live in the schema registry, which this fixture does
// not vendor; without them, downlevel strips `data` wholesale below `full`
// (the conservative direction) — the smoke does not exercise capture ceilings.
const ANNOTATIONS = (() => {
  try { return loadCaptureAnnotations(path.join(__dirname, 'schemas', 'types')); }
  catch { return {}; }
})();

const CAPS = {
  filters: ['attr-match'],
  replay: { buffer: BUFFER, all: true },
  capture: ['none', 'metadata', 'redacted', 'full'],
  control: { accepts: [] },
  roster: {},
  experimental: {},
};
const DISCOVERY = {
  aep: ['0.1'],
  role: 'collector',
  endpoints: { events: '/events', stream: '/stream', socket: '/socket' },
  capabilities: CAPS,
};

// ---- session buffers --------------------------------------------------------
/** session -> { events: AepEvent[] (sorted by epoch,seq), ids: Set } */
const sessions = new Map();
const posKey = (ev) => (ev.epoch ?? 0) * 2 ** 40 + ev.seq;

function bufferEvent(ev) {
  let s = sessions.get(ev.session);
  if (s) {
    // LRU by write recency: refresh the Map position on every buffered write
    // so the eviction below drops the least-recently-written session, never a
    // still-active one
    sessions.delete(ev.session);
    sessions.set(ev.session, s);
  } else {
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    s = { events: [], ids: new Set() };
    sessions.set(ev.session, s);
  }
  if (s.ids.has(ev.id)) return false; // at-least-once dedupe
  s.ids.add(ev.id);
  // events almost always arrive in order; insert-sort from the tail otherwise
  const k = posKey(ev);
  let i = s.events.length;
  while (i > 0 && posKey(s.events[i - 1]) > k) i--;
  s.events.splice(i, 0, ev);
  if (s.events.length > BUFFER) {
    const dropped = s.events.shift();
    s.ids.delete(dropped.id);
  }
  return true;
}

function replayFrom(session, epoch, seq) {
  const s = sessions.get(session);
  if (!s) return { events: [], exhausted: false, earliest: null };
  const after = epoch * 2 ** 40 + seq;
  const events = s.events.filter((e) => posKey(e) > after);
  const earliest = s.events[0] ?? null;
  const exhausted = earliest !== null && posKey(earliest) > after + 1 && seq >= 0;
  return { events, exhausted, earliest };
}

// ---- subscribers ------------------------------------------------------------
/** entries: { filter, capture, deliver(ev)->bool, kind } */
const subscribers = new Set();

function fanOut(ev) {
  for (const sub of subscribers) {
    if (!attrMatch(sub.filter, ev)) continue;
    const out = sub.capture ? downlevel(ev, sub.capture, ANNOTATIONS) : ev;
    sub.deliver(out);
  }
}

// ---- command routing (AEP-0004; experimental) -------------------------------
/** ws conns: { ws, role, identity, accepts, sessionsOwned:Set } */
const conns = new Set();

function routeCommand(ev, fromConn) {
  if (!TOKEN) {
    // Control flows only on authenticated bindings — unconditionally,
    // localhost included (AEP-0004 §4.1, AEP-0003 §8.1). Without AEP_TOKEN
    // every duplex here is unauthenticated: observation still works, but
    // commands are refused toward the sender instead of routed.
    fromConn?.send({ type: 'error', code: 'unauthorized', cause: ev.id,
      detail: 'control requires an authenticated binding (AEP-0004 §4.1); this relay runs without AEP_TOKEN' });
    return;
  }
  const targets = [...conns].filter(
    (c) => c.role !== 'consumer' && c.sessionsOwned.has(ev.session),
  );
  if (targets.length === 0) {
    fromConn?.send({ type: 'error', code: 'no-route', cause: ev.id,
      detail: `no connected emitter owns session ${ev.session}` });
    return;
  }
  for (const t of targets) {
    if (t.accepts && !t.accepts.includes(ev.type)) {
      // relay nacks on the target's behalf (AEP-0004 §4.2) via an error frame
      // to the sender; event-shaped relay nacks are an open protocol question
      fromConn?.send({ type: 'error', code: 'unsupported', cause: ev.id,
        detail: `target does not accept ${ev.type}` });
      continue;
    }
    t.send(ev);
  }
  fanOut(ev); // audit visibility for subscribers; commands are not buffered (no seq)
}

function ingest(ev, fromConn) {
  const err = envelopeError(ev);
  if (err) return err;
  if (isCommandType(ev.type)) { routeCommand(ev, fromConn); return null; }
  if (ev.type.startsWith('agent.')) { fanOut(ev); return null; } // liveness: live-only
  if (fromConn) fromConn.sessionsOwned.add(ev.session);
  if (bufferEvent(ev)) fanOut(ev);
  return null;
}

// ---- auth -------------------------------------------------------------------
function authorized(req, url) {
  if (!TOKEN) return true;
  const h = req.headers.authorization;
  if (h === `Bearer ${TOKEN}`) return true;
  return url.searchParams.get('access_token') === TOKEN; // SSE/browser fallback (§8.1)
}

// ---- HTTP -------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  // /healthz is the one unauthenticated surface: supervisor/load-balancer
  // probes can't carry tokens. Minimal liveness only; counts stay behind auth.
  if (req.method === 'GET' && url.pathname === '/healthz') {
    const body = { ok: true };
    if (authorized(req, url)) {
      body.sessions = sessions.size;
      body.subscribers = subscribers.size;
      body.connections = conns.size;
      body.uptime_s = Math.round(process.uptime());
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
    return;
  }
  if (!authorized(req, url)) { res.writeHead(401).end(); return; }

  if (req.method === 'GET' && (url.pathname === '/events' || url.pathname === '/.well-known/aep')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(DISCOVERY, null, 2));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/events') {
    const ver = req.headers['aep-version'];
    if (ver !== '0.1') {
      res.writeHead(426, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ versions: ['0.1'] }));
      return;
    }
    const ct = (req.headers['content-type'] ?? '').split(';')[0].trim();
    if (ct !== 'application/json' && ct !== 'application/x-ndjson') {
      res.writeHead(415).end();
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 16 << 20) req.destroy(); });
    req.on('end', () => {
      try {
        const events = ct === 'application/x-ndjson'
          ? body.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
          : [JSON.parse(body)];
        for (let i = 0; i < events.length; i++) {
          const err = ingest(events[i], null);
          if (err) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid-event', line: i, detail: err }));
            return;
          }
        }
        res.writeHead(202).end();
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid-json', detail: String(e.message) }));
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/stream') {
    let filter = {};
    try { filter = url.searchParams.get('filter') ? JSON.parse(url.searchParams.get('filter')) : {}; }
    catch { res.writeHead(400).end('bad filter JSON'); return; }
    const ferr = validateFilter(filter);
    if (ferr) { res.writeHead(400).end(ferr); return; }
    const capture = url.searchParams.get('capture') || null;
    const live = url.searchParams.get('live') !== '0';

    // resume positions: ?from=[{session,epoch,seq}] takes precedence over Last-Event-ID
    const fromRaw = url.searchParams.get('from');
    // replay-all (AEP-0003 §5): every held session from its earliest
    // position; no replay-exhausted (the ask IS earliest-held)
    const replayAll = fromRaw === 'all';
    let from = [];
    if (replayAll) {
      from = [...sessions.keys()].map((s) => ({ session: s, epoch: 0, seq: -1 }));
    } else {
      try { from = fromRaw ? JSON.parse(fromRaw) : []; }
      catch { res.writeHead(400).end('bad from JSON'); return; }
    }
    const lei = req.headers['last-event-id'];
    if (from.length === 0 && lei) {
      const m = /^(.+):(\d+):(\d+)$/.exec(lei);
      if (m) from = [{ session: m[1], epoch: Number(m[2]), seq: Number(m[3]) }];
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    const send = (ev) => {
      if (res.writableLength > HARD_BP) { res.end(); return; }
      if (res.writableLength > SOFT_BP && sevRank(ev.severity) < sevRank('notice')) return;
      const out = capture ? downlevel(ev, capture, ANNOTATIONS) : ev;
      let msg = `event: ${out.type}\ndata: ${JSON.stringify(out)}\n`;
      if (out.session !== undefined && out.seq !== undefined) {
        msg += `id: ${out.session}:${out.epoch ?? 0}:${out.seq}\n`;
      }
      res.write(msg + '\n');
    };

    const explicit = new Set(from.map((f) => f.session));
    for (const f of from) {
      const { events, exhausted, earliest } = replayFrom(f.session, f.epoch ?? 0, f.seq ?? -1);
      if (exhausted && earliest) {
        if (!replayAll) res.write(`: replay-exhausted ${f.session} ${earliest.epoch ?? 0}:${earliest.seq}\n\n`);
      }
      for (const ev of events) if (attrMatch(filter, ev)) send(ev);
    }
    if (!live) {
      // replay-only mode additionally serves buffered history of sessions the
      // filter names (bounded replay, used by `aep timeline`)
      if (filter.session && !explicit.has(filter.session)) {
        for (const ev of replayFrom(filter.session, 0, -1).events) {
          if (attrMatch(filter, ev)) send(ev);
        }
      }
      res.write(': replay-complete\n\n');
      res.end();
      return;
    }

    const sub = { kind: 'sse', filter, capture, deliver: send, res };
    subscribers.add(sub);
    const hb = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { clearInterval(hb); subscribers.delete(sub); });
    return;
  }

  res.writeHead(404).end();
});

// ---- WebSocket --------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/socket') { socket.destroy(); return; }
  if (!authorized(req, url)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  const conn = {
    ws, role: null, identity: null, accepts: null,
    sessionsOwned: new Set(), subs: new Map(), helloDone: false,
    send(obj) {
      if (ws.bufferedAmount > HARD_BP) {
        ws.send(JSON.stringify({ type: 'closing', reason: 'backpressure', delivered: [] }));
        ws.close(1013, 'backpressure');
        return;
      }
      if (ws.bufferedAmount > SOFT_BP && obj.aep && sevRank(obj.severity) < sevRank('notice')) return;
      ws.send(JSON.stringify(obj));
    },
  };
  conns.add(conn);

  ws.on('message', (raw, isBinary) => {
    if (isBinary) { conn.send({ type: 'error', code: 'binary-unsupported' }); ws.close(1003); return; }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { conn.send({ type: 'error', code: 'bad-json' }); return; }
    const isEvent = typeof msg.type === 'string' && msg.type.includes('.');

    if (!conn.helloDone) {
      if (isEvent || msg.type !== 'hello') {
        conn.send({ type: 'error', code: 'hello-required' });
        ws.close(1002, 'hello required');
        return;
      }
      const versions = Array.isArray(msg.versions) ? msg.versions : [];
      if (!versions.includes('0.1')) {
        conn.send({ type: 'error', code: 'version-unsupported', versions: ['0.1'] });
        ws.close(1002, 'version unsupported');
        return;
      }
      conn.helloDone = true;
      conn.role = msg.role ?? 'both';
      conn.identity = msg.identity ?? null;
      conn.accepts = msg.capabilities?.control?.accepts ?? null;
      conn.caps = msg.capabilities ?? null;
      conn.send({
        type: 'hello', versions: ['0.1'], role: 'both',
        identity: { agent: 'aep-relay' }, capabilities: CAPS,
      });
      return;
    }

    if (isEvent) {
      const err = ingest(msg, conn);
      if (err) conn.send({ type: 'error', code: 'invalid-event', detail: err, cause: msg.id });
      return;
    }

    switch (msg.type) {
      case 'subscribe': {
        const ferr = validateFilter(msg.filter ?? {});
        if (ferr) { conn.send({ type: 'error', id: msg.id, code: 'invalid-filter', detail: ferr }); return; }
        // replay-all (AEP-0003 §5): expand to every held session at earliest;
        // no replay-exhausted frames (the ask IS earliest-held)
        const replayAll = msg.from === 'all';
        if (replayAll) {
          msg = { ...msg, from: [...sessions.keys()].map((s) => ({ session: s, epoch: 0, seq: -1 })) };
        }
        const sub = {
          kind: 'ws', filter: msg.filter ?? {}, capture: msg.capture ?? null,
          deliver: (ev) => conn.send(ev),
        };
        conn.subs.set(msg.id, sub);
        subscribers.add(sub);
        conn.send({ type: 'subscribed', id: msg.id });
        for (const f of msg.from ?? []) {
          const { events, exhausted, earliest } = replayFrom(f.session, f.epoch ?? 0, f.seq ?? -1);
          if (!replayAll && exhausted && earliest) {
            conn.send({ type: 'replay-exhausted', sub: msg.id, session: f.session,
              earliest: { epoch: earliest.epoch ?? 0, seq: earliest.seq } });
          }
          for (const ev of events) if (attrMatch(sub.filter, ev)) sub.deliver(ev);
        }
        return;
      }
      case 'roster': {
        // AEP-0003 §4.1: the live-claim snapshot — declarations verbatim,
        // one entry per claim, never merged; emitter-role refused in-band.
        if (conn.role === 'emitter') {
          conn.send({ type: 'error', id: msg.id, code: 'unauthorized',
            detail: 'roster is answered on consumer/both connections' });
          return;
        }
        const entries = [];
        for (const c of conns) {
          if (!c.helloDone || c.role === 'consumer') continue;
          for (const session of c.sessionsOwned) {
            const entry = { session };
            if (c.identity?.agent) entry.agent = c.identity.agent;
            if (c.identity?.instance) entry.instance = c.identity.instance;
            if (c.caps?.control) entry.control = c.caps.control;
            if (c.caps?.emits) entry.emits = c.caps.emits;
            entries.push(entry);
          }
        }
        conn.send({ type: 'roster', id: msg.id, entries });
        return;
      }
      case 'unsubscribe': {
        const sub = conn.subs.get(msg.id);
        if (sub) { subscribers.delete(sub); conn.subs.delete(msg.id); }
        conn.send({ type: 'unsubscribed', id: msg.id });
        return;
      }
      case 'ping': conn.send({ type: 'pong', t: msg.t }); return;
      case 'pong': return;
      default: return; // unknown frames ignored (AEP-0003 §2)
    }
  });

  ws.on('close', () => {
    for (const sub of conn.subs.values()) subscribers.delete(sub);
    conns.delete(conn);
  });

  const hb = setInterval(() => { if (ws.readyState === ws.OPEN) conn.send({ type: 'ping', t: Date.now() }); }, 25_000);
  ws.on('close', () => clearInterval(hb));
});

server.listen(PORT, () => {
  console.log(`aep-relay listening on :${PORT} (buffer ${BUFFER}/session, auth ${TOKEN ? 'on' : 'OFF — control routing disabled (AEP-0004 §4.1); set AEP_TOKEN to enable'})`);
});

// ---- graceful shutdown --------------------------------------------------------
// SIGTERM/SIGINT: stop accepting, tell every SSE subscriber the stream is
// ending (a `shutting-down` comment, then a clean end), close every WS with
// 1001 (going away), exit 0 once drained; force-exit 1 if the drain hangs.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const force = setTimeout(() => process.exit(1), 5000);
  server.close(() => { clearTimeout(force); process.exit(0); });
  for (const sub of subscribers) {
    if (sub.kind === 'sse' && sub.res) {
      try { sub.res.write(': shutting-down\n\n'); sub.res.end(); } catch {}
    }
  }
  for (const c of conns) { try { c.ws.close(1001, 'shutting down'); } catch {} }
  server.closeIdleConnections();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
