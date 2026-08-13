// Relay connection lifecycle: one SSE subscription feeding the store,
// persisted resume positions, and a lazy ControlClient for the attention
// inbox. DOM- and framework-free — position persistence is injected.
import { subscribe, ControlClient, NackError } from '@agenteventprotocol/sdk';
import type { Subscription, ResumePosition, AepEvent, RosterEntry } from '@agenteventprotocol/sdk';
import { steerVerb } from './steer-verbs.js';
import type { Store, AttentionItem, LaneSource } from './store.js';

export interface PositionStore {
  load(): ResumePosition[];
  save(positions: ResumePosition[]): void;
}

export type ConnState = 'connecting' | 'live' | 'error';

export interface ConnectionOptions {
  url: string;
  token?: string;
  store: Store;
  positions: PositionStore;
  /** Control-sender identity (AEP-0004 §2.2). */
  agent?: string;
  host?: string;
  onState?: (state: ConnState, detail?: string) => void;
}

const PERSIST_MS = 2000;

export class Connection {
  private sub: Subscription | null = null;
  private control: ControlClient | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSaved = '';
  private state: ConnState = 'connecting';
  private stopped = false;
  /** Discovery-document facts (AEP-0003 §3.4): which optional consumer
   * surfaces this relay ADVERTISES. Both default false — an older relay or
   * a failed fetch keeps the enumerated/no-roster paths, first-class. */
  private caps = { roster: false, replayAll: false };
  private rosterTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: ConnectionOptions) {}

  /** This connection's lane source: the relay's identity is its URL. */
  source(): LaneSource {
    return { kind: 'relay', relay: this.opts.url };
  }

  start(): void {
    this.setState('connecting');
    void this.discoverThenSubscribe();
    this.timer = setInterval(() => this.persist(), PERSIST_MS);
  }

  /**
   * Fetch the relay's discovery document (AEP-0003 §3.4) to learn which
   * optional consumer surfaces it advertises, then open the stream.
   * Cold-start rebuild: where the relay advertises `replay.all`, ONE
   * `from: 'all'` request replays every session it holds — no known-session
   * enumeration, and sessions this observer never saw arrive too. Otherwise
   * (older relays, failed fetch) the persisted positions serve as the
   * KNOWN-SESSION SET with each session's full bounded replay (seq -1), as
   * before; the idempotent reducer absorbs overlap either way. High-water
   * resume is the SDK's own reconnect behavior in both modes.
   */
  private async discoverThenSubscribe(): Promise<void> {
    const { store } = this.opts;
    try {
      const res = await fetch(`${this.opts.url.replace(/\/$/, '')}/events`, {
        headers: this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {},
      });
      if (res.ok) {
        const d = (await res.json()) as { capabilities?: { roster?: unknown; replay?: { all?: unknown } } };
        this.caps = {
          roster: typeof d?.capabilities?.roster === 'object' && d.capabilities.roster !== null,
          replayAll: d?.capabilities?.replay?.all === true,
        };
      }
    } catch {
      /* older relay / transient network: the enumerated path below works */
    }
    if (this.stopped) return;
    this.sub = subscribe({
      url: this.opts.url,
      token: this.opts.token,
      filter: {}, // fleet observer: everything
      from: this.caps.replayAll
        ? 'all'
        : this.opts.positions.load().map((p) => ({ session: p.session, epoch: 0, seq: -1 })),
      onEvent: (ev) => {
        this.setState('live');
        store.apply(ev, { source: this.source() });
        // session lifecycle changes are the moments a roster snapshot goes
        // stale (AEP-0003 §4.1 has no change-push by design) — refresh,
        // debounced, only where the relay advertises the frame
        if (ev.type === 'session.started' || ev.type === 'session.ended') {
          this.scheduleRosterRefresh();
        }
      },
      onComment: (comment) => {
        this.setState('live'); // any relay chatter proves the pipe
        const m = /^replay-exhausted (\S+) (\d+):(\d+)$/.exec(comment);
        if (m) store.markGap(m[1] as string, { source: this.source() });
      },
      onError: (err) => this.setState('error', String(err)),
    });
    this.scheduleRosterRefresh();
  }

  /** Whether this relay advertised the roster frame (AEP-0003 §4.1 rule 1). */
  rosterSupported(): boolean {
    return this.caps.roster;
  }

  /**
   * Request the relay's live-claim snapshot and record it onto this
   * source's lanes (store.recordRoster). Returns null — and never sends
   * the frame — when the relay did not advertise `capabilities.roster`
   * (an undeclared endpoint ignores the frame; §4.1 rule 1). Declared data
   * is a labeled snapshot beside the observed settles; it never gates the
   * send path.
   */
  async fetchRoster(): Promise<RosterEntry[] | null> {
    if (!this.caps.roster) return null;
    const entries = await this.controlClient().roster();
    this.opts.store.recordRoster(entries, { source: this.source() });
    return entries;
  }

  private scheduleRosterRefresh(): void {
    if (!this.caps.roster || this.stopped) return;
    if (this.rosterTimer !== null) return; // one refresh per quiet window
    this.rosterTimer = setTimeout(() => {
      this.rosterTimer = null;
      void this.fetchRoster().catch(() => {
        /* a refused/timed-out snapshot refresh is advisory data missing,
           never an error state for the stream */
      });
    }, 500);
  }

  /** Persist resume positions when they changed (also call on pagehide). */
  persist(): void {
    if (!this.sub) return;
    const positions = this.sub.positions();
    const key = JSON.stringify(positions);
    if (key !== this.lastSaved) {
      this.opts.positions.save(positions);
      this.lastSaved = key;
    }
  }

  positions(): ResumePosition[] {
    return this.sub?.positions() ?? [];
  }

  /**
   * Answer an attention request (AEP-0004): optimistic `responding`, settled
   * only by `attention.answered`/`attention.resolved` arriving on the stream.
   * Resolves once the target acked; rejects (and reverts the item) on nack or
   * ack-window exhaustion — including the AEP-0006 `values` MUST-reject nack
   * (missing required field / non-choice text without other:true), after
   * which the request is still pending on the emitter and can be re-answered.
   * `values` answers a `kind: "form"` request, keyed by field_spec.id.
   */
  async respond(
    item: AttentionItem,
    answer: { option?: string; text?: string; values?: Record<string, unknown> },
  ): Promise<AepEvent> {
    const store = this.opts.store;
    const req = item.request;
    store.markResponding(req.id);
    try {
      const spec: Parameters<ControlClient['send']>[0] = {
        type: 'control.attention.respond',
        session: item.session,
        subject: req.id,
        cause: req.id, // the request prompted this command (AEP-0004 §6)
        data: { answer },
      };
      if (typeof req.run === 'string') spec.run = req.run;
      return await this.settle(spec);
    } catch (err) {
      const detail =
        err instanceof NackError
          ? `${err.reason}${err.detail ? `: ${err.detail}` : ''}`
          : String(err);
      store.markRespondFailed(req.id, detail);
      throw err;
    }
  }

  /**
   * Cancel a run (AEP-0004 §5, scope `run`): optimistic `cancelling` marker,
   * settled only by a run terminal arriving on the stream. Resolves once the
   * target acked; rejects (and reverts the marker with the error surfaced on
   * the run) on nack or ack-window exhaustion. The command is advisory — the
   * agent stays sovereign and may refuse. A `reason` rides at the `redacted`
   * capture per the payload's gating.
   */
  async cancelRun(
    spec: { laneKey: string; session: string; run: string; cause?: string },
    reason?: string,
  ): Promise<AepEvent> {
    const store = this.opts.store;
    store.markRunCancelling(spec.laneKey, spec.run);
    try {
      const cmd: Parameters<ControlClient['send']>[0] = {
        type: 'control.cancel',
        session: spec.session,
        run: spec.run,
        data: { scope: 'run', ...(reason ? { reason } : {}) },
      };
      if (reason) cmd.capture = 'redacted';
      if (spec.cause !== undefined) cmd.cause = spec.cause;
      return await this.settle(cmd);
    } catch (err) {
      const detail =
        err instanceof NackError
          ? `${err.reason}${err.detail ? `: ${err.detail}` : ''}`
          : String(err);
      store.markRunCancelFailed(spec.laneKey, spec.run, detail);
      throw err;
    }
  }

  /**
   * Steer a session (the vendor-scoped verb path of AEP-0004 §5): the verb
   * profile is derived from the lane's `agent` attr (`steerVerb`) — the
   * convergent adapters share `x.{agent}.control.instruct` `{ text }`, and
   * Cline's user-plane `x.cline.control.send_input` is the one declared
   * divergence (see core/steer-verbs.ts). Discovery is send-and-settle
   * (emitter capabilities are not consumer-visible in 0.1): a target that
   * never opted in earns the relay's sender-side `unsupported` refusal,
   * surfaced right where the send happened — the same sovereign-answer
   * discipline as cancel. Resolves on the ack; the outcome lands later as a
   * cause-linked event on the stream. Text rides at `redacted` capture.
   */
  async instruct(spec: { session: string; agent: string }, text: string): Promise<AepEvent> {
    const verb = steerVerb(spec.agent);
    return await this.settle({
      type: verb.type,
      session: spec.session,
      capture: 'redacted',
      data: verb.data(text),
    });
  }

  /**
   * Pause a session (AEP-0004 §5 `control.pause`, payload `{}`): resolves on
   * the target's ack; rejects with the nack/refusal reason. The pause is
   * real only when the target's vendor-defined pause state lands as a
   * cause-linked outcome event on the stream — the consumer never claims
   * what it has not seen. Discovery is send-and-settle like cancel/steer.
   */
  async pauseSession(session: string): Promise<AepEvent> {
    return await this.settle({ type: 'control.pause', session, data: {} });
  }

  /**
   * Resume a session (AEP-0004 §5 `control.resume`, payload `{}`): same ack
   * and settlement discipline as pause. A refusal is a first-class answer —
   * targets legitimately refuse a resume that would start new work or
   * bypass a pending confirmation.
   */
  async resumeSession(session: string): Promise<AepEvent> {
    return await this.settle({ type: 'control.resume', session, data: {} });
  }

  /**
   * Send a control command and record how it settled on the lane's observed
   * control map (store.recordControlSettle) — accepted on ack, the nack
   * reason on refusal. Transport errors teach nothing about the target's
   * capability and are rethrown unrecorded. Every control send funnels
   * through here so the observed surface never misses a settle.
   */
  private async settle(spec: Parameters<ControlClient['send']>[0]): Promise<AepEvent> {
    const store = this.opts.store;
    try {
      const ev = await this.controlClient().send(spec);
      store.recordControlSettle(spec.session, spec.type, { state: 'accepted' }, { source: this.source() });
      return ev;
    } catch (err) {
      if (err instanceof NackError) {
        const settle: { state: 'refused'; reason?: string; detail?: string } = {
          state: 'refused',
          reason: err.reason,
        };
        if (err.detail !== undefined) settle.detail = err.detail;
        store.recordControlSettle(spec.session, spec.type, settle, { source: this.source() });
      }
      throw err;
    }
  }

  private controlClient(): ControlClient {
    if (!this.control) {
      this.control = new ControlClient({
        url: this.opts.url,
        token: this.opts.token,
        agent: this.opts.agent ?? 'mission-control',
        host: this.opts.host ?? 'browser',
        onError: () => {
          /* surfaced per-send via NackError timeouts */
        },
      });
    }
    return this.control;
  }

  private setState(state: ConnState, detail?: string): void {
    if (state !== this.state) {
      this.state = state;
      this.opts.onState?.(state, detail);
    } else if (state === 'error' && detail) {
      this.opts.onState?.(state, detail);
    }
  }

  stop(): void {
    this.stopped = true;
    this.persist();
    if (this.timer !== null) clearInterval(this.timer);
    if (this.rosterTimer !== null) { clearTimeout(this.rosterTimer); this.rosterTimer = null; }
    this.sub?.close();
    this.control?.close();
    this.sub = null;
    this.control = null;
  }
}
