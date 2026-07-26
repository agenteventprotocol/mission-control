# Architecture

> Mission Control is the first-party AEP consumer: a real-time browser UI for a
> fleet of agent sessions. This document records the design decisions the
> code implements — read it before changing how state, resume, or control
> work.

## 1. Scope guardrails

- **Pure consumer.** Mission Control speaks to agents exclusively through
  AEP — events in over the stream, commands out over control (AEP-0004). No
  side channels, no relay patches, no privileged endpoints. If the UI needs
  something the protocol cannot express, that is a protocol finding to raise
  on the [spec repository](https://github.com/agenteventprotocol/agent-event-protocol),
  not a workaround to build here.
- **The fleet-observer test is the scope court.** Features must serve
  "watch many sessions, intervene when asked." Anything session-authoring
  shaped is out of scope.

## 2. Topology: the browser is the AEP consumer

```
 agents (adapters / synthetic) ──▶ relay :8787 ◀── SSE /stream ── browser
                                        ▲                          │
                                        └────── WS /socket ────────┘
                                             (ControlClient)
 vite dev server / static host ── html·css·js only ──▶ browser
```

There is **no application server tier**. The reference relay already serves
`/stream` with permissive CORS, accepts WebSocket upgrades, and buffers
replay per `(session, epoch, seq)` — everything a browser consumer needs.
The web server only hands the browser its static assets; it never proxies
events.

Why no middle tier? It would duplicate the relay's fan-out/replay job, add
a second resume protocol, and weaken the claim the app exists to prove:
*any* consumer, including a browser tab, can join the fleet stream with the
published SDK. Trade-off accepted: a relay token (if set) is visible to the
browser. The relay is a localhost/trusted-network tool; Mission Control
inherits that posture.

## 3. Stack & shell

- **React 19 + Vite + Tailwind CSS 4**, with a small set of vendored
  shadcn-style primitives (Radix under the hood) and lucide icons.
- **One workspace, attention ambient.** The shell is a rail + content +
  attention-dock layout: pending requests are answerable from the dock on
  every screen (it auto-opens on a new request), from the inline
  quick-answer strip on the session's fleet card, and from the attention
  center — all three drive the same `Connection.respond()` and settle only
  off the stream, so every surface converges by construction. The
  product's core job — "an agent needs me" — never depends on the user
  navigating somewhere.
- **The core is framework-free.** `app/src/core/` (store + connection) has
  no DOM and no React import; the same modules run in the browser and in
  the headless test harness under Node. React reads them through
  `useSyncExternalStore` bindings (`app/src/state/use-store.ts`) that
  coalesce store notifications on `requestAnimationFrame` and subscribe at
  lane granularity in the fleet, so a busy stream costs one render per
  frame per affected card, not one per event.
- **`@aep/sdk` is consumed exactly as npm consumers will get it**: the
  pinned snapshot in `vendor/aep-sdk/` is a pnpm workspace package compiled
  to `dist/` with the SDK's own strict compiler settings (no `lib.dom` — it
  declares its own runtime surface), and the app resolves it through the
  package's regular `exports`. See `vendor/aep-sdk/VENDORED.md` for the
  sync rules and the swap-to-npm plan.

## 4. State model: one event-sourced store

`app/src/core/store.ts`. The entire UI state is a fold over the event
stream; there is no second source of truth and no out-of-band fetching.

- `Store.apply(ev, { source })` is a single idempotent reducer: dedupe on
  `id`, insert into the owning lane, update derivations, notify
  subscribers. Unknown event types are stored and rendered generically
  (consumer conformance: tolerate unknown types, never drop them).
- **Lane identity is `(source, session)`** — `source` names the delivering
  relay (by URL) or a capture import; the same session name on two relays
  is two lanes, and each configured relay gets its own `Connection` whose
  commands route back to it. A relay's identity is its normalized URL
  (trimmed, no trailing slash); the optional user-assigned label is
  display only and never re-keys anything. A capture-only lane rebinds to
  the first relay that delivers live traffic for its session name; a
  capture loaded while exactly one live lane carries the name merges into
  that lane, and with two or more live claimants the import stays its own
  lane (a capture carries no relay identity, so ownership is never
  guessed).
- **Ordering**: owner-stream events sort by `posKey = epoch·2⁴⁰ + seq` (the
  same key the relay uses). Foreign-emitter session events — control
  commands, `attention.routed`, which arrive on a session's stream without
  `seq` (AEP-0004) — get an arrival-order key just above the lane's current
  max; they never reorder owner events.
- **Derivations** (updated in `apply`, O(1) each): session status; runs
  keyed by `run`; the attention lifecycle keyed by the `attention.requested`
  event id (`pending → answered → resolved`, or `→ timeout`; the inbox is
  exactly "items still pending/responding across all lanes", and the
  decision history is the settled remainder); per-lane severity counts (the
  severity lens reads these); a capped global arrival tail (the live-tail
  view); 30-second arrival-rate buckets (the fleet vitals); and monotonic
  change counters per lane and per store (what the React bindings
  subscribe to).
- `dag(session)` builds nodes/edges on demand from `cause` (primary) and
  id-resolving `subject` (secondary) references — data only; layout and
  rendering are the view's job.
- **Views never re-derive protocol semantics.** The replay range, for
  example, only windows which already-derived events are *displayed* — it
  never re-folds state.

## 5. Resume strategy

- The SDK subscription tracks per-session `(epoch, seq)` positions and
  resumes on its internal reconnects — that covers transient drops within a
  page's lifetime.
- Across page loads the store is empty, so high-water resume would skip the
  history lanes are rebuilt from. Persisted positions (`localStorage`,
  keyed by relay URL; a JSON file in the test harness; saved debounced and
  on `pagehide`) therefore act as the **known-session set**: on start the
  connection requests `{session, epoch: 0, seq: -1}` for each — full
  bounded replay — and the idempotent reducer absorbs the overlap. "No gaps
  for any session this observer has ever seen, including events emitted
  while detached" is asserted by the end-to-end suite, not assumed.
- **Known protocol limit** (deliberately surfaced, not hidden): a session
  born *and* ended entirely while the observer was detached is unreachable —
  the protocol has no consumer-side session discovery or wildcard replay.
  The e2e suite asserts the limit holds; the session view explains it when
  a deep link points at an unknown session.
- A `replay-exhausted` relay comment means the replay buffer no longer
  reaches our position: the lane shows a **history gap** badge. We surface
  truncation, never guess.
- Store contents are not persisted: the relay's replay buffer is the
  recovery source.

## 6. Control path: the attention inbox and run cancel

- One `ControlClient` per relay connection, identity
  `{ agent: "mission-control", host: <hostname> }` — an ordinary consumer
  identity per AEP-0004 §2.2.
- Answering sends `control.attention.respond { session, run, subject:
  <request id>, cause: <request id>, data: { answer } }`; the SDK owns the
  ack window and same-id retries.
- The item state machine mirrors the wire: `pending → responding`
  (optimistic, on send) `→ answered/resolved` **only when the events arrive
  on the stream** — the ack alone never settles an item. A nack (including
  the AEP-0006 form-validation rejects) or ack-window timeout reverts the
  item to `pending` with the error shown; the request is still open on the
  emitter and can be re-answered. A request answered elsewhere (another
  consumer, another tab) settles the same way — the inbox converges by
  construction.
- Cancelling a run is the same discipline, run-scoped:
  `Controller.cancelRun(laneKey, runId, reason?)` routes
  `control.cancel { scope: "run", reason? }` (envelope `session` + `run`,
  `cause` = the run's `run.started` id when known, AEP-0004 §5–§6) over the
  lane's owning relay. `RunInfo.cancelling` is the optimistic marker — the
  run's *state* changes only when a terminal arrives on the stream
  (`run.cancelled`, or `run.finished`/`run.failed` if the run beat the
  command); a nack or ack-window silence reverts the marker with the error
  surfaced on the run. The attention actionability rule gates the
  affordance unchanged — live relay source, connected right now — and the
  command stays advisory: the agent may refuse, and `refused` is a
  first-class outcome shown to the operator, not an error to hide.

## 7. Testing: the acceptance is executable

The core is DOM-free precisely so the acceptance runs headless (`ci.sh`):

- `app/test/store.test.ts` — reducer contract: ordering, idempotence,
  lifecycle derivations, foreign-emitter events, DAG edges, severity
  counts, the live tail. Sibling suites pin the rest of the core:
  `multi-relay.test.ts` (composite lane keys, rebind/merge, config lift),
  `cancel.test.ts` (the cancelling marker's stream-only settlement +
  controller routing guards), `import.test.ts`, `lane-cap.test.ts`,
  `saved-filters.test.ts`, `notify.test.ts`, `fields.test.ts`.
- `app/test/conformance.test.ts` — **consumer-class self-certification**
  (AEP-0001 §7/§10, AEP-0003 §6–§7): the spec repo's golden corpus —
  vendored byte-identical under `app/test/fixtures/conformance/` — driven
  through the real store via the real JSONL import path, exactly what the
  standard's conformance class table asks a consumer to do. Every event
  applies (the vendor extension type, extension envelope attributes, and
  the agent-scoped sessionless event are tolerated, never dropped), a
  full-corpus duplicate replay changes nothing, all fourteen mandatory
  types derive the complete lifecycle story (three run terminals, both
  attention arcs, the form loop), foreign-emitter seq-less events keep
  arrival order, and cause edges resolve in the DAG across the control
  boundary. The class row's resume/attr-match half rides the e2e beats
  below.
- `app/test/components/` — component behavior under jsdom: inbox cards
  (options, forms, responding/error states), the capture-aware JSON tree,
  capture import, saved-filters menu, the cancel-run confirm dialog.
- `app/test/e2e.test.ts` — boots the **vendored reference-relay fixture**,
  drives it with the fixture synthetic agent (HTTP and WS modes), and
  asserts through real `Connection` + `Store` instances: (1) live events
  land laned and ordered; (2) kill-and-reattach from persisted positions
  delivers everything emitted while detached, gap-free — and the documented
  discovery limit still holds; (3) answering from the inbox completes the
  control round-trip (ack received, `attention.answered`/`resolved`
  observed on the stream, run terminal); (4) the step and state families
  derive live — posted step boundaries group run events in order, and the
  state reducer stays capture-honest.
- `app/test/e2e-multi.test.ts` — two fixture relays under one controller:
  same-name sessions stay two lanes; answers settle via the owning relay
  only; a cancel routes to the owning relay and settles off the stream
  (exactly one cause-linked `run.cancelled`, the other relay untouched);
  a killed relay flips only its own status and answerability.

## 8. Config & ports

- Dev server / preview: `:8788`. Relay default: `:8787`; URL + token are UI
  inputs persisted in `localStorage` — the page never needs rebuilding to
  point elsewhere. The e2e suite uses `:18790` (override with
  `AEP_E2E_PORT`); the two-relay suite uses `:18890`/`:18891` (override
  the base with `AEP_E2E_MULTI_PORT`).
