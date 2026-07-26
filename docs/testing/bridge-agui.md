# Guided session — AG-UI

Observes an AG-UI agent through the reference bridge
(`reference/impl/bridge-agui/`) — a forwarding tee sitting between an
AG-UI client (the UI) and the agent. **Fixture-proven, live validation
pending.**

**Respond from Mission Control: no** — read-only channel. The bridge
never initiates runs, answers nothing, and accepts no commands.

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and an AG-UI agent server plus its client UI.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the bridge, pointed at the real AG-UI agent
AEP_TOKEN=<token> AEP_AGUI_UPSTREAM=http://127.0.0.1:8000 \
  node impl/bridge-agui/receiver.js &

# 3 — point the AG-UI client (the UI) at the bridge instead of the agent
```

The bridge listens on `127.0.0.1:4321` by default (`AEP_AGUI_PORT`
changes it) and forwards every run `POST` verbatim to
`AEP_AGUI_UPSTREAM`, streaming the response back untouched while
teeing every event onto the relay. Check
`GET http://127.0.0.1:4321/healthz` → `{ ok, relay, source }`: `relay`
is the WS binding to the AEP relay; `source` probes the upstream
lazily (a proxy holds no standing upstream connection).

Useful knobs: `AEP_AGUI_DELTAS` (default off — token/argument deltas
suppressed; set to opt the streaming plane in at `debug`),
`AEP_AGENT_NAME` (default `agui` — a proxy cannot know the agent's
real name; rename if you want the Fleet lane labeled differently),
plus the standard `AEP_RELAY` / `AEP_TOKEN` / `AEP_CAPTURE` /
`AEP_LOG_DIR`.

## The guided script

Work in a scratch directory driving the AG-UI client against the
bridged endpoint. Find your lane in Fleet by agent name: **agui** (or
whatever `AEP_AGENT_NAME` you set).

### 1 — Lifecycle

- [ ] Start a session in the AG-UI client and submit a run.
  **Expect:** an `agui` lane appears in Fleet (`session.started` — the
  wire `threadId` rides verbatim as the AEP session, zero synthesis).
  The run opens `run.started` (`runId` → run, same real-identity
  rule).
- [ ] Let the run finish.
  **Expect:** `run.finished` closes the run, cause-linked to the
  start.

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless.
  **Expect:** `tool.requested` → `tool.completed` pairs in the session
  Timeline, `cause`-linked. `STEP_*` events stamp the envelope `step`
  — open the session detail **State** tab to watch the step
  reconstruction.
- [ ] Make a tool fail, or note if the pairing under test does not
  expose a failure path.
  **Expect:** the failure rides through the same tool-result path the
  vendor uses; at `AEP_CAPTURE=redacted` the assembled tool result
  content is visible in the Inspector.

### 3 — Attention: observe the vendor-side decision

- [ ] Trigger whatever approval or input moment the AG-UI agent under
  test exposes, if any.
  **Expect:** this channel is read-only by construction — the bridge
  answers nothing and accepts no commands, so there is no
  `attention.requested`/respond path to exercise here regardless of
  what the agent itself supports. If the agent has its own in-UI
  approval step, answer it in the **client**, not Mission Control, and
  record whatever the wire shows for it.
- [ ] Watch for the reply terminal.
  **Expect:** `x.agui.text_message.end` marks the assembled reply —
  the core `message.agent.replied` type stays reserved on this
  channel. `REASONING_ENCRYPTED_VALUE`, if the agent emits it, maps to
  nothing, ever.

### 4 — Cancel

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:`
  nack — the bridge advertises no control capabilities, so the relay
  nacks `control.cancel` on its behalf. This is the correct sovereign
  result, not a bug.
- [ ] Cancel the run in the **UI** or stop the agent process instead,
  and **record what lands** — there is no cancel mapping documented
  for this channel, so whatever terminal (or lack of one) you observe
  is exactly the kind of fact these sessions exist to pin down.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in the AG-UI
  client. Reopen the tab.
  **Expect:** the lane rebuilds from the persisted
  `(session, epoch, seq)` positions with no gaps — the events emitted
  while you were away are there.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back
  and follows.

Extra credit: set `AEP_AGUI_DELTAS=1` and watch the streaming
token/argument deltas ride at `debug` — flip the severity lens to see
them alongside the terminal events.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle |  |  |
| 2 | Tool trio |  |  |
| 3 | Attention: observed vendor-side decision (if any) |  |  |
| 4 | Cancel: nack, vendor-side stop |  |  |
| 5 | Replay / resume |  |  |

## Reset & re-run

Ctrl-C the bridge and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The bridge's
per-thread JSONL logs live under `~/.aep/logs/agui/` — keep them; they
are the capture evidence for anything you file. Point the AG-UI client
back at the real agent endpoint to detach entirely. Mission Control's
saved positions live in the browser's `localStorage` per relay URL; a
fresh browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh assistant session to help a tester bring up
the bridge and drive the script — this assistant is a **helper**, not
the agent under observation (the AG-UI agent behind the bridge is
observed):

```text
You are helping a tester run a guided live session against the AEP
AG-UI bridge. You are not the agent being observed — a separate AG-UI
agent and its client UI are the subject; you are assisting from
outside.

Walk the tester through these steps, one at a time, confirming each
before moving on:

1. Confirm a relay is running with a token and Mission Control is
   connected to it (the testing index's shared setup).
2. Help the tester start the bridge with AEP_TOKEN and
   AEP_AGUI_UPSTREAM pointed at their real AG-UI agent server, then
   point their AG-UI client at the bridge's address (127.0.0.1:4321 by
   default) instead of the agent directly.
3. Have the tester confirm GET http://127.0.0.1:4321/healthz reports
   relay:true before proceeding.
4. Have the tester start a session in the client and submit a run.
   Confirm an "agui" lane appears in Fleet with real thread/run ids
   (no synthesized identifiers).
5. Have the tester ask for a tool-shaped action and watch the
   tool.requested/tool.completed pair land, and check the session
   detail State tab for the STEP_* reconstruction.
6. Explain to the tester that this channel is read-only: Mission
   Control cannot answer anything here. If the agent has its own
   approval step, have the tester answer it in the client and note
   what the wire shows.
7. Have the tester press Cancel run in Mission Control and confirm the
   inline "cancel failed:" nack, then stop the run from the client or
   agent side instead and note exactly what lands on the stream.
8. Have the tester close and reopen the Mission Control tab after
   generating one more event, confirming a gap-free rebuild, then try
   the replay slider and Back to live.
9. Help the tester fill in the guide's results table with what
   actually happened, flagging any mismatch from the guide's expect
   lines — mismatches are the point of the session.

Be precise about ports, env vars, and file paths; if something in the
guide does not match what you observe, say so plainly rather than
smoothing it over.
```
