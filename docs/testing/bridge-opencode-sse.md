# Guided session — OpenCode over SSE

Observes a running OpenCode server through the reference bridge
(`reference/impl/bridge-opencode-sse/`) — zero-install observation
over the server's own event stream, no plugin file needed. Cross-link:
the [OpenCode](opencode.md) guide covers the plugin adapter this
bridge can either complement or replace. **Fixture-proven (control leg
smoke-proven), live validation pending.**

**Respond from Mission Control: opt-in** — observation-only is the
DEFAULT posture (nothing can answer through the stream itself), and
`AEP_OPENCODE_SSE_CONTROL=1` in `--primary` mode pairs the stream with
exactly two REST writes: the permission reply and a run-scoped cancel
(beat 6). Companion mode is read-only always.

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and a running OpenCode server (`opencode serve`).
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the bridge, attaching to the OpenCode server's SSE stream
AEP_TOKEN=<token> node impl/bridge-opencode-sse/receiver.js &            # companion (default)
AEP_TOKEN=<token> node impl/bridge-opencode-sse/receiver.js --primary &  # SSE-only
```

The bridge attaches to `GET /event` (server-sent events) on
`AEP_OPENCODE_URL` (default `http://127.0.0.1:4096`) — no plugin file,
no install inside the agent. Check
`GET http://127.0.0.1:4320/healthz` → `{ ok, relay, source }`
(`AEP_SSE_IN_PORT` changes the port): `relay` is the WS binding to the
AEP relay, `source` is the SSE attachment to the OpenCode server —
both reconnect on whichever of error/close fires first.

Two modes, chosen at startup:

- **companion** (default) — if the [OpenCode plugin
  adapter](opencode.md) is also observing this agent, it remains the
  **sole core-type authority**: this bridge emits only the
  channel-visible `x.opencode.*` family, zero core types. Run this
  guide's beats in the **same session** the plugin adapter is
  watching to see the extra channel-visibility rows land alongside
  the core-type lane it already produces (flip the severity lens to
  `debug` to see them).
- **`--primary`** — an SSE-only deployment with no plugin installed:
  the full bus mapping applies, including core lifecycle and run
  synthesis.

For beat 6 only, restart the primary bridge with the control gate:

```sh
AEP_TOKEN=<token> AEP_OPENCODE_SSE_CONTROL=1 \
  node impl/bridge-opencode-sse/receiver.js --primary &
```

`/healthz` gains `control: true` exactly when the gate is honored
(set AND primary — companion ignores it).

## The guided script

Work in a scratch directory against the OpenCode server. Find your
lane in Fleet by agent name: **opencode**.

### 1 — Lifecycle

- [ ] Start a session against the OpenCode server and submit a
  prompt.
  **Expect (primary):** an `opencode` lane appears in Fleet
  (`session.started`), and the prompt opens a run (`run.started`,
  synthesized on the user-message boundary). **Expect (companion):**
  no new lane from this bridge alone — the plugin adapter's lane
  gains extra `x.opencode.*` rows at `debug`; this bridge contributes
  no core types here by design.
- [ ] Let the turn finish (or go idle).
  **Expect (primary):** `run.finished`, synthesized on the
  session-idle boundary.

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless.
  **Expect (primary):** `tool.requested` → `tool.completed` pairs,
  `cause`-linked. **Expect (companion):** the equivalent
  `x.opencode.*` channel rows alongside whatever the plugin adapter
  already emits for the same action.
- [ ] Make a tool fail.
  **Expect:** there is no `tool.failed` from this surface family —
  OpenCode failures ride `x.opencode.session.error` in both modes
  (the same honest ceiling as the plugin adapter). Open the Inspector
  on that event and record the failure shape instead of expecting a
  typed `tool.failed`.

### 3 — Attention: observe the vendor-side decision (primary mode only)

- [ ] In `--primary` mode **without the control gate** (the default
  posture), trigger a permission moment (an action OpenCode holds for
  approval).
  **Expect:** `permission.updated` maps to `attention.requested` with
  **no options and no `respond_via`** — nothing can answer through
  the stream, and by default the bridge never calls OpenCode's REST
  permission actuator (the opt-in leg in beat 6 is what changes
  that). Answer the prompt wherever the OpenCode client under test
  exposes it (not Mission Control) and record what the wire shows for
  the outcome.
- [ ] In companion mode, skip this beat and mark it n.a. — the plugin
  adapter (see [opencode.md](opencode.md)) is the one with the
  respond-capable hold-open loop; this bridge stays silent on core
  attention types.

### 4 — Cancel (default posture)

- [ ] With a run visible and the control gate **off**, press
  **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:`
  nack — gated off this bridge declares no control capabilities, so
  the relay nacks `control.cancel` on its behalf. This is the correct
  sovereign result, not a bug (the gated-on cancel is beat 6).
- [ ] Stop the session from the OpenCode client or server side
  instead, and **record what lands** — with no command in flight
  there is no cancel mapping on this channel.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Generate one more event against
  the OpenCode server. Reopen the tab.
  **Expect:** the lane rebuilds from the persisted
  `(session, epoch, seq)` positions with no gaps.
- [ ] Also stop and restart the OpenCode server (or just the bridge
  process) mid-session, then let the bridge reattach.
  **Expect:** the SSE source reconnects on the bridge's own
  reconnect logic — watch the `source` field in `/healthz` flip and
  recover, and confirm events resume without a duplicate burst.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back
  and follows.

### 6 — Control (opt-in, primary mode only)

Restart the primary bridge with `AEP_OPENCODE_SSE_CONTROL=1` (see the
bring-up section) and confirm `/healthz` shows `control: true`. No
Mission Control change is needed for any of this — the same answer
card and Cancel-run button drive it.

- [ ] Trigger a permission moment.
  **Expect:** the attention card now carries the vendor's own three
  options — **Allow once / Always allow / Reject** — because the
  request arrived with `options` and `respond_via: ["control"]`.
- [ ] Answer with one of the options.
  **Expect:** the send settles (ack), OpenCode itself proceeds per
  your answer, and the Timeline shows `attention.answered`
  (`via: "control"`, `cause`-linked to your command) followed by
  `attention.resolved` — the outcome rides the vendor's own
  `permission.replied` broadcast, not the bridge's REST 200.
- [ ] Try the free-text reply on the card instead of an option.
  **Expect:** an inline `invalid` refusal — nothing on this surface
  carries free text to OpenCode. The refusal is the sovereign answer,
  not a bug.
- [ ] With a run active, press **Cancel run**.
  **Expect:** the confirm dialog, an accepted send, and the run
  closing as `run.cancelled` (`cause`-linked to your command) when
  OpenCode's own idle boundary lands — the vendor aborts the
  in-flight work (`POST /session/{id}/abort`). The next prompt opens
  a fresh run normally.
- [ ] Press **Cancel run** again while the session is idle (no run).
  **Expect:** an inline `refused` nack — aborting an idle session
  would report a cancellation that never happened.
- [ ] Answer a permission from the OpenCode client itself while the
  gate is on.
  **Expect:** plain `attention.resolved` with **no**
  `attention.answered` — a vendor-side decision keeps the plain path;
  only command-driven answers ride `via: "control"`.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle (mode noted) |  |  |
| 2 | Tool trio (no tool.failed — x.opencode.session.error) |  |  |
| 3 | Attention: observed decision (primary) or n.a. (companion) |  |  |
| 4 | Cancel: nack, vendor-side stop |  |  |
| 5 | Replay / resume incl. source reconnect |  |  |
| 6 | Control opt-in: answered permission, text refusal, commanded cancel, idle refusal, vendor-side plain path |  |  |

## Reset & re-run

Ctrl-C the bridge and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The bridge's
per-session JSONL logs live under
`~/.aep/logs/opencode-sse-<mode>/` — keep them; they are the capture
evidence for anything you file. Stop the bridge process to detach
entirely; the OpenCode server itself needs no cleanup since the
attach is zero-install. Mission Control's saved positions live in the
browser's `localStorage` per relay URL; a fresh browser profile is a
clean observer.

## Session prompt for an assistant

Paste this into a fresh assistant session to help a tester bring up
the bridge and drive the script — this assistant is a **helper**, not
the agent under observation (the OpenCode server session is
observed):

```text
You are helping a tester run a guided live session against the AEP
OpenCode-over-SSE bridge. You are not the agent being observed — a
separate OpenCode server session is the subject; you are assisting
from outside.

Walk the tester through these steps, one at a time, confirming each
before moving on:

1. Confirm a relay is running with a token and Mission Control is
   connected to it (the testing index's shared setup).
2. Ask the tester whether the OpenCode plugin adapter from
   opencode.md is also running against this same server. If yes, run
   the bridge in companion mode (default); if no, run it with
   --primary. Note which mode you're using.
3. Help the tester start the bridge and confirm
   GET http://127.0.0.1:4320/healthz reports relay:true and
   source:true (the SSE attachment to the OpenCode server).
4. Have the tester start (or use an existing) session against the
   OpenCode server and submit a prompt. In primary mode, confirm an
   "opencode" lane appears in Fleet; in companion mode, confirm the
   plugin adapter's existing lane gains extra x.opencode.* rows at the
   debug severity lens instead.
5. Have the tester ask for a tool-shaped action, then one that fails.
   Confirm there is no typed tool.failed — failures ride
   x.opencode.session.error in both modes.
6. In primary mode only, with the control gate OFF (the default),
   have the tester trigger a permission moment and answer it wherever
   the OpenCode client exposes it (not Mission Control — the default
   posture has no respond path). In companion mode, mark this beat
   n.a.
7. Have the tester press Cancel run in Mission Control with the gate
   OFF and confirm the inline "cancel failed:" nack (the correct
   sovereign result), then stop the session from the OpenCode side
   instead and note what lands.
8. Have the tester close and reopen the Mission Control tab after
   generating one more event, confirming a gap-free rebuild. Then have
   them restart the OpenCode server or the bridge process itself and
   confirm the source reconnects cleanly with no duplicate burst. Then
   try the replay slider and Back to live.
9. Restart the primary bridge with AEP_OPENCODE_SSE_CONTROL=1 and
   confirm /healthz gains control:true. Then, in order: answer a
   permission from the Mission Control card (expect the three vendor
   options Allow once / Always allow / Reject; the Timeline shows
   attention.answered via control cause-linked to the command, then
   attention.resolved); try the free-text reply (expect an inline
   invalid refusal — collect it as an expectation, not a failure);
   cancel an active run (expect run.cancelled cause-linked when
   OpenCode's own idle boundary lands, and a clean new run
   afterwards); cancel again while idle (expect refused); and answer
   one permission from the OpenCode client itself (expect the plain
   attention.resolved with no answered beat).
10. Help the tester fill in the guide's results table with what
    actually happened, flagging any mismatch from the guide's expect
    lines — mismatches are the point of the session.

Be precise about ports, env vars, and file paths; if something in the
guide does not match what you observe, say so plainly rather than
smoothing it over.
```
