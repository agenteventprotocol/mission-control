# Guided session — Kimi Code CLI

Observes Kimi Code CLI through the reference hook adapter
(`reference/impl/adapter-kimi-code/`). The surface is the vendor's
sixteen external-hook events — shell `command` hooks, stdin snake_case
JSON to stdout JSON, registered in the **one global** `config.toml`
(there is no per-project hook file).

**Verification status: LIVE-VALIDATED.** A five-beat live run against
the shipped 0.28.1 proved the full guide: lifecycle, the tool pair
with the failure twin, the permission pair, the dedicated Interrupt
cancellation, and both opt-in control legs. Re-runs stay valuable on the vendor's
weekly release cadence: a new pin can move any beat, and mismatches are
exactly what this guide exists to find. Cross-link: the
[Kimi web channel](bridge-kimi-code-web.md) guide covers the kap-server
bridge that observes (and optionally controls) `kimi web` sessions —
a different engine from the TUI this guide drives.

**Respond from Mission Control: opt-in** — the held PreToolUse
permission gate (`AEP_KIMI_CONTROL=1`, beat 5) on the vendor's
**binary** allow/deny surface (no ask tier exists). A deny relays your
free text as the reason, which Kimi renders in its own TUI. An allow is
only "no hook objection" — Kimi's own permission flow still runs
downstream (the dual-gate posture), and beat 3's observed pair then
records that answer.
**Steer from Mission Control: opt-in** — `AEP_INSTRUCT=1` ships
`x.kimi-code.control.instruct` (beat 5): queued text delivers on the
next prompt's hook reply, the vendor's one context-accepting reply
surface.

**Hooks are GLOBAL on this vendor.** `write kimi-code` edits the one
`~/.kimi-code/config.toml` (`KIMI_CODE_HOME` relocates it) — every Kimi
session on this machine emits while the block is present, and a second
Kimi install sharing that home shares the hooks. Use a scratch project
for the session, and remove the fenced block (or restore the timestamped
backup) to detach.

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and Kimi Code CLI installed — the `kimi` binary on PATH, from the
  **scoped** npm package `@moonshot-ai/kimi-code` (the unscoped
  `kimi-code` package is an unrelated third party).
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

> **Quick path:** `node impl/setup/aep-setup.js up kimi-code` in the
> reference repo automates this section (registration via
> `write kimi-code`, backed up and idempotent) — see
> [Quick setup](README.md#quick-setup-automated). The steps below stay
> canonical.

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the adapter daemon (same token)
AEP_TOKEN=<token> node impl/adapter-kimi-code/adapter.js &

# 3 — register the hooks: appends a marker-fenced [[hooks]] block
#     (all 16 events; PreToolUse timeout raised to 60 for beat 5) at the
#     END of the global config.toml, timestamped backup first, idempotent
node impl/setup/aep-setup.js write kimi-code

# 4 — start Kimi in a scratch project
kimi
```

If you ever hand-edit `config.toml`, never add a top-level key BELOW
the `[[hooks]]` tables — TOML parses it into the last table and Kimi
then drops the whole hooks section with a warning. The setup writer
appends its fenced block at the end of the file for exactly this
reason, and a re-run refreshes a stale fence in place.

**Verify end-to-end, in order:** (1) `curl http://127.0.0.1:8398/healthz`
→ wait for `relay: true`; (2) submit any prompt in Kimi — a `kimi-code`
lane must appear in Fleet within a few seconds. If the daemon is
healthy but no lane appears, the hooks are not loading in your Kimi
build: the registration recipe is live-validated against the shipped
0.28.1, so a silent lane on a newer build points at a vendor change.
Record your Kimi version (`kimi --version`) and your `config.toml`
hooks block, and stop; that record IS the result.

The shim (`kimi-hook.js`) forwards stdin to the daemon on
`127.0.0.1:8398` and fails open: daemon down or slow means exit 0 with
no output, so a dead observer never breaks Kimi (and also never errors
visibly — silence plus no lane means not-loaded, not broken). One
scope note for beat 3: **headless runs (`kimi -p`) force permission
"auto"**, so the permission pair only fires in the interactive TUI —
drive this whole guide interactively.

Useful knobs: `AEP_ADAPTER_PORT` (default 8398), `AEP_CAPTURE` (default
`metadata`), `AEP_CAPTURE_ATTENTION` (default `redacted`),
`AEP_ATTENTION_TIMEOUT_MS` (default **50 000** — deliberately inside
the 60 s PreToolUse hook timeout the setup writer registers; raise both
together or the vendor kills the held gate first), `AEP_KIMI_CONTROL`
(the gate, default OFF — beat 5 exercises both sides),
`AEP_KIMI_GATE_TOOLS` (comma-separated tool-name scope for the gate),
`AEP_INSTRUCT` (the steering verb, default OFF).

## The guided script

Work in a scratch directory. Find your lane in Fleet by agent name:
**kimi-code**.

### 1 — Lifecycle

- [ ] Start `kimi` and submit a short prompt.
  **Expect:** a `kimi-code` lane appears in Fleet (`session.started`,
  `trigger: "startup"`), and the prompt opens a run (`run.started`). No
  turn id exists at this boundary, so the adapter synthesizes one AEP
  run per prompt. (The vendor delivers the prompt as a content-part
  array; at the default capture no prompt text rides.)
- [ ] Let the turn finish.
  **Expect:** `run.finished` closes the run (the `Stop` hook),
  cause-linked to its `run.started`. A provider failure instead lands
  `run.failed` with the vendor's `error_type` as the reason
  (`StopFailure` — this surface has the failure twin).
- [ ] Quit Kimi.
  **Expect:** `session.ended` with reason `"normal"` — the vendor's
  own reason value is `"exit"` and the adapter normalizes it to the
  schema enum. A still-open run drains as `run.cancelled` first.

### 2 — Tool pair, and the failure twin

- [ ] Ask for something tool-shaped and harmless: *"list the files in
  this directory"*.
  **Expect:** `tool.requested` → `tool.completed` pairs in the session
  Timeline, exactly paired via the vendor's `tool_call_id` and
  cause-linked. At the default capture only args/result digests ride.
- [ ] Make a tool fail: *"read the file ./does-not-exist.txt"*.
  **Expect:** a real `tool.failed` — `PostToolUseFailure` exists on
  this vendor, so a failed call gets an honest terminal (the error type
  at `error.type`), not silence. Watch the severity heat on the lane
  pick it up.

### 3 — The permission pair: observe, don't answer (default posture)

Kimi's own TUI prompt is the answer surface here: the request declares
`respond_via: ["oob"]` with **no options claimed**, so Mission Control
renders it as information — no send affordance, by design.

- [ ] Trigger an approval moment (an action Kimi asks you to approve)
  and **approve it in Kimi's TUI**.
  **Expect:** `attention.requested` (kind `permission`, cause-linked to
  its `tool.requested`) renders as an observed card; then
  `attention.answered` with `option: "approved"` (the label you picked
  rides at metadata) and the `attention.resolved` terminal; the tool
  proceeds to `tool.completed`.
- [ ] Trigger another and **reject it in Kimi's TUI**.
  **Expect:** `attention.answered` with `option: "rejected"` (any
  feedback text you typed is capture-gated), **plus `tool.denied` with
  `by: "runtime"`** cause-linked to the answer — the enforcement fact
  lands on the stream. No `tool.completed` ever arrives for that call.
- [ ] If you dismiss a prompt without deciding (Esc on the dialog),
  **expect** `attention.resolved` with `resolution: "dismissed"` — no
  answer is invented.

### 4 — Interrupt: Esc is the vendor's own cancel moment

- [ ] Submit a prompt that will run for a while, then press **Esc** in
  Kimi mid-run.
  **Expect:** `run.cancelled` with `by: "user"` — the vendor fires its
  `Interrupt` hook for exactly this moment (user cancellation only), so
  the terminal is the vendor's own fact, no drain heuristic involved.
- [ ] With a run active, press **Cancel run** on the lane in Mission
  Control.
  **Expect:** the confirm dialog, then an inline `cancel failed:` nack —
  this adapter never accepts `control.cancel` (the relay refuses it
  sender-side on the daemon's behalf). The agent stays sovereign; like
  the other guides, this refusal is the correct result, not a bug.

### 5 — Opt-in: the held gate, then steering

Restart the daemon with `AEP_KIMI_CONTROL=1` (its `hello` now declares
`control.attention.respond`):

- [ ] Drive a tool call.
  **Expect:** the attention dock gains an answerable card
  (`attention.requested`, kind `permission`, options **Allow / Deny** —
  the vendor surface is binary, no ask tier), cause-linked to its own
  `tool.requested`, held up to 50 s.
- [ ] Answer **deny with free text** from Mission Control: e.g. *"use
  the scratch directory instead"*.
  **Expect:** the card settles (`attention.answered`,
  `attention.resolved`); the stream gains `tool.denied` with
  `by: "policy"`; and **your reason text renders in Kimi's own TUI**
  where the model reads it. On permission gates, free text that is not
  an option word is a deny with your words as the reason (AEP-0008).
- [ ] On a fresh gate, answer **allow**.
  **Expect:** the card settles and the hook frees — but allow is only
  "no hook objection": **Kimi's own permission prompt may still
  appear** for the same call (the dual-gate posture), and if it does,
  beat 3's observed pair records that second, vendor-side answer too.
  Record the order you see.
- [ ] Let one gate time out (do not answer for 50 s).
  **Expect:** `attention.timeout` on the stream and Kimi proceeding
  through its normal flow — fail-open, the agent is never wedged.

Now restart with `AEP_INSTRUCT=1` (with or without the gate):

- [ ] Without the env set (earlier in the session), pressing **Steer**
  would earn an inline `refused: … unsupported` — the verb is absent
  from `hello`, so the relay refuses sender-side. If you have not seen
  it yet, try once before restarting.
- [ ] With `AEP_INSTRUCT=1`, press **Steer** in the session header and
  send something visible, then submit your next prompt in Kimi.
  **Expect:** the composer settles "accepted"; the queued text delivers
  on that next prompt's hook reply as a context message — the vendor
  wraps hook stdout in a hook_result block appended as a user message,
  its ONE context-accepting reply surface. Whether and how the model
  honors it is exactly the fact to record. Queue caps: 20 commands,
  4000 chars.
- [ ] Steer once more, then quit Kimi without submitting another
  prompt.
  **Expect:** the leftover instruction drops at `SessionEnd` with
  reason "session-ended" (the Claude Code rule) — it never leaks into
  a later session.

Extra credit: run replay/resume (close the tab mid-session, generate
events, reopen — lanes rebuild with no gaps; window the Timeline with
the replay slider, then **Back to live**). A long session that compacts
lands `session.compacted` at the **post** moment (the pre moment
degrades to `x.kimi-code.session.pre_compact`, never drops). A
background task's status arrives as `progress.status` — on this vendor
`Notification` is task status only, never an attention loop. Subagent
work pairs up as `delegation.subagent.started` / `.stopped` with the
subagent name as subject.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle: start / finish / session end normalized |  |  |
| 2 | Tool pair via tool_call_id / honest tool.failed |  |  |
| 3 | Permission pair observed: approved / rejected + tool.denied by runtime / dismissed |  |  |
| 4 | Esc → run.cancelled by user / Cancel-run nack |  |  |
| 5 | Held gate: free-text deny rendered in the TUI + tool.denied by policy, allow dual-gate, timeout; steering: delivery + session-end drop |  |  |

## Reset & re-run

Ctrl-C the adapter and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The adapter's
per-session JSONL logs live under `~/.aep/logs/kimi-code/`; keep them —
they are the capture evidence for anything you file. To detach Kimi
entirely, remove the marker-fenced `[[hooks]]` block from the global
`config.toml` (or restore the timestamped backup the writer made) —
remember the registration is global, not per-project. Mission Control's
saved positions live in the browser's `localStorage` per relay URL; a
fresh browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh interactive Kimi session once the hooks are
registered — the session under observation can drive its own script:

```text
You are the agent under observation in a guided live session. A relay,
the Kimi Code hook adapter, and Mission Control are already running;
the global hooks are registered, so everything you do lands on an event
stream a tester is watching.

Work through these steps, pausing after each so the tester can check
the stream. Use a scratch directory. Announce each step before you do
it.

1. Acknowledge this prompt (that already opened the session and a run).
2. List the files in the current directory with a tool call.
3. Try to read ./does-not-exist.txt so one tool call fails — this
   surface reports a real, typed tool failure; tell the tester what
   error you saw.
4. Do something that triggers a permission prompt and WAIT — the tester
   will tell you whether they are approving/rejecting it here in your
   TUI (observe mode) or answering a held gate from Mission Control
   (control mode). On a deny, report the reason text you received.
5. Start something long-running and keep going until the tester
   interrupts you with Esc; note what you experienced.
6. If the tester says STEERING is enabled: pause, wait for their go,
   then acknowledge your next prompt and report exactly what extra
   context arrived with it and how you treated it.
7. Report a short summary the tester can paste into the guide's results
   table: for each step, what you did and whether the round-trip
   behaved as described.

Be honest about anything that did not match; mismatches are the point
of the session.
```
