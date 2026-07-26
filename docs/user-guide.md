# User guide

Mission Control is a browser UI for watching a fleet of agent sessions and
responding to attention requests as they come in. It has no server tier of
its own for events — the browser is an ordinary AEP consumer, connecting
straight to a relay. Design rationale: [ARCHITECTURE.md](../ARCHITECTURE.md).
A tour of the views: [views.md](views.md).

## Prerequisites

- Node ≥ 22 and [pnpm](https://pnpm.io) (`corepack enable` turns it on).
- A relay to watch — normally the reference relay from
  [`agenteventprotocol/reference`](https://github.com/agenteventprotocol/reference).

## Install, run

```sh
pnpm install
pnpm dev             # http://127.0.0.1:8788
```

`pnpm dev` first compiles the vendored `@aep/sdk` (see
[`../vendor/aep-sdk/VENDORED.md`](../vendor/aep-sdk/VENDORED.md)), then
serves the app. For a production bundle: `pnpm build`, then `pnpm preview`
(or host `app/dist/` on any static server — nothing here proxies events).

## Point it at a relay — or several

Open the settings (the gear at the foot of the left rail), enter the
relay's URL and its token, then Connect (a token is required whenever you
want to *answer* or *cancel*, not just watch: control flows only on
authenticated bindings, AEP-0004 §4.1 — a tokenless relay refuses commands
with `unauthorized`). Everything
is persisted in the browser's `localStorage`, so reopening the tab
reconnects without retyping. The default is `http://127.0.0.1:8787`, which
matches the reference relay's default port.

**Add relay** in the same dialog watches more than one relay from this one
window (an optional label names it). With several relays configured, lanes
and inbox cards carry a chip naming their relay, the fleet filter bar gains
a relay filter, and answering a request always goes back over the relay
that owns that session. Removing a relay drops its lanes; its saved resume
positions survive, so re-adding it later picks up where it left off.

The dots above the gear are the connection state, one per relay: green
(breathing) = live events are flowing, amber = connecting, red = error
(hover for the relay name and detail). A session that exists only in an
opened capture shows `imported` instead of a relay chip — it has no live
relay behind it.

## Run the synthetic demo

The fastest way to see everything work end to end:

```sh
git clone https://github.com/agenteventprotocol/reference.git
cd reference && (cd impl/relay && npm ci)

# terminal 1 — the reference relay
node impl/relay/server.js

# terminal 2 — a small fleet, one agent asking for permission
node impl/demo/synthetic-agent.js --agent claude-sim --tools 3
node impl/demo/synthetic-agent.js --agent codex-sim --mode http
node impl/demo/synthetic-agent.js --agent gate-sim --attention
```

Open `http://127.0.0.1:8788`:

1. **Lanes fill live.** Each agent gets a card; chips appear as events
   arrive and the vitals strip counts along.
2. **The request comes to you.** `gate-sim` raises a permission request:
   the attention dock slides in with the question, the same card grows an
   inline **Allow / Deny** strip, the rail bell and the browser-tab title
   count it. Tap **Allow** anywhere — the item shows *responding* until
   `attention.answered` and `attention.resolved` arrive on the stream,
   then every surface clears at once and the run finishes in the lane.
   The Attention view keeps the decision in its history.
3. **Replay it.** Open the session and drag *both ends* of the replay
   range to isolate the permission exchange in the timeline and the
   causal graph; **Back to live** snaps to the tail.
4. **Resume works.** Close the tab, emit more events, reopen: lanes rebuild
   from the persisted `(session, epoch, seq)` positions with no gaps.

## Opening captures

Any JSONL capture — one AEP event per line, the shape the reference stack's
durable sink (`aep sink --out DIR`) writes — opens offline: **Open
capture…** in the Fleet header, or drag the files onto the Fleet view.
Imported sessions appear as normal lanes flagged with an `imported` badge,
and the whole inspection toolkit works on them: timeline, dual-ended
replay range, causal graph, capture-aware inspector.

What is intentionally different offline:

- **Attention is history, not a call to action.** A capture has no live
  backchannel, so requests in it never enter the inbox or the dock, and no
  respond controls render — an unsettled request reads as the state
  the capture last saw. If live traffic later arrives for the same session,
  the lane flips back to live and pending items become actionable again.
- **The live surfaces stay honest.** Imported history does not enter the
  live tail or the events-per-minute series — those chart what this
  observer receives over the stream, not what it loads from disk.
- **Torn final lines are skipped and counted.** A capture whose writer was
  killed mid-line imports cleanly; the summary reports the skipped line.
- **Resume is untouched.** Importing never changes the connection's
  persisted `(session, epoch, seq)` positions.

## Cancelling a run

Active runs can be cancelled from two places: the session header's
**Cancel run** button, and a compact stop button that appears on a fleet
card's run row when you hover a card with a run in flight. Both open the
same confirm dialog — cancelling is destructive, so nothing is sent until
you confirm — with an optional reason that is carried to the agent.

What happens next is honest about the protocol:

- The button flips to **cancelling…** while the `control.cancel` command
  awaits its acknowledgement on the owning relay.
- The run's ribbon segment turns *cancelled* **only when the cause-linked
  `run.cancelled` event arrives on the stream** — never optimistically. If
  the run finishes on its own first, that terminal wins; the marker clears
  either way.
- A rejection (the agent is sovereign and may refuse) or silence past the
  ack window reverts the button with the reason shown next to it — the run
  is still active and you can try again.
- Imported captures and lanes whose relay is disconnected show the button
  disabled with the reason: there is no live backchannel to carry the
  command.

## Saved filters and desktop notifications

- **Saved filters** — the Fleet filter bar's **Saved** menu keeps named
  filter compositions (query, status, severity lens, sort, needs-attention)
  in this browser's storage: save the current composition under a name,
  apply one in a click, delete stale sets. No sync, no export.
- **Desktop notifications** — off by default. The bell toggle at the foot
  of the rail opts in (the browser's permission prompt comes from that
  click and nowhere else). When on, a **hidden** tab fires one desktop
  notification per new pending attention request — who is asking, first
  line of the prompt — and clicking it focuses the tab and opens the dock.
  A visible tab never notifies: the dock already announces there.

## Reading what you see

- **Severity is always labeled** — dots and colored bars carry a label or
  hover text; the severity lens (in the Fleet and Events filter bars) dims
  events below the chosen floor and can hide lanes that never reach it.
- **`history gap`** on a lane means the relay's replay buffer no longer
  reaches this observer's position: older history is *gone*, and Mission
  Control says so rather than guessing.
- **A session you never saw** — if a session started *and* ended while no
  observer was attached, it cannot be recovered: the protocol has no
  consumer-side session discovery (a deliberate, documented limit).
- **The inspector's capture badge** tells you how much payload content the
  emitter was allowed to ship (`none`/`metadata`/`redacted`/`full`);
  `*_digest` fields and `[REDACTED …]` stand-ins are highlighted so
  withheld content is visually distinct from captured content.

## Verify your checkout

```sh
pnpm run check
```

Runs exactly what CI runs — typechecks, lint, unit + component tests, the
headless four-beat end-to-end acceptance against the vendored relay
fixture, and the production build. Green means your checkout behaves.
