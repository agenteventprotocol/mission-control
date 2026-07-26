# Guided session — VS Code agent (Copilot)

Observes the VS Code agent (Copilot) through the reference hook adapter
(`reference/impl/adapter-vscode/`). VS Code's **agent hooks (Preview)**
adopt the Claude Code hook contract — the eight VSCode-target lifecycle
events arrive with CC-identical snake_case payloads over `command`
hooks — **documented + fixture-proven against the pinned vendor source,
live-session validation pending.** Agent hooks are Preview: if a beat
below does not match, record it — the format may have moved (the
adapter's README carries the source pins to re-check against).

**Respond from Mission Control: opt-in** — the held PreToolUse
permission gate (`AEP_VSCODE_CONTROL=1`, beat 3; smoke-proven, live
pending) on the vendor's own three-decision surface: allow / deny /
**ask** (ask escalates to VS Code's own user-approval flow — this
surface's unique third option).
**Steer from Mission Control: opt-in** — `AEP_INSTRUCT=1` on the daemon
ships `x.vscode.control.instruct` (beat 6; smoke-proven, live pending):
queued text rides `hookSpecificOutput.additionalContext` on the next
eligible hook reply — five source-settled moments.

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and VS Code with the Copilot agent and **agent hooks (Preview)**
  available — check the vendor's hooks page
  (`code.visualstudio.com/docs/agent-customization/hooks`) for the
  current enablement state in your build.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

> **Quick path:** `node impl/setup/aep-setup.js write vscode` **run from
> the workspace you'll drive VS Code in** (the registration is
> workspace-native — it writes `.github/hooks/aep.json` in the current
> directory), then `node impl/setup/aep-setup.js up vscode` — see
> [Quick setup](README.md#quick-setup-automated). The steps below stay
> canonical.

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the adapter daemon (same token; capture level to taste)
AEP_TOKEN=<token> AEP_CAPTURE=metadata node impl/adapter-vscode/adapter.js &

# 3 — register the hooks in the WORKSPACE you will drive
# merge impl/adapter-vscode/hooks.example.json into
# <workspace>/.github/hooks/aep.json (fix the shim path)
```

All eight events run the command shim (`vscode-hook.js`), which forwards
stdin JSON to the daemon on `127.0.0.1:8381` and relays the reply. Check
`GET http://127.0.0.1:8381/healthz` → `{ ok, relay }` and wait for
`relay: true` — that is the daemon's WebSocket binding to the relay
going live. The path fails open: with the daemon down, VS Code behaves
as if unhooked.

A workspace already carrying Claude Code hooks in
`.claude/settings.json` ALSO fires them under the VS Code agent
(VS Code parses that file natively, read-only) — but those events land
on the **Claude Code** daemon under the `claude-code` lane, the wrong
identity for Copilot sessions. For this session, use the
workspace-native file above so the lane reads **vscode**.

Useful knobs: `AEP_ADAPTER_PORT` (default 8381), `AEP_CAPTURE` (default
`metadata`), `AEP_CAPTURE_ATTENTION` (default `redacted`),
`AEP_ATTENTION_TIMEOUT_MS` (default **25 000** — deliberately under the
vendor's 30 s hook `timeout`; raise both together or the held gate gets
killed by the vendor first), `AEP_VSCODE_CONTROL` (the permission gate,
default OFF — beat 3 exercises both sides), `AEP_VSCODE_GATE_TOOLS`
(comma-separated tool-name scope for the gate), `AEP_INSTRUCT` (the
steering verb, default OFF — beat 6 exercises both sides).

## The guided script

Work in a scratch workspace. Find your lane in Fleet by agent name:
**vscode**.

### 1 — Lifecycle

- [ ] Start an agent session in VS Code and submit any prompt.
  **Expect:** a `vscode` lane appears in Fleet (`session.started`, with
  the model and the agent/mode name at metadata), and the prompt opens
  a run (`run.started` from `UserPromptSubmit`). No turn id exists on
  this vendor, so the adapter synthesizes one AEP run per prompt/`Stop`
  pair.
- [ ] Let the turn finish.
  **Expect:** `run.finished` closes the run (`Stop` hook),
  cause-linked to its `run.started`. **There is no failure twin on
  this surface** — a failed turn lands nothing (`StopFailure` and
  `ErrorOccurred` exist only in the coding-agent hook format, not the
  VS Code one). If you see anything else, record it.

### 2 — Tools, and the honest absence

- [ ] Ask for something tool-shaped and harmless: *"list the files in
  this directory"*.
  **Expect:** `tool.requested` → `tool.completed` pairs in the session
  Timeline, exactly paired via `tool_use_id` and `cause`-linked. At the
  default capture only the args/result digests ride along.
- [ ] Make a tool fail: *"read the file ./does-not-exist.txt"*.
  **Expect — and this is the beat:** the `tool.requested` lands and
  then **nothing**. `PostToolUse` fires on SUCCESS ONLY on this
  surface, so `tool.failed` has no vendor moment — the request
  never completes on the stream. This documented absence is exactly
  the kind of live fact to confirm (or refute) and record.

### 3 — Attention: the opt-in gate, both sides

First, the DEFAULT posture (daemon running **without**
`AEP_VSCODE_CONTROL`):

- [ ] Drive any tool call and watch the Timeline.
  **Expect:** `tool.requested` flows immediately; **no attention
  request appears** — observe-only is the default, the hook reply is
  instantly empty, and VS Code's own approval UX (where a tool needs
  one) proceeds untouched.

Now restart the daemon with `AEP_VSCODE_CONTROL=1` (its `hello` now
declares `control.attention.respond`):

- [ ] Drive a tool call.
  **Expect:** the attention dock slides in (`attention.requested`, kind
  `permission`, **three options: Allow / Deny / Ask the user in VS
  Code**), cause-linked to its own `tool.requested`; the fleet card
  grows the inline quick-answer strip.
- [ ] Answer **allow**.
  **Expect:** the card settles (`attention.answered`,
  `attention.resolved`) and the tool proceeds — `tool.completed`
  follows. The decision reached the held hook, not just the log.
- [ ] Type the word `allow`, `deny`, or `ask` (any case) into the reply
  box on a fresh gate — no button click.
  **Expect:** the typed word IS the option (the AEP-0008 receiver
  rule): `attention.answered` records that `option` with no text
  residue, and the decision applies exactly as the clicked button —
  including a typed `ask` escalating to VS Code's own approval dialog.
- [ ] On the next gate, answer with **free text** that is NOT an option
  word (the dock's text reply): e.g. *"use the scratch directory
  instead"*.
  **Expect:** the reply denies with your text as the reason —
  VS Code renders the deny reason in chat where the model reads it —
  and the stream gains `tool.denied` (`by: "policy"`) cause-linked to
  the answer. No `tool.completed` ever arrives for that call. Free
  text is never an allow.
- [ ] On another gate, answer **ask**.
  **Expect:** the request settles as answered on the stream, and
  **VS Code's own approval dialog appears in the editor** — the ask
  tier hands the decision to the human in the editor. If they approve,
  `tool.completed` follows; if they deny there, nothing more lands
  (the success-only rule again).
- [ ] Let one gate time out (do not answer for 25 s).
  **Expect:** `attention.timeout` on the stream and VS Code proceeding
  through its normal flow — the adapter never blocks the agent beyond
  the window, and the window fits inside the vendor's own hook
  timeout.

### 4 — Cancel, and the absent session end

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:` nack —
  this adapter declares `control.attention.respond` at most (nothing
  at all with the gate off), the relay nacks `control.cancel` on its
  behalf, and Mission Control surfaces the refusal exactly where you
  clicked. The agent stays sovereign; this is the correct result, not
  a bug.
- [ ] Close the agent session / the VS Code window.
  **Expect — the other honest absence:** **no `session.ended`** — the
  VS Code hook target has no session-end event, so the lane never
  flips to ended on its own. Record what (if anything) lands.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in VS Code.
  Reopen the tab.
  **Expect:** lanes rebuild from the persisted `(session, epoch, seq)`
  positions with no gaps — the events emitted while you were away are
  there.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back and
  follows.

Extra credit: run a long session until the context compacts —
`session.compacted` lands at the **pre** moment (`PreCompact` is the
only compaction hook this surface has; the trigger value rides at
metadata). Delegate to a subagent (e.g. a planning agent) —
`delegation.subagent.started` / `.stopped` pair up with the subagent id
as subject.

### 6 — Steer (opt-in; smoke-proven, live pending)

The steering path is proven end to end by the adapter's own steering
smoke (relay-behalf refusal, delivery on each of the five moments, the
never-mix proof against the held gate, the re-ack discipline) — what a
**live** VS Code agent does with the injected context is still
unvalidated; that is what this beat pins down.

- [ ] With the daemon running **without** `AEP_INSTRUCT`, press
  **Steer** in the session header and send any instruction.
  **Expect:** an inline `refused: … unsupported` right in the composer —
  the verb is absent from the daemon's `hello`, so the relay refuses the
  command sender-side on the target's behalf (AEP-0004 §4.2).
  Observe-only is the default posture; like the cancel nack, this
  refusal is the correct result, not a bug.
- [ ] Restart the daemon with `AEP_INSTRUCT=1` (its `hello` now declares
  `x.vscode.control.instruct`) and steer again with something visible.
  **Expect:** the composer settles "accepted by the target", and on the
  session's next eligible hook reply — the five source-settled moments
  (`SessionStart`, `UserPromptSubmit`, `SubagentStart`, `PreToolUse`,
  `PostToolUse`; `PreCompact` has no reply surface on this vendor) —
  the Timeline gains a cause-linked
  `x.vscode.instruction.delivered { queued_ms }`. The daemon never
  echoes the instruction text onto the stream.
- [ ] Submit a prompt and watch the next turn.
  **Expect:** the text is added as context the model reads on its
  **next** request (vendor semantics; on tool moments it lands inside
  the tool result as a context tag). Whether and how the agent honors
  it is exactly the kind of fact to record.
- [ ] Steer while a session is idle, then close it on the vendor side.
  **Expect — the honest deviation:** **no drop event** — the VSCode
  hook target has no `SessionEnd`, so there is no session-end drop
  moment (unlike Claude Code and Qwen); the queue lives for the daemon
  lifetime, and a session that comes back delivers at latest on its
  next `UserPromptSubmit`. Record what you observe.

Extra credit (both gates): restart with `AEP_VSCODE_CONTROL=1
AEP_INSTRUCT=1`, queue an instruction, then drive a tool call so the
gate holds. **Expect:** the held reply carries ONLY your permission
decision — held loops never mix with steering — and the queued text
delivers on the next otherwise-empty eligible reply after the gate
settles.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle (incl. the absent run.failed) |  |  |
| 2 | Tools + the success-only absence |  |  |
| 3 | Attention: default off / allow / typed word / free-text deny / ask / timeout |  |  |
| 4 | Cancel nack + the absent session.ended |  |  |
| 5 | Replay / resume |  |  |
| 6 | Steer: refused off / delivered on / no session-end drop / never-mix |  |  |

## Reset & re-run

Ctrl-C the adapter and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The adapter's per-session
JSONL logs live under `~/.aep/logs/vscode/` — keep them; they are the
capture evidence for anything you file. Remove
`.github/hooks/aep.json` from the workspace to detach it entirely.
Mission Control's saved positions live in the browser's `localStorage`
per relay URL; a fresh browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh VS Code agent session in the workspace that has
the hooks registered — the session under observation can drive its own
script:

```text
You are the agent under observation in a guided live session. A relay,
the VS Code hook adapter, and Mission Control are already running; this
workspace's agent hooks are registered, so everything you do lands on
an event stream a tester is watching.

Work through these steps, pausing after each so the tester can check
the stream. Use a scratch directory. Announce each step before you do
it.

1. Acknowledge this prompt (that already opened the session and a run).
2. List the files in the current directory with a tool call.
3. Try to read ./does-not-exist.txt so one tool call fails — the tester
   is checking that NOTHING further lands for it on the stream.
4. Use another tool and WAIT — the tester may answer the held call from
   Mission Control (allow, a free-text deny whose reason you should
   see in chat, or an escalation to the editor's own approval dialog).
   Note in one line what you experienced.
5. Report a short summary the tester can paste into the guide's results
   table: for each step, what you did and whether the round-trip
   behaved as described.

Be honest about anything that did not match; mismatches are the point
of the session.
```
