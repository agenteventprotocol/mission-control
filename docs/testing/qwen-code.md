# Guided session — Qwen Code

Observes a real Qwen Code session through the reference hook adapter
(`reference/impl/adapter-qwen-code/`). Qwen's hook surface mirrors Claude
Code's shape closely (same common stdin fields, `tool_use_id` pairing, a
`PermissionRequest` suitable for the hold-open control loop) —
**documented + fixture-proven, live-session validation pending**.

**Respond from Mission Control: yes** — the hold-open permission loop
(`PermissionRequest` ⇄ `control.attention.respond`), the same pattern as
Claude Code and Codex.
**Steer from Mission Control: opt-in** — `AEP_INSTRUCT=1` on the daemon
(beat 6; smoke-proven, live pending).

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and Qwen Code installed.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

> **Quick path:** `node impl/setup/aep-setup.js up qwen-code` in the reference
> repo automates this section (registration via `write qwen-code`, backed up
> and idempotent) — see [Quick setup](README.md#quick-setup-automated).
> The steps below stay canonical.

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the adapter daemon (same token; capture level to taste)
AEP_TOKEN=<token> AEP_CAPTURE=metadata node impl/adapter-qwen-code/adapter.js &

# 3 — register the hooks
# merge impl/adapter-qwen-code/settings.example.json "hooks" object into
# your Qwen Code settings.json
```

Qwen Code supports native `type: "http"` hooks that POST straight to the
daemon on `127.0.0.1:8380/` — `settings.example.json` registers
everything that way, no shim in the path. If you'd rather run
`type: "command"` hooks, swap each entry for `qwen-hook.js` (it wraps
the same endpoint). Check `GET http://127.0.0.1:8380/healthz` →
`{ ok, relay }` and wait for `relay: true` — that is the daemon's
WebSocket binding to the relay going live. Both paths fail open: with
the daemon down, Qwen Code behaves as if unhooked.

Useful knobs: `AEP_ADAPTER_PORT` (default 8380), `AEP_CAPTURE` (default
`metadata`), `AEP_CAPTURE_ATTENTION` (default `redacted`),
`AEP_ATTENTION_TIMEOUT_MS` (default 55 000), `AEP_INSTRUCT` (steering
opt-in, default OFF — beat 6 exercises both sides of the gate).

## The guided script

Work in a scratch directory. Find your lane in Fleet by agent name:
**qwen-code**.

### 1 — Lifecycle

- [ ] Start Qwen Code and submit any prompt.
  **Expect:** a `qwen-code` lane appears in Fleet (`session.started`),
  and the prompt opens a run (`run.started` from `UserPromptSubmit`).
  No turn id is documented on this vendor, so the adapter synthesizes
  one AEP run per prompt/`Stop` pair — the lane's run ribbon shows it
  active regardless.
- [ ] Let the turn finish.
  **Expect:** `run.finished` closes the run (`Stop` hook). A failed
  turn (`StopFailure`) lands `run.failed` with the vendor's error
  taxonomy (`rate_limit`, `billing_error`, …) in `data.reason`.

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless: *"list the files in
  this directory"*.
  **Expect:** `tool.requested` → `tool.completed` pairs in the session
  Timeline, exactly paired via `tool_use_id` and `cause`-linked. At the
  default capture only the args digest rides along.
- [ ] Make a tool fail: *"read the file ./does-not-exist.txt"*.
  **Expect:** `tool.failed` (`PostToolUseFailure`), severity `error`,
  visible in the severity heat on the lane.

### 3 — Attention: answer from Mission Control

- [ ] Trigger a permission gate (ask for an action Qwen Code prompts
  on).
  **Expect:** the attention dock slides in (`attention.requested`, kind
  `permission`); the fleet card grows its inline quick-answer strip;
  the rail bell and tab title count it.
- [ ] Answer **allow** from the dock.
  **Expect:** the card flips to "responding", then settles off the
  stream (`attention.answered`, `attention.resolved`) — and Qwen Code
  proceeds without showing its own permission dialog: the response
  reached the hook, not just the log.
- [ ] Type the word `allow` (any case) into the reply box on a fresh
  gate — no button click.
  **Expect:** the typed word IS the option (the AEP-0008 receiver
  rule): `attention.answered` records `option: "allow"` with no text
  residue, and the tool proceeds exactly as a clicked Allow.
- [ ] Type a free-text reply that is NOT an option word (e.g. *"use the
  staging registry instead"*) on another fresh gate.
  **Expect:** a DENY carrying your words as the decision message —
  `attention.answered` records `option: "deny"` plus your text; Qwen
  Code renders the deny message for the model to read. Free text is
  never an allow.
- [ ] Let one request time out instead.
  **Expect:** `attention.timeout` on the stream and Qwen Code falling
  back to its own dialog — the adapter never blocks the agent
  indefinitely.

### 4 — Cancel

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:` nack —
  this adapter declares `control.attention.respond` only, the relay
  nacks `control.cancel` on its behalf, and Mission Control surfaces the
  refusal exactly where you clicked. The agent stays sovereign; this is
  the correct result, not a bug.
- [ ] Interrupt the turn on the vendor side instead and **record what
  lands** — the mapping documents `Stop` / `StopFailure` terminals;
  what a vendor-side interrupt produces live is exactly the kind of
  fact these sessions exist to pin down.
- [ ] End the session on the vendor side.
  **Expect:** `session.ended` (`SessionEnd`; vendor reasons collapse to
  `normal`); the lane's status flips to ended.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in a fresh
  Qwen Code session. Reopen the tab.
  **Expect:** lanes rebuild from the persisted `(session, epoch, seq)`
  positions with no gaps — the events emitted while you were away are
  there.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back and
  follows.

Extra credit: trigger a compaction — `PreCompact` emits nothing,
`PostCompact` alone lands `session.compacted` (the Claude Code
convention); create and complete a todo item (`TodoCreated` /
`TodoCompleted` → `progress.task.planned` / `.completed`).

### 6 — Steer (opt-in; smoke-proven, live pending)

The steering path is proven end to end by the adapter's own steering
smoke (relay-behalf refusal, queued delivery on the documented moments,
the audited drop, the re-ack discipline) — what a **live** Qwen Code
session does with the injected context is still unvalidated; that is
what this beat pins down.

- [ ] With the daemon running **without** `AEP_INSTRUCT`, press
  **Steer** in the session header and send any instruction.
  **Expect:** an inline `refused: … unsupported` right in the composer —
  the verb is absent from the daemon's `hello`, so the relay refuses the
  command sender-side on the target's behalf (AEP-0004 §4.2).
  Observe-only is the default posture; like the cancel nack, this
  refusal is the correct result, not a bug.
- [ ] Restart the daemon with `AEP_INSTRUCT=1` (its `hello` now declares
  `x.qwen-code.control.instruct`) and steer again with something
  visible.
  **Expect:** the composer settles "accepted by the target", and on the
  session's next eligible hook reply — the seven context-accepting
  moments the vendor documents (`SessionStart`, `UserPromptSubmit`,
  `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStart`, `PreCompact`) —
  the Timeline gains a cause-linked
  `x.qwen-code.instruction.delivered { queued_ms }`. The instruction
  text rides the stream capture-gated.
- [ ] Submit a prompt and watch the next turn.
  **Expect:** the text is added as context the model reads on its
  **next** request (vendor semantics; advisory — the async
  `systemMessage` surface stays unused by design). Whether and how the
  agent honors it is exactly the kind of fact to record.
- [ ] Queue one more instruction, then end the session on the vendor
  side before anything delivers it.
  **Expect:** `x.qwen-code.instruction.dropped
  { reason: "session-ended" }`, cause-linked, **before** `session.ended`
  — nothing queued dies silently.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle |  |  |
| 2 | Tool trio |  |  |
| 3 | Attention: allow / typed word / free-text deny / timeout |  |  |
| 4 | Cancel: nack, vendor interrupt, session end |  |  |
| 5 | Replay / resume |  |  |
| 6 | Steer: refusal (flag off), delivered, dropped at session end |  |  |

## Reset & re-run

Ctrl-C the adapter and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The adapter's per-session
JSONL logs live under `~/.aep/logs/qwen-code/` — keep them; they are the
capture evidence for anything you file. Remove the hook entries from
your Qwen Code `settings.json` to detach it entirely. Mission Control's
saved positions live in the browser's `localStorage` per relay URL; a
fresh browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh Qwen Code session that has the hooks
registered — the session under observation can drive its own script:

```text
You are the agent under observation in a guided live session. A relay,
the Qwen Code hook adapter, and Mission Control are already running;
your hooks are registered, so everything you do lands on an event
stream a tester is watching.

Work through these steps, pausing after each so the tester can check
the stream. Use a scratch directory. Announce each step before you do
it.

1. Acknowledge this prompt (that already opened the session and a run).
2. List the files in the current directory with a tool call.
3. Try to read ./does-not-exist.txt so one tool call fails.
4. Do something that triggers a permission prompt, and WAIT — the
   tester answers it from Mission Control, not the terminal. Note in
   one line whether the answer reached you without your own dialog
   appearing.
5. Stop and wait while the tester interrupts you mid-turn on their
   side; afterwards, note what you experienced.
6. Report a short summary the tester can paste into the guide's
   results table: for each step, what you did and whether the
   round-trip behaved as described.

Be honest about anything that did not match; mismatches are the
point of the session.
```
