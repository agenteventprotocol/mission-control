// Event-sourced UI state: the entire app state is a fold over the AEP stream.
// There is no second source of truth and no out-of-band fetching. This module
// is DOM- and framework-free by design — the same store runs in the browser
// and in the headless test harness under Node.
import type { AepEvent, Severity } from '@aep/sdk';

export type SessionStatus = 'active' | 'ended';
export type RunState = 'active' | 'finished' | 'failed' | 'cancelled';
export type AttentionState = 'pending' | 'responding' | 'answered' | 'resolved' | 'timeout';

export interface RunInfo {
  id: string;
  state: RunState;
  startedId?: string;
  endedId?: string;
  /**
   * Optimistic in-flight marker while a `control.cancel` awaits its ack —
   * the run-scoped mirror of the attention item's `responding`. Never a
   * state: `state` settles only when a terminal arrives on the stream.
   */
  cancelling?: boolean;
  /** Last cancel failure (nack / ack-window timeout), shown on the run. */
  error?: string;
}

export interface AttentionItem {
  /** The `attention.requested` event; its `id` keys the lifecycle. */
  request: AepEvent;
  /** The wire session id — what a respond command must carry (AEP-0004 §2.2). */
  session: string;
  /** The owning lane — what routing (which relay answers) must use. */
  laneKey: string;
  state: AttentionState;
  /** `data.answer` from `attention.answered`, once observed on the stream. */
  answer?: unknown;
  /** Last respond failure (nack / ack-window timeout), shown in the inbox. */
  error?: string;
}

/**
 * Where a lane's events come from: a relay-sourced lane has a live
 * backchannel (commands route to that relay); an import-sourced lane is
 * capture history with none. A relay's identity is its normalized URL;
 * the empty string is the anonymous single-source default (headless
 * tests, callers that configure no relay).
 */
export type LaneSource = { kind: 'relay'; relay: string } | { kind: 'import' };

export const IMPORT_SOURCE: LaneSource = { kind: 'import' };

/**
 * Lane identity is (source, session): the same session name on two relays
 * is two lanes (an owner stream lives on exactly one relay). U+0000 as the
 * separator cannot appear in a URL and never legitimately in a session id;
 * the anonymous default keys by the bare session id so single-source use
 * is unchanged.
 */
export function laneKey(source: LaneSource, session: string): string {
  if (source.kind === 'import') return `\u0000import\u0000${session}`;
  return source.relay ? `${source.relay}\u0000${session}` : session;
}

export interface OrderedEvent {
  ev: AepEvent;
  /** Sort key: epoch·2⁴⁰+seq for owner events, arrival-derived for seq-less. */
  ord: number;
}

/** Session state reconstructed from state.snapshot / state.delta in order. */
export interface LaneState {
  /** The latest reconstructed value; undefined when never snapshotted or gated. */
  value: unknown;
  /** A snapshot event was seen (even if its payload was capture-gated). */
  hasSnapshot: boolean;
  /** Patch operations applied onto the value. */
  appliedOps: number;
  /** Operations whose patch bodies were capture-gated away (counted, never faked). */
  gatedOps: number;
  /** Operations whose application failed against the current value. */
  skippedOps: number;
  /** `time` of the last state event, if any. */
  lastAt: string | null;
}

/**
 * How a control send settled for a lane, per verb — OBSERVED capability
 * truth. Since AEP-0003 §4.1 (the roster frame) declared capability is
 * consumer-visible too — a lane can carry both, provenance-labeled: the
 * roster's claims are a snapshot (`DeclaredClaim[]`), the settles are what
 * this observer actually saw. Neither ever gates the send path.
 */
export interface ControlSettle {
  state: 'accepted' | 'refused';
  /** Nack reason when refused (unsupported | unauthorized | busy | refused | invalid | timeout). */
  reason?: string;
  detail?: string;
  /** ms timestamp (store clock) of the settle. */
  at: number;
}

/** One live emitter claim from a relay roster (AEP-0003 §4.1), verbatim. */
export interface DeclaredClaim {
  agent?: string;
  instance?: string;
  accepts: string[];
  ackWindowMs?: number;
  emits?: string[];
}

export interface Lane {
  /** `laneKey(source, session)` — the sessions-map key and route target. */
  key: string;
  /** The wire session id (what commands must carry upstream). */
  session: string;
  /**
   * Where this lane's events come from. `kind: 'import'` lanes have no
   * live backchannel, so their attention is never actionable; a lane that
   * exists only from a capture rebinds to the first relay that delivers
   * live traffic for its session name (see `apply`).
   */
  source: LaneSource;
  agent?: string;
  label?: string;
  status: SessionStatus;
  events: OrderedEvent[];
  byId: Map<string, AepEvent>;
  runs: Map<string, RunInfo>;
  attention: Map<string, AttentionItem>;
  /** ms timestamp of the latest event's `time` (arrival time if unparsable). */
  lastActivity: number;
  /** True once the relay reported replay-exhausted for this session. */
  gap: boolean;
  /** Events seen per severity level (absent severity counts as `info`). */
  severityCounts: Partial<Record<Severity, number>>;
  /** Last observed settle per control verb sent from this observer. */
  control: Map<string, ControlSettle>;
  /**
   * The relay roster's live claims for this session (AEP-0003 §4.1),
   * verbatim, one entry per claim — TWO entries mean two live claimants
   * (the ambiguous state, rendered, never merged). An EMPTY array means
   * the last roster no longer listed the session (no live route);
   * `undefined` means no roster has been recorded for this lane's source.
   * A snapshot, never a promise: `declaredAt` stamps it, and the send
   * path never gates on it.
   */
  declared?: DeclaredClaim[];
  /** ms timestamp (store clock) of the last roster recording. */
  declaredAt?: number;
  /**
   * Event kind families observed on this lane (`tool`, `attention`,
   * `x.hermes`, …) — durable across the bounded raw tail, so the observed
   * surface survives trimming.
   */
  kindsSeen: Set<string>;
  /**
   * Events dropped past the per-lane cap (oldest first). Derived lifecycle
   * state (runs, attention, severity counts) keeps the whole story; only
   * the raw event list is bounded.
   */
  trimmed: number;
  /** Change counter: bumps on every applied event / state transition. */
  version: number;
}

export interface DagEdge {
  from: string;
  to: string;
  kind: 'cause' | 'subject';
}
export interface Dag {
  nodes: AepEvent[];
  edges: DagEdge[];
}

/** Kind family of an event type: `tool.completed` → `tool`; `x.hermes.…` → `x.hermes`. */
function kindFamily(type: string): string {
  const parts = type.split('.');
  return parts[0] === 'x' && parts.length > 1 ? `x.${parts[1]}` : (parts[0] as string);
}

const EPOCH_SHIFT = 2 ** 40; // same (epoch, seq) key construction the relay uses
const posKey = (ev: AepEvent): number => (ev.epoch ?? 0) * EPOCH_SHIFT + (ev.seq as number);

/** Global live-tail retention (arrival order); older entries are dropped. */
const RECENT_CAP = 5000;

/**
 * Per-lane retention: oldest events drop past this bound so a tab left
 * open for days stays flat. Mirrors the relay's own bounded per-session
 * replay buffer (same order of magnitude); dropped ids leave the dedupe
 * set, so a very late duplicate re-buffers (and is re-trimmed) rather than
 * silently vanishing — the relay's own dedupe/eviction interplay.
 */
const LANE_CAP = 10_000;

/** Arrival-rate bucketing: 30s windows, ~20 minutes of history retained. */
const RATE_BUCKET_MS = 30_000;
const RATE_BUCKETS_KEPT = 48;

type Listener = (laneKey: string | null) => void;

/** One RFC 6902 op (add/replace/remove) against the state root; boolean = applied. */
function applyPatchOp(st: LaneState, op: unknown): boolean {
  if (!op || typeof op !== 'object') return false;
  const { op: kind, path, value } = op as { op?: string; path?: string; value?: unknown };
  if (typeof path !== 'string' || !path.startsWith('/')) return false;
  const keys = path.split('/').slice(1).map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (keys.length === 0) return false;
  const last = keys[keys.length - 1] as string;
  if (st.value === undefined || st.value === null || typeof st.value !== 'object') {
    // no object to patch (never snapshotted, or gated): nothing honest to do
    return false;
  }
  let parent: unknown = st.value;
  for (const k of keys.slice(0, -1)) {
    if (Array.isArray(parent)) parent = parent[Number(k)];
    else if (parent && typeof parent === 'object') parent = (parent as Record<string, unknown>)[k];
    else return false;
  }
  if (!parent || typeof parent !== 'object') return false;
  const idx = Array.isArray(parent) ? (last === '-' ? parent.length : Number(last)) : NaN;
  switch (kind) {
    case 'add':
    case 'replace':
      if (Array.isArray(parent)) {
        if (!Number.isInteger(idx) || idx < 0 || idx > parent.length) return false;
        if (kind === 'add') parent.splice(idx, 0, structuredClone(value));
        else parent[idx] = structuredClone(value);
      } else {
        (parent as Record<string, unknown>)[last] = structuredClone(value);
      }
      return true;
    case 'remove':
      if (Array.isArray(parent)) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) return false;
        parent.splice(idx, 1);
      } else {
        if (!(last in (parent as Record<string, unknown>))) return false;
        delete (parent as Record<string, unknown>)[last];
      }
      return true;
    default:
      return false; // move/copy/test: outside the honest minimum, counted as skipped
  }
}

export class Store {
  /** Lanes keyed by `laneKey(source, session)`. */
  readonly sessions = new Map<string, Lane>();
  /** attention request id -> owning lane key (cross-lane inbox index). */
  private readonly attentionIndex = new Map<string, string>();
  /** applied event object -> owning lane key (navigation from raw tails). */
  private readonly keyByEvent = new WeakMap<AepEvent, string>();
  private readonly listeners = new Set<Listener>();
  private tie = 0;
  totalEvents = 0;
  /** Events with no `session` attribute (counted, not laned). */
  unlaned = 0;
  /** Change counter for the whole store: bumps on every notification. */
  version = 0;
  /** Global live tail, arrival order, capped at RECENT_CAP. */
  readonly recent: AepEvent[] = [];
  /** How many tail entries have been dropped past the cap. */
  recentDropped = 0;
  /** Arrival counts per RATE_BUCKET_MS window (keyed by window index). */
  private readonly rateBuckets = new Map<number, number>();
  /** Injectable clock so the rate series is testable. */
  now: () => number = () => Date.now();
  /** Per-lane retention bound (see LANE_CAP); injectable for tests. */
  laneCap = LANE_CAP;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(laneKey: string | null): void {
    this.version++;
    for (const fn of this.listeners) fn(laneKey);
  }

  private lane(key: string, session: string, source: LaneSource): Lane {
    let l = this.sessions.get(key);
    if (!l) {
      l = {
        key,
        session,
        source,
        status: 'active',
        events: [],
        byId: new Map(),
        runs: new Map(),
        attention: new Map(),
        lastActivity: 0,
        gap: false,
        severityCounts: {},
        control: new Map(),
        kindsSeen: new Set(),
        trimmed: 0,
        version: 0,
      };
      this.sessions.set(key, l);
    }
    return l;
  }

  /**
   * Resolve the lane an event landed in: a capture rebind (see `apply`) can
   * re-key a lane after the fact, so raw-tail consumers resolve through
   * this instead of recomputing keys.
   */
  laneKeyOf(ev: AepEvent): string | undefined {
    return this.keyByEvent.get(ev);
  }

  /**
   * All still-actionable attention items, oldest first (the inbox).
   * Imported lanes are excluded: a capture has no live backchannel, so an
   * unsettled request in it is history, never a call to action.
   */
  pendingAttention(): AttentionItem[] {
    const out: AttentionItem[] = [];
    for (const lane of this.sessions.values()) {
      if (lane.source.kind !== 'relay') continue;
      for (const item of lane.attention.values()) {
        if (item.state === 'pending' || item.state === 'responding') out.push(item);
      }
    }
    return out.sort((a, b) => String(a.request.time).localeCompare(String(b.request.time)));
  }

  /** Settled attention items (the decision history), newest first. */
  settledAttention(limit = 50): AttentionItem[] {
    const out: AttentionItem[] = [];
    for (const lane of this.sessions.values()) {
      for (const item of lane.attention.values()) {
        if (item.state !== 'pending' && item.state !== 'responding') out.push(item);
      }
    }
    return out
      .sort((a, b) => String(b.request.time).localeCompare(String(a.request.time)))
      .slice(0, limit);
  }

  /**
   * Events-per-bucket arrival series (oldest → newest, ending at the current
   * 30s window). Powers the fleet header's rate tile + sparkline.
   */
  rateSeries(buckets = 40): number[] {
    const head = Math.floor(this.now() / RATE_BUCKET_MS);
    const out: number[] = [];
    for (let i = head - buckets + 1; i <= head; i++) out.push(this.rateBuckets.get(i) ?? 0);
    return out;
  }

  /**
   * Idempotent reducer. Returns true when the event was new (state changed).
   * Consumer conformance: dedupe on id, tolerate unknown types (stored and
   * rendered generically, never dropped).
   *
   * `source` names where the event came from; lanes are keyed by
   * (source, session). An import source feeds capture-file history through
   * the same fold: the lane is offline (`source.kind === 'import'`) and
   * bulk history stays out of the live-arrival surfaces (`recent`, the rate
   * series) — those chart what this observer receives, not what it loads.
   * Rebind rule: live traffic for a session name that exists only as an
   * import-sourced lane re-keys that lane to the delivering relay (history
   * kept, ids dedupe the overlap) — yesterday's capture and today's live
   * stream are one session. A name already live on another relay blocks
   * the rebind (a capture carries no relay identity; we never guess).
   */
  apply(ev: AepEvent, opts: { source?: LaneSource } = {}): boolean {
    const source = opts.source ?? { kind: 'relay' as const, relay: '' };
    const live = source.kind === 'relay';
    if (typeof ev.id !== 'string' || typeof ev.type !== 'string') return false;
    if (ev.session === undefined) {
      this.unlaned++;
      return false;
    }
    const key = laneKey(source, ev.session);
    let lane = this.sessions.get(key);
    if (!lane && live) {
      const importKey = laneKey(IMPORT_SOURCE, ev.session);
      const imp = this.sessions.get(importKey);
      const liveElsewhere = [...this.sessions.values()].some(
        (l) => l.session === ev.session && l.source.kind === 'relay',
      );
      if (imp && !liveElsewhere) {
        // rebind: the first live claimant adopts the capture-only lane
        this.sessions.delete(importKey);
        imp.key = key;
        imp.source = source;
        this.sessions.set(key, imp);
        for (const [reqId, item] of imp.attention) {
          this.attentionIndex.set(reqId, key);
          item.laneKey = key;
        }
        for (const o of imp.events) this.keyByEvent.set(o.ev, key);
        lane = imp;
      }
    } else if (!lane && !live) {
      // merge: a capture of a session with exactly one live lane is that
      // session's history — no guessing needed below two claimants
      const liveLanes = [...this.sessions.values()].filter(
        (l) => l.session === ev.session && l.source.kind === 'relay',
      );
      if (liveLanes.length === 1) lane = liveLanes[0];
    }
    lane ??= this.lane(key, ev.session, source);
    if (lane.byId.has(ev.id)) return false;
    lane.byId.set(ev.id, ev);
    this.keyByEvent.set(ev, lane.key);
    this.totalEvents++;

    if (live) {
      this.recent.push(ev);
      if (this.recent.length > RECENT_CAP) {
        this.recent.splice(0, this.recent.length - RECENT_CAP);
        this.recentDropped++;
      }

      const bucket = Math.floor(this.now() / RATE_BUCKET_MS);
      this.rateBuckets.set(bucket, (this.rateBuckets.get(bucket) ?? 0) + 1);
      if (this.rateBuckets.size > RATE_BUCKETS_KEPT) {
        const oldest = bucket - RATE_BUCKETS_KEPT;
        for (const key of this.rateBuckets.keys()) if (key <= oldest) this.rateBuckets.delete(key);
      }
    }

    // ---- ordering: owner events sort by (epoch, seq). Foreign-emitter
    // session events (control commands, `attention.routed` — carried on the
    // session's stream without `seq`, AEP-0004) keep arrival order just above
    // the lane's current max and never reorder owner events.
    let ord: number;
    if (typeof ev.seq === 'number') {
      ord = posKey(ev);
      let i = lane.events.length;
      while (i > 0 && (lane.events[i - 1] as OrderedEvent).ord > ord) i--;
      lane.events.splice(i, 0, { ev, ord });
    } else {
      const last = lane.events[lane.events.length - 1];
      ord = (last ? last.ord : 0) + ++this.tie / 1e6;
      lane.events.push({ ev, ord });
    }

    // Per-lane bound: drop oldest, counted; dropped ids leave the dedupe
    // set so a late duplicate re-buffers rather than silently vanishing.
    if (lane.events.length > this.laneCap) {
      const overflow = lane.events.length - this.laneCap;
      for (const dropped of lane.events.splice(0, overflow)) lane.byId.delete(dropped.ev.id);
      lane.trimmed += overflow;
    }

    const t = Date.parse(String(ev.time));
    lane.lastActivity = Math.max(lane.lastActivity, Number.isNaN(t) ? Date.now() : t);

    const sev: Severity = ev.severity ?? 'info';
    lane.severityCounts[sev] = (lane.severityCounts[sev] ?? 0) + 1;
    lane.kindsSeen.add(kindFamily(ev.type));

    // ---- derivations (O(1) each) -------------------------------------------
    const data = (ev.data ?? {}) as Record<string, unknown>;
    switch (ev.type) {
      case 'session.started': {
        lane.status = 'active';
        lane.agent = ev.agent;
        if (typeof data.label === 'string') lane.label = data.label;
        break;
      }
      case 'session.ended':
        lane.status = 'ended';
        break;
      case 'run.started': {
        if (typeof ev.run === 'string') {
          lane.runs.set(ev.run, { id: ev.run, state: 'active', startedId: ev.id });
        }
        break;
      }
      case 'run.finished':
      case 'run.failed':
      case 'run.cancelled': {
        if (typeof ev.run === 'string') {
          const run = lane.runs.get(ev.run) ?? { id: ev.run, state: 'active' as RunState };
          run.state =
            ev.type === 'run.finished'
              ? 'finished'
              : ev.type === 'run.failed'
                ? 'failed'
                : 'cancelled';
          run.endedId = ev.id;
          // any terminal settles a cancel in flight (stream-only settlement)
          run.cancelling = undefined;
          run.error = undefined;
          lane.runs.set(ev.run, run);
        }
        break;
      }
      case 'attention.requested': {
        lane.attention.set(ev.id, {
          request: ev,
          session: lane.session,
          laneKey: lane.key,
          state: 'pending',
        });
        this.attentionIndex.set(ev.id, lane.key);
        break;
      }
      case 'attention.answered': {
        const item = typeof ev.subject === 'string' ? lane.attention.get(ev.subject) : undefined;
        if (item && item.state !== 'resolved' && item.state !== 'timeout') {
          item.state = 'answered';
          item.answer = data.answer;
          item.error = undefined;
        }
        break;
      }
      case 'attention.resolved': {
        const item = typeof ev.subject === 'string' ? lane.attention.get(ev.subject) : undefined;
        if (item && item.state !== 'timeout') item.state = 'resolved';
        break;
      }
      case 'attention.timeout': {
        const item = typeof ev.subject === 'string' ? lane.attention.get(ev.subject) : undefined;
        if (item && item.state !== 'resolved') item.state = 'timeout';
        break;
      }
      default:
        break; // unknown/control types: stored above, rendered generically
    }

    lane.version++;
    this.notify(lane.key);
    return true;
  }

  /**
   * Drop every lane a source owns (a removed relay: its history belongs to
   * that endpoint). Attention-index entries for dropped lanes resolve to
   * nothing afterwards, which is exactly what unanswerable means.
   */
  dropSource(source: LaneSource): void {
    let changed = false;
    for (const [key, lane] of this.sessions) {
      const match =
        source.kind === 'import'
          ? lane.source.kind === 'import'
          : lane.source.kind === 'relay' && lane.source.relay === source.relay;
      if (match) {
        this.sessions.delete(key);
        changed = true;
      }
    }
    if (changed) this.notify(null);
  }

  /** Relay comment `replay-exhausted`: history older than our position is gone. */
  markGap(session: string, opts: { source?: LaneSource } = {}): void {
    const source = opts.source ?? { kind: 'relay' as const, relay: '' };
    const key = laneKey(source, session);
    const lane = this.lane(key, session, source);
    if (!lane.gap) {
      lane.gap = true;
      lane.version++;
      this.notify(key);
    }
  }

  /**
   * Record how a control send settled (ack vs nack) for a lane — the
   * observed capability surface (see `ControlSettle`). Keyed by verb type;
   * a later settle overwrites, so the map always holds the LAST observed
   * truth (a target restarted with its gate opened flips on the next send,
   * never before — which is why UI reading this must stay advisory and
   * never remove the send path).
   */
  recordControlSettle(
    session: string,
    type: string,
    settle: { state: 'accepted' | 'refused'; reason?: string; detail?: string },
    opts: { source?: LaneSource } = {},
  ): void {
    const source = opts.source ?? { kind: 'relay' as const, relay: '' };
    const key = laneKey(source, session);
    const lane = this.lane(key, session, source);
    const entry: ControlSettle = { state: settle.state, at: this.now() };
    if (settle.reason !== undefined) entry.reason = settle.reason;
    if (settle.detail !== undefined) entry.detail = settle.detail;
    lane.control.set(type, entry);
    this.touch(key);
  }

  /**
   * Record a relay roster snapshot (AEP-0003 §4.1) onto the lanes of ITS
   * source: entries verbatim, grouped per session, one `DeclaredClaim` per
   * live claim (two claims = the ambiguous state, kept as two). Every
   * live-relay lane of this source that the roster does NOT list is set to
   * an EMPTY claim list — absence means no live route, which is exactly
   * the affordance fact. Lanes of other sources are never touched (each
   * relay answers for itself, §4.1 scope).
   */
  recordRoster(
    entries: Array<{
      session: string;
      agent?: string;
      instance?: string;
      control?: { accepts?: string[]; ack_window_ms?: number };
      emits?: string[];
    }>,
    opts: { source?: LaneSource } = {},
  ): void {
    const source = opts.source ?? { kind: 'relay' as const, relay: '' };
    const bySession = new Map<string, DeclaredClaim[]>();
    for (const e of entries) {
      if (typeof e?.session !== 'string') continue;
      const claim: DeclaredClaim = { accepts: e.control?.accepts ?? [] };
      if (e.agent !== undefined) claim.agent = e.agent;
      if (e.instance !== undefined) claim.instance = e.instance;
      if (e.control?.ack_window_ms !== undefined) claim.ackWindowMs = e.control.ack_window_ms;
      if (e.emits !== undefined) claim.emits = e.emits;
      const list = bySession.get(e.session) ?? [];
      list.push(claim);
      bySession.set(e.session, list);
    }
    const now = this.now();
    // lanes the roster names (creates none: a roster names live claims, and
    // a session the store never saw will surface through the stream itself)
    for (const [session, claims] of bySession) {
      const key = laneKey(source, session);
      const lane = this.sessions.get(key);
      if (!lane) continue;
      lane.declared = claims;
      lane.declaredAt = now;
      this.touch(key);
    }
    // lanes of this source the roster no longer names: absence = no live route
    for (const lane of this.sessions.values()) {
      if (lane.source.kind !== 'relay' || (source.kind === 'relay' && lane.source.relay !== source.relay)) continue;
      if (bySession.has(lane.session)) continue;
      lane.declared = [];
      lane.declaredAt = now;
      this.touch(lane.key);
    }
  }

  /** Optimistic inbox transition while a respond command is in flight. */
  markResponding(requestId: string): void {
    const item = this.findAttention(requestId);
    if (item && item.state === 'pending') {
      item.state = 'responding';
      item.error = undefined;
      this.touch(item.laneKey);
    }
  }

  /** Nack / ack-window timeout: back to pending with the error surfaced. */
  markRespondFailed(requestId: string, error: string): void {
    const item = this.findAttention(requestId);
    if (item && item.state === 'responding') {
      item.state = 'pending';
      item.error = error;
      this.touch(item.laneKey);
    }
  }

  /**
   * Optimistic marker while a `control.cancel` is in flight — the run
   * mirror of `markResponding`. Arms only on a still-active run; the run's
   * state itself settles only when a terminal arrives on the stream.
   */
  markRunCancelling(laneKey: string, runId: string): void {
    const run = this.sessions.get(laneKey)?.runs.get(runId);
    if (run && run.state === 'active') {
      run.cancelling = true;
      run.error = undefined;
      this.touch(laneKey);
    }
  }

  /** Nack / ack-window timeout: marker reverted, error surfaced on the run. */
  markRunCancelFailed(laneKey: string, runId: string, error: string): void {
    const run = this.sessions.get(laneKey)?.runs.get(runId);
    if (run && run.cancelling) {
      run.cancelling = undefined;
      run.error = error;
      this.touch(laneKey);
    }
  }

  findAttention(requestId: string): AttentionItem | undefined {
    const key = this.attentionIndex.get(requestId);
    return key ? this.sessions.get(key)?.attention.get(requestId) : undefined;
  }

  /** Causal graph for one lane: `cause` edges primary, `subject` secondary. */
  dag(key: string): Dag {
    const lane = this.sessions.get(key);
    if (!lane) return { nodes: [], edges: [] };
    const nodes = lane.events.map((o) => o.ev);
    const edges: DagEdge[] = [];
    for (const { ev } of lane.events) {
      if (typeof ev.cause === 'string' && lane.byId.has(ev.cause)) {
        edges.push({ from: ev.cause, to: ev.id, kind: 'cause' });
      }
      // `subject` often names a resource (e.g. a tool); only id-resolving
      // subjects are graph edges.
      if (typeof ev.subject === 'string' && ev.subject !== ev.cause && lane.byId.has(ev.subject)) {
        edges.push({ from: ev.subject, to: ev.id, kind: 'subject' });
      }
    }
    return { nodes, edges };
  }

  /**
   * Step annotation, derived from the ORDERED lane (replay-safe: buffered
   * events insert mid-array, so arrival-time tracking would lie): walking in
   * order, `run.step.started` opens a step for its run, `run.step.finished`
   * closes it after annotating itself, and every run-scoped event in between
   * carries the open step. The envelope `step` labels boundaries; `subject`
   * is the documented fallback.
   */
  stepsOf(key: string): Map<string, string> {
    const lane = this.sessions.get(key);
    const byEvent = new Map<string, string>();
    if (!lane) return byEvent;
    const open = new Map<string, string>();
    for (const { ev } of lane.events) {
      const run = typeof ev.run === 'string' ? ev.run : undefined;
      const raw = ev as unknown as Record<string, unknown>;
      const label =
        typeof raw.step === 'string' ? raw.step
        : typeof ev.subject === 'string' ? ev.subject
        : undefined;
      if (ev.type === 'run.step.started' && run && label) {
        open.set(run, label);
        byEvent.set(ev.id, label);
        continue;
      }
      if (ev.type === 'run.step.finished' && run) {
        const current = label ?? open.get(run);
        if (current) byEvent.set(ev.id, current);
        open.delete(run);
        continue;
      }
      if (run && open.has(run)) byEvent.set(ev.id, open.get(run) as string);
    }
    return byEvent;
  }

  /**
   * State reconstruction from `state.snapshot` / `state.delta` in lane
   * order. Capture honesty is the contract: a gated snapshot registers but
   * carries no value; gated patches are COUNTED (`data.ops` when present),
   * never fabricated; ops that fail against the current value are skipped
   * and counted too.
   */
  stateOf(key: string): LaneState {
    const lane = this.sessions.get(key);
    const st: LaneState = { value: undefined, hasSnapshot: false, appliedOps: 0, gatedOps: 0, skippedOps: 0, lastAt: null };
    if (!lane) return st;
    for (const { ev } of lane.events) {
      const data = (ev.data ?? {}) as Record<string, unknown>;
      if (ev.type === 'state.snapshot') {
        st.hasSnapshot = true;
        st.value = 'state' in data ? structuredClone(data.state) : undefined;
        st.gatedOps = 0; // a snapshot supersedes whatever the gated patches did
        st.skippedOps = 0;
        st.lastAt = typeof ev.time === 'string' ? ev.time : st.lastAt;
        continue;
      }
      if (ev.type !== 'state.delta') continue;
      st.lastAt = typeof ev.time === 'string' ? ev.time : st.lastAt;
      const patch = data.delta;
      if (!Array.isArray(patch)) {
        st.gatedOps += typeof data.ops === 'number' ? data.ops : 1;
        continue;
      }
      for (const op of patch) {
        if (applyPatchOp(st, op)) st.appliedOps++;
        else st.skippedOps++;
      }
    }
    return st;
  }

  private touch(laneKey: string): void {
    const lane = this.sessions.get(laneKey);
    if (lane) lane.version++;
    this.notify(laneKey);
  }
}
