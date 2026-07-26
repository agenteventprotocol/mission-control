# Guided session — Claude Code

Observes a real Claude Code session through the reference hook adapter
(`reference/impl/adapter-claude-code/`). This is the mapping that has
been **validated live end to end** (permission and structured-input
loops included) — the strongest surface to start with, and the only one
where every respond path in this guide is expected to work.

**Respond from Mission Control: yes** — the hold-open permission loop
(`PermissionRequest` ⇄ `control.attention.respond`) plus the AEP-0006
structured-form loop (`AskUserQuestion`, MCP `Elicitation`).
**Steer from Mission Control: opt-in** — `AEP_INSTRUCT=1` on the daemon
(beat 6 exercises both the refusal and the delivery).

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and Claude Code installed.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

> **Quick path:** `node impl/setup/aep-setup.js up claude-code` in the reference
> repo automates this section (registration via `write claude-code`, backed up
> and idempotent) — see [Quick setup](README.md#quick-setup-automated).
> The steps below stay canonical.

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the adapter daemon (same token; capture level to taste)
AEP_TOKEN=<token> AEP_CAPTURE=metadata node impl/adapter-claude-code/adapter.js &

# 3 — register the hooks
# merge impl/adapter-claude-code/hooks-settings.example.json into ~/.claude/settings.json
```

The hooks POST to the daemon on `127.0.0.1:8377` (`AEP_ADAPTER_PORT`
changes it). Check `GET http://127.0.0.1:8377/healthz` → `{ ok, relay }`
and wait for `relay: true` — that is the daemon's WebSocket binding to
the relay going live. Hooks fail open: with the daemon down, Claude Code
behaves as if unhooked, so a dead daemon looks like silence, not
breakage.

Useful knobs: `AEP_CAPTURE` (default `metadata`; prompts and titles
appear at `redacted`+, tool args only at `full`),
`AEP_CAPTURE_ATTENTION` (default `redacted`),
`AEP_ATTENTION_TIMEOUT_MS` (default 55 000 — keep it below the
`PermissionRequest` hook `timeout` in the settings file, which is in
seconds), `AEP_INSTRUCT` (steering opt-in, default OFF — beat 6 exercises
both sides of the gate).

## The guided script

Work in a scratch directory. Find your lane in Fleet by agent name:
**claude-code**.

### 1 — Lifecycle

- [ ] Start `claude` and submit any prompt.
  **Expect:** a `claude-code` lane appears in Fleet (`session.started`),
  and the prompt opens a run (`run.started` — the vendor `prompt_id` is
  the run id). The lane's run ribbon shows it active.
- [ ] Let the turn finish.
  **Expect:** `run.finished` closes the run (`Stop` hook). A failed turn
  (`StopFailure`) would land `run.failed` with the vendor error type in
  `data.reason`.

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless: *"list the files in
  this directory"*.
  **Expect:** `tool.requested` → `tool.completed` pairs in the session
  Timeline, `cause`-linked (the Causal graph draws the edge). At the
  default capture only the args digest rides along — the Inspector's
  capture badge explains what was withheld.
- [ ] Make a tool fail: *"read the file ./does-not-exist.txt"*.
  **Expect:** `tool.failed` (`PostToolUseFailure`), severity `warning`+,
  visible in the severity heat on the lane.
- [ ] Optional: with a permission mode that auto-denies something,
  trigger the denial.
  **Expect:** `tool.denied` with `data.by: "runtime"` — the auto-mode
  classifier's decision, observed, never injected.

### 3 — Attention: answer from Mission Control

- [ ] Trigger a permission gate (ask for an action your current
  permission mode prompts on — e.g. running a shell command).
  **Expect:** the attention dock slides in (`attention.requested`,
  kind `permission`); the fleet card grows its inline quick-answer
  strip; the rail bell and tab title count it.
- [ ] Answer **allow** from the dock.
  **Expect:** the card flips to "responding", then settles off the
  stream (`attention.answered`, `attention.resolved`) — and Claude Code
  proceeds **without showing its own permission dialog**: the response
  reached the hook, not just the log. A deny lands as a denial in the
  agent; free text lands as deny-with-guidance (that is all the hook
  output can carry).
- [ ] Let one request time out instead.
  **Expect:** `attention.timeout` on the stream and Claude Code falling
  back to its own interactive dialog — the adapter never blocks the
  agent indefinitely.
- [ ] Structured form: ask *"use the AskUserQuestion tool to ask me
  which color I prefer"*.
  **Expect:** the dock renders a real form (AEP-0006), not a free-text
  box; submitting sends `answer.values` and your choice arrives in
  Claude Code as the tool's answer.

### 4 — Cancel

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:` nack —
  this adapter declares `control.attention.respond` only, the relay
  nacks `control.cancel` on its behalf, and Mission Control surfaces the
  refusal exactly where you clicked. The agent stays sovereign; this is
  the correct result, not a bug.
- [ ] Interrupt the turn on the vendor side instead (Esc in Claude
  Code), then submit the next prompt.
  **Expect:** the interrupt itself lands **nothing** — Claude Code fires
  no hook for it, so the run stays open until the adapter's next visible
  boundary. On the next prompt the stale run closes as `run.cancelled`
  (`by: "user"`, cause-linked to its own `run.started`) right before the
  new `run.started` — one open run per lane, never a stack.
- [ ] Interrupt once more, then end the session (`/exit`) without
  another prompt.
  **Expect:** the open run drains as `run.cancelled` first, then
  `session.ended` (vendor reasons collapse to `normal`); the lane's
  status flips to ended with no run left dangling.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in a fresh
  `claude` session. Reopen the tab.
  **Expect:** lanes rebuild from the persisted `(session, epoch, seq)`
  positions with no gaps — the events emitted while you were away are
  there.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back and
  follows.

Extra credit: `/compact` mid-session → `session.compacted` with
`data.trigger` (`manual`), emitted once, at the post-compaction moment.

### 6 — Steer (opt-in)

- [ ] With the daemon running **without** `AEP_INSTRUCT`, press
  **Steer** in the session header and send any instruction.
  **Expect:** an inline `refused: … unsupported` right in the composer —
  the verb is absent from the daemon's `hello`, so the relay refuses the
  command sender-side on the target's behalf (AEP-0004 §4.2).
  Observe-only is the default posture; like the cancel nack, this
  refusal is the correct result, not a bug.
- [ ] Restart the daemon with `AEP_INSTRUCT=1` (its `hello` now declares
  `x.claude-code.control.instruct`) and steer again with something
  visible, e.g. *"Answer the next question in exactly one short
  sentence."*
  **Expect:** the composer settles "accepted by the target", and on the
  session's next eligible hook reply the Timeline gains a cause-linked
  `x.claude-code.instruction.delivered { queued_ms }`. The instruction
  text rides the stream capture-gated (`[redacted]` at the default
  attention ceiling) — the Inspector shows the withholding, not the
  words.
- [ ] Submit a prompt and watch the next turn.
  **Expect:** steering is advisory and asynchronous by vendor design —
  the text is added as context the model reads on its **next** request.
  Whether and how the agent honors it is exactly the kind of fact these
  sessions exist to record.
- [ ] Queue one more instruction, then end the session (`/exit`) before
  anything delivers it.
  **Expect:** `x.claude-code.instruction.dropped
  { reason: "session-ended" }`, cause-linked, **before** `session.ended`
  — nothing queued dies silently.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle |  |  |
| 2 | Tool trio |  |  |
| 3 | Attention: allow / deny / free text / timeout / form |  |  |
| 4 | Cancel: nack, vendor interrupt, session end |  |  |
| 5 | Replay / resume |  |  |
| 6 | Steer: refusal (flag off), delivered, dropped at session end |  |  |

## Reset & re-run

Ctrl-C the adapter and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The adapter's per-session
JSONL logs live under `~/.aep/logs/claude-code/` — keep them; they are
the capture evidence for anything you file. Remove the hook entries from
`~/.claude/settings.json` to detach Claude Code entirely. Mission
Control's saved positions live in the browser's `localStorage` per relay
URL; a fresh browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh Claude Code session that has the hooks
registered — the session under observation can drive its own script:

```text
You are the agent under observation in a guided live session. A relay,
the Claude Code hook adapter, and Mission Control are already running;
your hooks are registered, so everything you do lands on an event
stream a tester is watching.

Work through these steps, pausing after each so the tester can check
the stream. Use a scratch directory. Announce each step before you do
it.

1. Acknowledge this prompt (that already opened the session and a run).
2. List the files in the current directory with a tool call.
3. Try to read ./does-not-exist.txt so one tool call fails.
4. Do something that triggers a permission prompt under the current
   permission mode, and WAIT — the tester answers it from Mission
   Control, not the terminal. Note in one line whether the answer
   reached you without your own dialog appearing.
5. Use the AskUserQuestion tool to ask the tester which option they
   prefer (any two options). Note how the answer arrived.
6. Stop and wait while the tester interrupts you mid-turn on their
   side; afterwards, note what you experienced.
7. Pause and wait while the tester sends you a steering instruction
   from Mission Control; on your next turn, say whether new context
   surfaced to you and follow it if it makes sense.
8. Report a short summary the tester can paste into the guide's
   results table: for each step, what you did and whether the
   round-trip behaved as described.

Be honest about anything that did not match; mismatches are the
point of the session.
```
