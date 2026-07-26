# Guided session — Codex

Observes a real Codex session through the reference hook adapter
(`reference/impl/adapter-codex/`). Ten Codex hooks map to AEP core types
10/10 (AEP-0002 Annex A): **validated live end to end**; the
interrupt-drain beat is smoke-proven.

**Respond from Mission Control: yes** — the hold-open permission loop
(`PermissionRequest` ⇄ `control.attention.respond`).
**Steer from Mission Control: opt-in** — `AEP_INSTRUCT=1` on the daemon
(beat 6; smoke-proven, live pending).

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and Codex installed.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

> **Quick path:** `node impl/setup/aep-setup.js up codex` in the reference
> repo automates this section (registration via `write codex`, backed up
> and idempotent) — see [Quick setup](README.md#quick-setup-automated).
> The steps below stay canonical.

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the adapter daemon (same token; capture level to taste)
AEP_TOKEN=<token> AEP_CAPTURE=metadata node impl/adapter-codex/adapter.js &

# 3 — register the hooks
# merge impl/adapter-codex/config.example.toml [hooks] tables into
# ~/.codex/config.toml (fix the /path/to/aep placeholder), then run
# /hooks inside Codex to trust them
```

The shim `codex-hook.js` POSTs to the daemon on `127.0.0.1:8378`
(`AEP_ADAPTER_PORT` changes it). Check `GET http://127.0.0.1:8378/healthz`
→ `{ ok, relay }` and wait for `relay: true` — that is the daemon's
WebSocket binding to the relay going live. Codex runs only
`type: "command"` hooks (no HTTP hook type), so the shim is the only
attach path; it fails open, so a dead daemon looks like silence, not
breakage.

Useful knobs: `AEP_CAPTURE` (default `metadata`), `AEP_CAPTURE_ATTENTION`
(default `redacted`), `AEP_ATTENTION_TIMEOUT_MS` (default 55 000 — keep
it below the `PermissionRequest` hook's `timeout` in the TOML, which is
in seconds: 90 s there, with `statusMessage` set to
`"AEP: attention round-trip"`; every other hook in the example file
times out at 15 s), `AEP_INSTRUCT` (steering opt-in, default OFF —
beat 6 exercises both sides of the gate).

Beyond the per-user `config.toml` wiring above, the vendor also supports
attaching this same shim via managed hooks (`requirements.toml`) or a
plugin's `hooks/hooks.json` (with `AEP_ADAPTER_URL` pointed at the
daemon) — same hook command, different distribution path.

Codex also exports native OTel telemetry; the
[Codex over OTLP](bridge-otlp-in.md) guide observes that second channel
for the same agent, independently of this hook adapter.

## The guided script

Work in a scratch directory. Find your lane in Fleet by agent name:
**codex**.

### 1 — Lifecycle

- [ ] Start a Codex session and submit any prompt.
  **Expect:** a `codex` lane appears in Fleet (`session.started` from
  `SessionStart`), and the prompt opens a run (`run.started` from
  `UserPromptSubmit` — the Codex `turn_id` is the AEP run id). The
  lane's run ribbon shows it active.
- [ ] Let the turn finish.
  **Expect:** `run.finished` closes the run (`Stop` hook).

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless: *"list the files in
  this directory"*.
  **Expect:** `tool.requested` → `tool.completed` pairs in the session
  Timeline (`PreToolUse` / `PostToolUse`), `cause`-linked. At the
  default capture only the args digest rides along.
- [ ] Make a tool fail: *"read the file ./does-not-exist.txt"*.
  **Expect:** no `tool.failed` — Codex has no failure hook, so a failed
  tool still lands `tool.completed`. Open the Inspector on that event
  and record the failure shape it carries instead (exit code / error
  text in the payload) — that is the honest ceiling of this source, not
  a gap in the adapter.

### 3 — Attention: answer from Mission Control

- [ ] Trigger a permission gate (ask for an action Codex prompts on —
  e.g. running a shell command).
  **Expect:** the attention dock slides in (`attention.requested`, kind
  `permission`); the fleet card grows its inline quick-answer strip;
  the rail bell and tab title count it.
- [ ] Answer **allow** from the dock.
  **Expect:** the card flips to "responding", then settles off the
  stream (`attention.answered`, `attention.resolved`) — and Codex
  proceeds without showing its own permission prompt: the response
  reached the hook, not just the log.
- [ ] Type the word `allow` (any case) into the reply box on a fresh
  gate — no button click.
  **Expect:** the typed word IS the option (the AEP-0008 receiver
  rule): `attention.answered` records `option: "allow"` with no text
  residue, and the tool proceeds exactly as a clicked Allow.
- [ ] Type a free-text reply that is NOT an option word (e.g. *"use the
  staging registry instead"*) on another fresh gate.
  **Expect:** a DENY carrying your words as the decision message —
  `attention.answered` records `option: "deny"` plus your text; Codex
  reads the guidance, adjusts, and asks again. Free text is never an
  allow.
- [ ] Let one request time out instead.
  **Expect:** `attention.timeout` on the stream and Codex falling back
  to its own interactive prompt — the adapter never blocks the agent
  indefinitely (the 90 s hook `timeout` gives Mission Control's 55 s
  default enough room to settle first).

### 4 — Cancel

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:` nack —
  this adapter declares `control.attention.respond` only, the relay
  nacks `control.cancel` on its behalf, and Mission Control surfaces the
  refusal exactly where you clicked. The agent stays sovereign; this is
  the correct result, not a bug.
- [ ] Interrupt the turn on the vendor side instead (Esc), then submit
  the next prompt.
  **Expect:** the interrupt itself lands **nothing** — Codex fires no
  hook for it, so the run stays open until the next prompt, where the
  stale run closes as `run.cancelled` (`by: "user"`, cause-linked to its
  own `run.started`) right before the new `run.started` — one open run
  per lane, never a stack. An interrupt on the *last* turn stays open
  legitimately: with no `SessionEnd` hook the next prompt is the only
  drain boundary this source has.
- [ ] End the session on the vendor side.
  **Expect:** nothing closes the lane. Codex has no `SessionEnd` hook,
  so `session.ended` is not emittable from this source — the lane stays
  open rather than flipping to ended. That is correct: state it, don't
  work around it.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in a fresh
  Codex session. Reopen the tab.
  **Expect:** lanes rebuild from the persisted `(session, epoch, seq)`
  positions with no gaps — the events emitted while you were away are
  there.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back and
  follows.

Extra credit: trigger a compaction — the mapping emits
`session.compacted` once, at `PostCompact` only (a documented deviation
from the pre/post pair some vendors expose).

### 6 — Steer (opt-in; smoke-proven, live pending)

The steering path is proven end to end by the adapter's own steering
smoke (relay-behalf refusal, queued delivery on the documented moments,
the re-ack discipline) — what a **live** Codex session does with the
injected context is still unvalidated; that is what this beat pins down.

- [ ] With the daemon running **without** `AEP_INSTRUCT`, press
  **Steer** in the session header and send any instruction.
  **Expect:** an inline `refused: … unsupported` right in the composer —
  the verb is absent from the daemon's `hello`, so the relay refuses the
  command sender-side on the target's behalf (AEP-0004 §4.2).
  Observe-only is the default posture; like the cancel nack, this
  refusal is the correct result, not a bug.
- [ ] Restart the daemon with `AEP_INSTRUCT=1` (its `hello` now declares
  `x.codex.control.instruct`) and steer again with something visible.
  **Expect:** the composer settles "accepted by the target", and on the
  session's next eligible hook reply — the five context-accepting
  moments the vendor documents (`SessionStart`, `SubagentStart`,
  `PreToolUse`, `PostToolUse`, `UserPromptSubmit`) — the Timeline gains
  a cause-linked `x.codex.instruction.delivered { queued_ms }`. The
  instruction text rides the stream capture-gated.
- [ ] Submit a prompt and watch the next turn.
  **Expect:** the text is added as extra developer context the model
  reads on its **next** request (vendor semantics; advisory). Whether
  and how the agent honors it is exactly the kind of fact to record.
- [ ] Note the vendor ceiling: Codex has **no `SessionEnd` hook**, so
  there is no `instruction.dropped { session-ended }` moment on this
  source — an instruction queued into a session that never fires
  another eligible hook stays queued for the daemon's lifetime (the
  design record's recorded deviation). Nothing to exercise here; it is
  listed so its absence in the Timeline reads as designed, not missed.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle |  |  |
| 2 | Tool trio (incl. no tool.failed) |  |  |
| 3 | Attention: allow / typed word / free-text deny / timeout |  |  |
| 4 | Cancel: nack, vendor interrupt, no session.ended |  |  |
| 5 | Replay / resume |  |  |
| 6 | Steer: refusal (flag off), delivered (no drop moment on this vendor) |  |  |

## Reset & re-run

Ctrl-C the adapter and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The adapter's per-session
JSONL logs live under `~/.aep/logs/codex/` — keep them; they are the
capture evidence for anything you file. Remove the `[hooks]` tables from
`~/.codex/config.toml` to detach Codex entirely. Mission Control's saved
positions live in the browser's `localStorage` per relay URL; a fresh
browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh Codex session that has the hooks registered and
trusted — the session under observation can drive its own script:

```text
You are the agent under observation in a guided live session. A relay,
the Codex hook adapter, and Mission Control are already running; your
hooks are registered and trusted, so everything you do lands on an
event stream a tester is watching.

Work through these steps, pausing after each so the tester can check
the stream. Use a scratch directory. Announce each step before you do
it.

1. Acknowledge this prompt (that already opened the session and a run).
2. List the files in the current directory with a tool call.
3. Try to read ./does-not-exist.txt. Note that this adapter has no
   failure hook, so the tester will see this land as tool.completed,
   not tool.failed — that is expected.
4. Do something that triggers a permission prompt, and WAIT — the
   tester answers it from Mission Control, not the terminal. Note in
   one line whether the answer reached you without your own prompt
   appearing.
5. Stop and wait while the tester interrupts you mid-turn on their
   side; afterwards, note what you experienced.
6. Report a short summary the tester can paste into the guide's
   results table: for each step, what you did and whether the
   round-trip behaved as described.

Be honest about anything that did not match; mismatches are the
point of the session.
```
