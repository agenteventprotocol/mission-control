# Guided session — ACP

Observes an ACP (Agent Client Protocol) editor↔agent pairing through the
reference bridge (`reference/impl/bridge-acp/`) — a command-substitution
stdio tee. **Fixture-proven; live validation against a real editor↔agent
pairing pending.**

**Respond from Mission Control: no** — read-only channel. The editor's
own permission gate answers the request; you observe the outcome arrive
on the stream.

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and an ACP-speaking editor↔agent pairing (any editor that launches its
  agent as a subprocess over the ACP wire — the agent command is
  arbitrary, so the bridge attaches to any of them).
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — in the editor's agent-server configuration, replace
#   <real-agent-command> [args...]
# with
#   node impl/bridge-acp/bridge-acp.js <real-agent-command> [args...]
# (AEP_RELAY / AEP_TOKEN in the command's environment)
```

**State this prominently before you attach:** this attach shape is
**not blessed by the ACP spec**. ACP sessions are point-to-point
newline-delimited JSON-RPC over stdio, and the specification documents
no proxy, recording, or export story. The bridge works because agent
commands are arbitrary in every ACP editor — it spawns the real agent
from its own arguments and pipes both directions byte-transparently
(stderr and the exit code pass through too), parsing off-path. A parse
or mapping failure never blocks the pass-through; a dead relay never
affects the editor↔agent session.

Env: `AEP_ACP_HEALTH_PORT` (default 8394; `GET /healthz` →
`{ ok, relay, source }`), `AEP_ACP_DELTAS=1` (opt-in: message/thought
chunks surface as `x.acp.*` at `debug`; pair with
`AEP_CAPTURE=redacted` for the text), `AEP_AGENT_NAME` (default `acp`
— rename per pairing if you run more than one), plus the standard
`AEP_RELAY` / `AEP_TOKEN` / `AEP_CAPTURE` / `AEP_CAPTURE_ATTENTION` /
`AEP_LOG_DIR`.

## The guided script

Work in a scratch directory with the editor pointed at the bridged
agent command. Find your lane in Fleet by agent name: **acp** (or
whatever `AEP_AGENT_NAME` you set).

### 1 — Lifecycle

- [ ] Start a session in the editor and submit any prompt.
  **Expect:** an `acp` lane appears in Fleet (`session.started` — the
  wire `sessionId` rides verbatim as the AEP session, no synthesis).
  The `session/prompt` turn opens a run (`run.started`, scoped by the
  request's JSON-RPC id).
- [ ] Let the turn finish normally.
  **Expect:** `run.finished` with the `stopReason` as metadata —
  `end_turn`, `max_tokens`, and `max_turn_requests` all land here;
  bounded terminations are completions, not failures.

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless.
  **Expect:** `tool.requested` → `tool.completed` pairs in the session
  Timeline, paired by `toolCallId` and `cause`-linked (the Causal graph
  draws the edge); the human-readable title rides as the name.
- [ ] Make a tool fail.
  **Expect:** `tool.failed` from a `tool_call_update` with status
  `failed`. Intermediate status churn between request and terminal
  rides as `x.acp.tool_call.update` at `debug` — flip the severity
  lens to see it.

### 3 — Attention: observe the vendor-side decision

- [ ] Trigger a permission gate (ask for an action the editor prompts
  on).
  **Expect:** `attention.requested (kind=permission)` appears in the
  Attention center — **read-only**: no `options` claim, no
  `respond_via` (the option list rides only as a count in the
  payload). Mission Control cannot answer this one; there is no
  quick-answer strip on the card.
- [ ] Answer the prompt in the **editor**, not Mission Control.
  **Expect:** the outcome lands as `attention.answered` (the selected
  `optionId`, delivered via `oob` since nothing on the wire ties it
  back to a respond call) followed by `attention.resolved`. Cancelling
  the prompt in the editor instead lands `resolution: dismissed`.
  Record exactly what arrives — that is what this session exists to
  pin down.

### 4 — Cancel

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:`
  nack — the bridge is a read-only observer and declares no control
  capabilities, so the relay nacks `control.cancel` on its behalf.
  This is the correct sovereign result, not a bug.
- [ ] Cancel the turn on the **editor** side instead.
  **Expect:** `run.cancelled (by: "user")` from a `stopReason` of
  `cancelled` — this is beat 4's true wire-visible cancel for this
  surface.
- [ ] Force a refusal (or note if the agent/editor pairing does not
  expose one) and **record what lands**.
  **Expect:** `run.failed` from a `stopReason` of `refusal`.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in the
  editor. Reopen the tab.
  **Expect:** the lane rebuilds from the persisted
  `(session, epoch, seq)` positions with no gaps — the events emitted
  while you were away are there.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back
  and follows.

Extra credit: set `AEP_ACP_DELTAS=1` and watch `agent_message_chunk` /
`agent_thought_chunk` / `user_message_chunk` ride as `x.acp.*` at
`debug` (the core `message.*` types stay reserved on this channel);
watch a plan update land as `x.acp.plan.updated` — the schema's plan
entries carry no id, so this is status counts only, never synthesized
tasks.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle |  |  |
| 2 | Tool trio |  |  |
| 3 | Attention: observed editor-side decision |  |  |
| 4 | Cancel: nack, vendor cancel, refusal |  |  |
| 5 | Replay / resume |  |  |

## Reset & re-run

Ctrl-C the relay (it drains: SSE gets a `shutting-down` comment,
sockets close clean); the bridge process exits with the editor's
subprocess tree since it owns the real agent's stdio. The bridge's
per-session JSONL logs live under `~/.aep/logs/acp/` — keep them; they
are the capture evidence for anything you file. Revert the editor's
agent-server configuration to the real agent command to detach
entirely. Mission Control's saved positions live in the browser's
`localStorage` per relay URL; a fresh browser profile is a clean
observer.

## Session prompt for an assistant

Paste this into a fresh assistant session to help a tester bring up
the bridge and drive the script — this assistant is a **helper**, not
the agent under observation (the editor's own agent process is
observed):

```text
You are helping a tester run a guided live session against the AEP ACP
bridge. You are not the agent being observed — a separate ACP editor
and its spawned agent are the subject; you are assisting from outside.

Walk the tester through these steps, one at a time, confirming each
before moving on:

1. Confirm a relay is running with a token and Mission Control is
   connected to it (the testing index's shared setup).
2. Help the tester edit their ACP editor's agent-server configuration
   so the agent command is prefixed with
   `node impl/bridge-acp/bridge-acp.js` (keeping the real agent command
   and its arguments after it), with AEP_RELAY and AEP_TOKEN set in
   that command's environment. State clearly that this attach shape is
   not blessed by the ACP spec — it is a command-substitution tee.
3. Have the tester start a session in the editor and submit a prompt.
   Confirm an "acp" lane appears in Fleet.
4. Have the tester ask for a harmless tool action, then one that fails,
   watching the Timeline for the tool.requested/tool.completed/
   tool.failed pairs.
5. Have the tester trigger a permission prompt IN THE EDITOR and
   answer it there — Mission Control cannot answer this channel.
   Confirm the attention.requested appears read-only (no answer
   controls) and that the outcome arrives afterward.
6. Have the tester press Cancel run in Mission Control and confirm the
   inline "cancel failed:" nack, then cancel the turn in the editor
   instead and note what lands.
7. Have the tester close and reopen the Mission Control tab after
   generating one more event, confirming a gap-free rebuild, then try
   the replay slider and Back to live.
8. Help the tester fill in the guide's results table with what
   actually happened, flagging any mismatch from the guide's expect
   lines — mismatches are the point of the session.

Be precise about ports, env vars, and file paths; if something in the
guide does not match what you observe, say so plainly rather than
smoothing it over.
```
