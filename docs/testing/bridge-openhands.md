# Guided session — OpenHands

Observes a running OpenHands agent server through the reference bridge
(`reference/impl/bridge-openhands/`) — it attaches to the vendor's own
multi-observer events WebSocket rather than tee-ing anything.
**Fixture-proven, live validation pending.**

**Respond from Mission Control: opt-in** — never-send is the DEFAULT
posture (the bridge answers nothing and accepts no commands; the
approval loop is observed read-only). `AEP_OPENHANDS_CONTROL=1` (beat
6) declares the answerable approval loop plus `control.pause` /
`control.resume` — the first real pause/resume target in the fleet —
plus the two vendor verbs: `x.openhands.control.send_input` (the
composer's **Send input**: an appended user message, never a run
trigger) and `x.openhands.control.interrupt` (the escalated pause —
instant, resumable; sent via API, no dedicated button).
`control.cancel` stays refused by design: no vendor write terminates a
run.

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and a running OpenHands agent server with a session API key minted
  for observation.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the bridge
AEP_TOKEN=<token> AEP_OPENHANDS_KEY=<session api key> \
  node impl/bridge-openhands/receiver.js &
```

The bridge discovers conversations by polling
`GET /api/conversations/search` (`AEP_OPENHANDS_POLL`, default 15 s)
and attaches to the vendor's own events WebSocket
`/sockets/events/{conversation_id}` per conversation it finds — up to
50 observers per conversation, with replay on connect.
`AEP_OPENHANDS_URL` defaults to `http://127.0.0.1:8000`. Check
`GET http://127.0.0.1:8397/healthz` → `{ ok, relay, source }`
(`AEP_OPENHANDS_PORT` changes the port): `relay` is the WS binding to
the AEP relay, `source` is discovery reachability.

**The never-send posture, stated prominently:** the events socket is
read-write, and a session API key carries no read-only scope — any
key that can observe a conversation can also drive it. Observe-only is
therefore a bridge *posture*, not a protocol guarantee: the
**first-message auth frame is the only frame the bridge ever
writes**; `respond_to_confirmation` is never called; it advertises
`control: { accepts: [] }`. **Security note:** an agent server with no
session API keys configured is unsecured by the vendor's own defaults
— mint a dedicated key for this bridge rather than reusing one with
broader scope.

Useful knobs: `AEP_OPENHANDS_DELTAS=1` (opt streaming deltas in at
`debug` — the vendor does not persist them, so replay after a
reconnect legitimately lacks them), `AEP_AGENT_NAME` (default
`openhands`), plus the standard `AEP_RELAY` / `AEP_TOKEN` /
`AEP_CAPTURE` / `AEP_CAPTURE_ATTENTION` / `AEP_LOG_DIR`.

**The control opt-in (beat 6 only):** `AEP_OPENHANDS_CONTROL=1`
declares `control.attention.respond` + `control.pause` +
`control.resume` + `x.openhands.control.send_input` +
`x.openhands.control.interrupt` and inverts never-send for exactly
five REST writes (`respond_to_confirmation`, `POST /pause`,
`POST /run`, `POST …/events` with the run flag pinned false,
`POST /interrupt`); healthz then reports `control: true`. Leave it OFF
for beats 1–5 — the default posture is part of what they verify.

## The guided script

Work in the OpenHands UI (or API) against a conversation the bridge
can discover. Find your lane in Fleet by agent name: **openhands** (or
whatever `AEP_AGENT_NAME` you set).

### 1 — Lifecycle

- [ ] Start a new conversation in OpenHands and let the bridge's next
  poll pick it up (up to `AEP_OPENHANDS_POLL` seconds).
  **Expect:** an `openhands` lane appears in Fleet (`session.started`
  — `conversation_id` is the AEP session). The socket attach itself
  triggers replay if the conversation already has history.
- [ ] Send a prompt and let the agent work.
  **Expect:** `execution_status` facts synthesize the run boundary
  (`run.started`); an `llm_response_id` stamps a step with no
  `run.step.*` synthesized on top of it — this bridge doesn't invent
  step ribbons, it stamps what it's given.
- [ ] Let the turn settle.
  **Expect:** `run.finished` when `is_terminal` closes the execution
  status, including an honest idle close if the conversation goes
  quiet rather than an explicit terminal.

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless.
  **Expect:** `tool.requested` → `tool.completed` pairs in the session
  Timeline, `cause`-linked, with an `is_error` split on the vendor
  action-observation events.
- [ ] Make a tool fail.
  **Expect:** `tool.failed` from the same `is_error` split.

### 3 — Attention: observe the vendor-side decision (default posture)

- [ ] Trigger a confirmation gate (an action OpenHands holds for
  approval under the conversation's confirmation mode).
  **Expect:** `waiting_for_confirmation` lands as
  `attention.requested` with **no options and no respond path** — this
  is the never-send posture in practice, not a gap in the mapping.
  Mission Control shows the request but renders no answer controls
  for it.
- [ ] Answer the confirmation in the **OpenHands UI**, not Mission
  Control.
  **Expect:** a human rejection stays vendor-scoped
  (`x.openhands.user_reject.observation` — a human decision is not a
  policy block, so it is never `tool.denied`); only a configured
  analyzer/hook rejection lands as `tool.denied (by: "policy")` — the
  two are distinguished on the wire, not guessed. Either way the leg
  resolves (`attention.resolved`). An approval lets the tool
  proceed to its normal `tool.completed`. Record exactly which you saw.

### 4 — Cancel (default posture)

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:`
  nack — the bridge declares `control: { accepts: [] }`, so the relay
  nacks `control.cancel` on its behalf. The agent stays sovereign;
  this is the correct result, not a bug. (The control opt-in in beat 6
  does NOT change this: no OpenHands write terminates a run, so cancel
  stays undeclared by design.)
- [ ] Stop or interrupt the conversation from the **OpenHands UI**
  instead, and **record what lands** — that is exactly what these
  sessions exist to pin down.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Generate more activity in the
  conversation. Reopen the tab.
  **Expect:** the lane rebuilds from the persisted
  `(session, epoch, seq)` positions with no gaps.
- [ ] Also restart the bridge process itself (not just the Mission
  Control tab) mid-conversation, then let it reconnect.
  **Expect:** the socket resumes with `resend_mode=since` plus the
  last seen vendor timestamp; the vendor event id is the dedupe key —
  verify no duplicate events land across the reconnect. If
  `AEP_OPENHANDS_DELTAS` was on, note that replayed history
  legitimately lacks the streaming deltas (the vendor doesn't persist
  them).
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back
  and follows.

### 6 — Control (opt-in) — smoke-proven, live pending

Restart the bridge with `AEP_OPENHANDS_CONTROL=1` (wait for
`control: true` on `healthz`). Everything below is smoke-proven
against stub agent servers speaking the pinned REST + WebSocket
protocol; a live agent server has not yet validated it — mismatches
here are exactly what this beat exists to find. The gate mints no
permission (the observation key could always drive); it changes only
what the bridge is willing to write — exactly five REST writes, with
the events socket staying auth-frame-only either way.

- [ ] Trigger a confirmation gate again.
  **Expect:** the same moment now lands as an answerable
  `attention.requested` (kind `permission`, Approve/Deny) in the
  attention dock, on the same `openhands` lane.
- [ ] Answer **Deny** from the dock (add a note — it rides as the
  vendor rejection reason).
  **Expect:** the bridge acks and drives
  `respond_to_confirmation {accept: false}`; the vendor's own status
  flip out of `waiting_for_confirmation` settles the item —
  `attention.answered { via: "control" }` cause-linked to your
  command, then `attention.resolved`, plus the vendor-scoped
  `x.openhands.user_reject.observation`.
- [ ] Trigger one more confirmation and answer it **in the OpenHands
  UI** instead.
  **Expect:** the dock item settles anyway — the flip is the one
  outcome source whoever caused it; without your command it takes the
  plain observed path (no `via: "control"` attribution).
- [ ] With the conversation running, press **Pause** in the session
  header.
  **Expect:** the bridge acks and POSTs the vendor's own pause; the
  vendor finishes its current step (pause is graceful, not instant),
  then the `execution_status` flip lands as a `state.delta`
  **cause-linked to your command** in the Timeline. The run stays
  open — paused is not a terminal.
- [ ] Press **Resume**.
  **Expect:** the same shape back to `running` — the SAME run
  continues; no second `run.started`.
- [ ] Press **Resume** again while the conversation is already
  running, and once while it is idle.
  **Expect:** honest refusals inline (`already running`; `nothing to
  resume — the vendor run call would start work`). The idle refusal
  is load-bearing: a resume that starts new work would make the
  observer an operator.
- [ ] If you can stage it: press **Resume** while a confirmation is
  pending.
  **Expect:** refused, with the nack pointing at
  `control.attention.respond` — the vendor's run call would silently
  accept the pending actions, and resume must never bypass the
  attention loop.
- [ ] With the conversation **paused**, open the composer and use
  **Send input** (the OpenHands profile — the button is honestly not
  labelled "Steer": this is user-plane input, not advisory context).
  **Expect:** the target acks; `x.openhands.input.sent` lands
  cause-linked to your command in the Timeline (no text on it — the
  capture rule), and the appended message shows as the vendor's own
  `x.openhands.message.event`. The conversation does NOT start
  running — the bridge pins the vendor's run flag false; your text
  waits for the next run (or, sent mid-run, is picked up on a later
  step).
- [ ] Send `x.openhands.control.interrupt` while the conversation is
  **running** (via an API sender — Mission Control has no interrupt
  button; the generic pause stays the header control).
  **Expect:** instant suspension — the vendor cancels the in-flight
  LLM call; the `paused` flip lands cause-linked to your command, with
  the vendor's `x.openhands.interrupt.event` alongside. Resume works
  exactly as after a graceful pause — the SAME run continues.
- [ ] Send interrupt again while paused or idle.
  **Expect:** refused honestly — nothing is in flight, and the vendor
  endpoint would fall back to a silent pause no-op the bridge refuses
  to misreport.

Capability truth here is **observed, never declared**: emitter
capabilities are not consumer-visible in 0.1, so Mission Control
offers Pause/Resume send-and-settle and surfaces refusals in place.
The session view's **Control** tab records each verb's last observed
settle (`accepted` / `refused · reason`) — check it after the sends
above; it never claims anything a send has not proven.
There is no paused badge: at the `metadata` capture
ceiling the consumer cannot durably know the state, so the
cause-linked `state.delta` in the Timeline is the proof.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle |  |  |
| 2 | Tool trio |  |  |
| 3 | Attention: observed confirmation outcome (user/policy) |  |  |
| 4 | Cancel: nack, vendor-side stop |  |  |
| 5 | Replay / resume incl. bridge restart dedupe |  |  |
| 6 | Control opt-in: answered confirmation, pause/resume + refusals, send-input append, interrupt from running + refusals |  |  |

## Reset & re-run

Ctrl-C the bridge and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The bridge's
per-conversation JSONL logs live under `~/.aep/logs/openhands/` — keep
them; they are the capture evidence for anything you file. Revoke or
retire the observation session API key to detach entirely. Mission
Control's saved positions live in the browser's `localStorage` per
relay URL; a fresh browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh assistant session to help a tester bring up
the bridge and drive the script — this assistant is a **helper**, not
the agent under observation (the OpenHands conversation is observed):

```text
You are helping a tester run a guided live session against the AEP
OpenHands bridge. You are not the agent being observed — a separate
OpenHands agent server and its conversations are the subject; you are
assisting from outside.

Walk the tester through these steps, one at a time, confirming each
before moving on:

1. Confirm a relay is running with a token and Mission Control is
   connected to it (the testing index's shared setup).
2. Help the tester mint a dedicated session API key for the OpenHands
   agent server if they don't already have one, and start the bridge
   with AEP_TOKEN and AEP_OPENHANDS_KEY set. Point out plainly that
   the events socket is read-write and this key can technically drive
   the conversation too — the bridge chooses never to write
   anything after its auth frame.
3. Have the tester confirm GET http://127.0.0.1:8397/healthz reports
   relay:true and source:true before proceeding.
4. Have the tester start (or pick) a conversation in OpenHands and
   wait up to the poll interval for an "openhands" lane to appear in
   Fleet.
5. Have the tester send a prompt with a tool-shaped ask, then one that
   fails, watching the Timeline for the tool.requested/tool.completed/
   tool.failed pairs with the is_error split.
6. Have the tester trigger a confirmation gate and answer it IN THE
   OPENHANDS UI — at the default posture Mission Control cannot answer
   this channel (no options, no respond path). Confirm the outcome: a
   human rejection stays vendor-scoped
   (x.openhands.user_reject.observation, never tool.denied); only a
   hook/analyzer rejection lands as tool.denied by:"policy".
7. Have the tester press Cancel run in Mission Control and confirm the
   inline "cancel failed:" nack, then stop the conversation from the
   OpenHands UI instead and note what lands.
8. Have the tester close and reopen the Mission Control tab after
   generating one more event, confirming a gap-free rebuild. Then have
   them restart the bridge process itself mid-conversation and confirm
   no duplicate events appear after it reconnects.
9. For beat 6, have the tester restart the bridge with
   AEP_OPENHANDS_CONTROL=1 (healthz gains control:true), answer a
   confirmation from the attention dock (attention.answered
   via:"control" cause-linked to the command), then drive Pause and
   Resume from the session header — the outcome each time is the
   vendor's own execution_status flip riding a cause-linked
   state.delta. Also collect the refusals (resume while running, while
   idle, and during a pending confirmation) — the refusals are
   load-bearing, not failures. Cancel STAYS refused: no vendor write
   terminates a run. Then the vendor verbs: use the composer's Send
   input on a paused conversation (x.openhands.input.sent lands
   cause-linked, no text on it; the appended message shows as the
   vendor's own x.openhands.message.event; the conversation does NOT
   start running — the bridge pins the vendor run flag false), and
   send x.openhands.control.interrupt via an API sender while running
   (instant suspension: the paused flip lands cause-linked with
   x.openhands.interrupt.event alongside; resume continues the SAME
   run) plus once while paused/idle (refused honestly — the vendor
   endpoint would fall back to a silent pause no-op).
10. Help the tester fill in the guide's results table with what
    actually happened, flagging any mismatch from the guide's expect
    lines — mismatches are the point of the session.

Be precise about ports, env vars, and file paths; if something in the
guide does not match what you observe, say so plainly rather than
smoothing it over.
```
