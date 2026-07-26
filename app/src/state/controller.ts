// The app's single mutable root: one Store, one Connection per configured
// relay (the multi-relay model: ARCHITECTURE.md §4). Framework-free; React
// reads it through the hooks in use-store.ts.
import { Store, laneKey, type AttentionItem, type LaneSource } from '../core/store.js';
import { Connection, type ConnState } from '../core/connection.js';
import {
  loadConfig,
  saveConfig,
  positionStore,
  type RelayConfig,
  type RelayEntry,
} from './config.js';

export type AttentionAnswer = { option?: string; text?: string; values?: Record<string, unknown> };

export interface ConnectionStatus {
  state: ConnState | 'idle';
  detail?: string;
}

type Listener = () => void;

const normalize = (entry: RelayEntry): RelayEntry => ({
  ...entry,
  url: entry.url.trim().replace(/\/$/, ''),
  token: entry.token.trim(),
});

export class Controller {
  readonly store = new Store();
  /** One live connection per configured relay URL. */
  readonly connections = new Map<string, Connection>();
  config: RelayConfig = loadConfig();
  /** Per-relay connection state, keyed like `connections`. */
  readonly statuses = new Map<string, ConnectionStatus>();
  /** Change counter for connection/config state (store has its own). */
  version = 0;
  private readonly listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /**
   * Reconcile the connection set to `relays` (add / remove / re-token) and
   * persist the config. Removing a relay drops its lanes — their history
   * belongs to that endpoint — but keeps its persisted resume positions, so
   * re-adding resumes where it left off.
   */
  connect(relays: RelayEntry[]): void {
    const next = relays.map(normalize).filter((r) => r.url);
    this.config = { relays: next };
    saveConfig(this.config);
    const keep = new Set(next.map((r) => r.url));
    for (const [url, conn] of this.connections) {
      if (!keep.has(url)) {
        conn.stop();
        this.connections.delete(url);
        this.statuses.delete(url);
        this.store.dropSource({ kind: 'relay', relay: url });
      }
    }
    for (const entry of next) {
      // an unchanged URL keeps its connection; token/label edits reconnect
      const existing = this.connections.get(entry.url);
      if (existing && this.tokenOf(entry.url) === entry.token) continue;
      existing?.stop();
      this.open(entry);
    }
    this.notify();
  }

  /** Tear down and re-open one relay's connection (the retry affordance). */
  reconnect(url: string): void {
    const entry = this.config.relays.find((r) => r.url === url);
    if (!entry) return;
    this.connections.get(url)?.stop();
    this.open(entry);
    this.notify();
  }

  private readonly tokens = new Map<string, string>();

  private tokenOf(url: string): string | undefined {
    return this.tokens.get(url);
  }

  private open(entry: RelayEntry): void {
    this.tokens.set(entry.url, entry.token);
    this.statuses.set(entry.url, { state: 'connecting' });
    const connection = new Connection({
      url: entry.url,
      token: entry.token || undefined,
      store: this.store,
      positions: positionStore(entry.url),
      host: typeof location === 'undefined' ? 'headless' : location.hostname || 'browser',
      onState: (state, detail) => {
        this.statuses.set(entry.url, { state, detail });
        this.notify();
      },
    });
    this.connections.set(entry.url, connection);
    connection.start();
  }


  /**
   * The aggregate rail state: the WORST configured relay, so a dead relay
   * is never masked by a healthy one (error > connecting > live). Per-relay
   * statuses only ever carry ConnState values; `idle` is the aggregate for
   * the nothing-configured case below.
   */
  get status(): ConnectionStatus {
    if (this.statuses.size === 0) return { state: 'idle' };
    const rank: Record<string, number> = { live: 0, connecting: 2, error: 3 };
    let worst: ConnectionStatus = { state: 'live' };
    for (const s of this.statuses.values()) {
      if ((rank[s.state] ?? 0) > (rank[worst.state] ?? 0)) worst = s;
    }
    return worst;
  }

  /** Flush resume positions (wired to pagehide). */
  persist(): void {
    for (const conn of this.connections.values()) conn.persist();
  }

  /** The connection that owns an item's lane — commands route there. */
  connectionFor(item: AttentionItem): Connection | undefined {
    const lane = this.store.sessions.get(item.laneKey);
    if (!lane || lane.source.kind !== 'relay') return undefined;
    return this.connections.get(lane.source.relay);
  }

  /** An item is answerable iff its lane's relay is connected right now. */
  canRespond(item: AttentionItem): boolean {
    const lane = this.store.sessions.get(item.laneKey);
    if (!lane || lane.source.kind !== 'relay') return false;
    const status = this.statuses.get(lane.source.relay);
    return this.connections.has(lane.source.relay) && status?.state !== 'error';
  }

  /**
   * Fire-and-observe attention answer routed to the owning relay: the UI
   * never awaits the ack — rejection surfaces on the item itself
   * (store.markRespondFailed) and settlement only ever comes from the stream.
   */
  respond(item: AttentionItem, answer: AttentionAnswer): void {
    const connection = this.connectionFor(item);
    if (!connection || !this.canRespond(item)) {
      // fail fast, surfaced on the item the same way a nack would land
      this.store.markResponding(item.request.id);
      this.store.markRespondFailed(item.request.id, 'relay not connected');
      return;
    }
    void connection.respond(item, answer).catch(() => {});
  }

  /**
   * A run is cancellable iff its lane's relay is connected right now —
   * the run-scoped twin of `canRespond` (an import-sourced lane has no
   * live backchannel; a dead relay cannot carry the command).
   */
  canCancelRun(laneKey: string): boolean {
    const lane = this.store.sessions.get(laneKey);
    if (!lane || lane.source.kind !== 'relay') return false;
    const status = this.statuses.get(lane.source.relay);
    return this.connections.has(lane.source.relay) && status?.state !== 'error';
  }

  /**
   * A session is steerable through the same live-backchannel test as
   * cancel/respond, plus a known `agent` attr (the verb is derived from it).
   * Whether the target actually opted in is settled by the send itself —
   * emitter capabilities are not consumer-visible in 0.1, so a refusal
   * (the relay's sender-side `unsupported`) is the correct, honest answer,
   * surfaced where the send happened.
   */
  canInstruct(laneKey: string): boolean {
    const lane = this.store.sessions.get(laneKey);
    return this.canCancelRun(laneKey) && typeof lane?.agent === 'string' && lane.agent.length > 0;
  }

  /**
   * Send a steering instruction to the lane's session via its owning relay
   * (`x.{agent}.control.instruct`, the vendor-verb path of AEP-0004 §5).
   * Resolves on the target's ack; rejects with the nack/refusal reason.
   * Delivery is observed on the stream (`instruction.delivered`,
   * cause-linked) — the composer never claims what it has not seen.
   */
  async instruct(laneKey: string, text: string): Promise<void> {
    const lane = this.store.sessions.get(laneKey);
    if (!lane || lane.source.kind !== 'relay') throw new Error('no live backchannel');
    const connection = this.connections.get(lane.source.relay);
    if (!connection || !this.canInstruct(laneKey)) throw new Error('relay not connected');
    await connection.instruct({ session: lane.session, agent: lane.agent! }, text);
  }

  /**
   * Pause/resume share the live-backchannel test with cancel — and nothing
   * more: whether the target accepts the verbs (or is in a pausable state)
   * is settled by the send itself. The consumer cannot durably know a
   * session's paused state at the metadata capture ceiling, so no paused
   * badge is invented; the cause-linked outcome event in the Timeline is
   * the proof.
   */
  canPauseResume(laneKey: string): boolean {
    return this.canCancelRun(laneKey);
  }

  /**
   * Send `control.pause` for the lane's session (AEP-0004 §5). Resolves on
   * the ack; rejects with the nack/refusal reason — a target with nothing
   * to pause refuses, and that refusal is the correct, sovereign answer.
   */
  async pauseSession(laneKey: string): Promise<void> {
    const lane = this.store.sessions.get(laneKey);
    if (!lane || lane.source.kind !== 'relay') throw new Error('no live backchannel');
    const connection = this.connections.get(lane.source.relay);
    if (!connection || !this.canPauseResume(laneKey)) throw new Error('relay not connected');
    await connection.pauseSession(lane.session);
  }

  /**
   * Send `control.resume` for the lane's session (AEP-0004 §5). Same
   * discipline as pause; targets legitimately refuse a resume that would
   * start new work or bypass a pending confirmation.
   */
  async resumeSession(laneKey: string): Promise<void> {
    const lane = this.store.sessions.get(laneKey);
    if (!lane || lane.source.kind !== 'relay') throw new Error('no live backchannel');
    const connection = this.connections.get(lane.source.relay);
    if (!connection || !this.canPauseResume(laneKey)) throw new Error('relay not connected');
    await connection.resumeSession(lane.session);
  }

  /**
   * Fire-and-observe run cancel routed to the owning relay: optimistic
   * `cancelling` marker, rejection surfaced on the run itself, and the run's
   * state settling only when a terminal arrives on the stream. `cause` is
   * the run's `run.started` id when known (AEP-0004 §6: the Event that
   * prompted the command).
   */
  cancelRun(laneKey: string, runId: string, reason?: string): void {
    const lane = this.store.sessions.get(laneKey);
    if (!lane) return;
    const connection =
      lane.source.kind === 'relay' ? this.connections.get(lane.source.relay) : undefined;
    if (!connection || !this.canCancelRun(laneKey)) {
      // fail fast, surfaced on the run the same way a nack would land
      this.store.markRunCancelling(laneKey, runId);
      this.store.markRunCancelFailed(laneKey, runId, 'relay not connected');
      return;
    }
    const spec = {
      laneKey,
      session: lane.session,
      run: runId,
      cause: lane.runs.get(runId)?.startedId,
    };
    void connection.cancelRun(spec, reason).catch(() => {});
  }

  /** Anonymous-source lane key helper for views resolving raw sessions. */
  laneKeyFor(source: LaneSource, session: string): string {
    return laneKey(source, session);
  }
}
