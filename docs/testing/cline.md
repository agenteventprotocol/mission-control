# Guided session — Cline

Observes a real Cline session through the reference hook adapter
(`reference/impl/adapter-cline/`). The surface is Cline's SUBPROCESS
hook generation — ten zod-typed events published in
`@cline/shared@0.0.59` — and this is the strongest cancel/error visibility
of any hook adapter in this repo: `agent_abort` and `agent_error` are
**real, vendor-distinguished terminals**, not inferred ones.

**Verification status: types-verified + fixture-proven, live-session
validation pending. The hub control leg (beat 6) is smoke-proven
against stub hubs speaking the pinned protocol frames — live pending.**

**Respond / cancel / send-input from Mission Control: opt-in** — the
daemon is observe-only by default (no typed hook moment is answerable;
approvals ride the vendor's own hub channel), and beats 3–4 exercise
exactly that honest refusal. With `AEP_CLINE_HUB_CONTROL=1` the daemon
taps the hub: approvals become answerable attention, **Cancel run**
becomes a true vendor-side abort — the first in this fleet — and the
composer offers **Send input** (beat 6).

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and Cline installed.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup — a token is not required
  for this surface's own traffic, but keep the relay tokened so the rest
  of your fleet stays controllable).

## Bring the stack up

> **Quick path:** `node impl/setup/aep-setup.js up cline` in the reference
> repo automates this section (registration via `write cline`, backed up
> and idempotent) — see [Quick setup](README.md#quick-setup-automated).
> The steps below stay canonical.

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the adapter daemon (same token)
AEP_TOKEN=<token> node impl/adapter-cline/adapter.js &

# 3 — land the per-event hook copies in your working project (backed up
#     + idempotent). Cline's loader dispatches by FILENAME — one
#     executable copy per hook event name (TaskStart.js, PreToolUse.js,
#     …) in .clinerules/hooks/, the one dir BOTH the CLI and the VS Code
#     extension search. A generically-named copy is silently skipped.
node impl/setup/aep-setup.js write cline --project-dir <your-project-dir>
ls <your-project-dir>/.clinerules/hooks/    # ten <Event>.js files
```

**Step 4 — make your Cline actually load those hooks.** This is the one
step the setup tool cannot do for you, and it depends on how you run
Cline (the files existing does NOT prove Cline loads them):

- **Cline CLI**: launch from the project directory (the loader searches
  the workspace's `.clinerules/hooks/` and `.cline/hooks/`), or point it
  explicitly — `cline --hooks-dir <your-project-dir>/.clinerules/hooks`.
  (No `CLINE_HOOKS_DIR` env var exists in the shipped build — the flag
  is the CLI's only explicit override.)
- **VS Code extension**: open `<your-project-dir>` as the workspace
  folder AND enable the extension's **Hooks** setting — it ships OFF by
  default, and the extension reads only the workspace's
  `.clinerules/hooks/`.

**Verify end-to-end, in order:** (1) `curl http://127.0.0.1:8392/healthz`
→ wait for `relay: true`; (2) start any Cline task — a `cline` lane must
appear in Fleet within a few seconds. If the daemon is healthy but no
lane appears, the hook is not loading in your Cline build: this surface
is **live-pending** (no live run has pinned the loader recipe per build
yet), so record your Cline version + how you launch it and stop — that
record IS the result.

The hook POSTs to the daemon on `127.0.0.1:8392` (`AEP_ADAPTER_PORT`
changes it). The hook script reads stdin JSON, forwards
it, and always prints an empty object and exits 0 — strictly fail-open,
so a dead or slow daemon never breaks Cline (and also never errors
visibly: silence + no lane means not-loaded, not broken).

Useful knob: `AEP_HOOK_TIMEOUT_MS` (default 1 500, shim-side) — the
forward is bounded so the agent never waits on a slow observer.
`AEP_CAPTURE` (default `metadata`) gates args/output digests vs redacted
content.

For beat 6 you will restart the daemon with the hub leg enabled:

```sh
cline hub ensure        # starts the vendor's hub daemon, prints its URL
# the bearer token lives in the discovery JSON under
# ~/.cline/locks/hub/ (owner-scoped; the file carries url + authToken)

AEP_TOKEN=<token> AEP_CLINE_HUB_CONTROL=1 \
  AEP_CLINE_HUB_DISCOVERY=<path-to-discovery.json> \
  node impl/adapter-cline/adapter.js &
# or AEP_CLINE_HUB_URL=ws://127.0.0.1:25463/hub AEP_CLINE_HUB_TOKEN=<hub token>
```

`healthz` then reports `{ ok, relay, hub }` — wait for `hub: true`.
`AEP_CLINE_HUB=1` alone gives the tap without the verbs (approvals
mirror as observation-only attention). The adapter never auto-hunts
discovery paths — you point it at the file.

## The guided script

Work in a scratch directory. Find your lane in Fleet by agent name:
**cline**.

### 1 — Lifecycle

- [ ] Start a Cline task and submit any prompt.
  **Expect:** a `cline` lane appears in Fleet (`session.started` — the
  vendor `taskId` is the AEP session), and `agent_start` opens a run
  (`run.started`, `trigger: "user"`) — the run id is adapter-minted,
  since the subprocess payload carries no vendor run id.
- [ ] Let the turn finish.
  **Expect:** `agent_end` closes the run (`run.finished`).
- [ ] Resume a prior task if Cline offers it.
  **Expect:** `agent_resume` opens a run with `trigger: "resume"` instead
  of `"user"` — a real distinction this surface makes that most hook
  adapters cannot.

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless: *"list the files in
  this directory"*.
  **Expect:** `tool.requested` → `tool.completed` pairs in the session
  Timeline, matched by the typed call id and `cause`-linked (the Causal
  graph draws the edge). `durationMs` rides as metadata.
- [ ] Make a tool fail: *"read the file ./does-not-exist.txt"*.
  **Expect:** a real `tool.failed` — the typed `ToolCallRecord.error`
  field makes Cline **the first plugin-generation vendor this project can
  emit an honest tool.failed for**, not a session-scoped fallback. Watch
  the severity heat on the lane pick it up.

### 3 — Attention: observe, don't answer (default posture)

- [ ] With the daemon in its default posture (no hub envs), trigger an
  approval moment in Cline (an action it asks you to approve) and
  **answer it in Cline itself** — Mission Control has no respond
  affordance to offer here, by design: a control surface the runtime
  cannot honor would be a lie, so none renders.
  **Expect:** watch the stream for whatever the subprocess hooks
  surface about the moment — record exactly what arrives (or does not)
  in the results table. This is an observation task: the point is to
  pin down what a vendor-side approval decision looks like on the wire
  for this surface. (Beat 6 flips this: the hub leg makes the same
  moment an answerable `attention.requested`.)

### 4 — Cancel (default posture)

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:` nack —
  gated off, this daemon declares `control.accepts: []` (read-only), the
  relay refuses `control.cancel` sender-side on its behalf (AEP-0004
  §4.2), and Mission Control surfaces the refusal exactly where you
  clicked. The agent stays sovereign; this is the correct result, not a
  bug.
- [ ] Abort the task on the Cline side instead.
  **Expect:** `agent_abort` → a **true, cause-linked `run.cancelled`**
  with `data.by: "user"` — the vendor distinguishes an explicit abort
  from an error, and this adapter passes that distinction straight
  through. This is the best cancel visibility of any hook adapter here:
  what you triggered vendor-side is exactly what the run's terminal
  says.
- [ ] Force an error terminal instead (if you have a repeatable one).
  **Expect:** `agent_error` → `run.failed` carrying the typed error name
  in `data.reason` — not a generic failure string.
- [ ] End the session.
  **Expect:** `session_shutdown` → `session.ended`.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in a fresh
  Cline task. Reopen the tab.
  **Expect:** lanes rebuild from the persisted `(session, epoch, seq)`
  positions with no gaps — the events emitted while you were away are
  there.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back and
  follows.

### 6 — Hub control (opt-in) — smoke-proven, live pending

Restart the adapter daemon with `AEP_CLINE_HUB_CONTROL=1` (see "Bring
the stack up"; wait for `hub: true` on `healthz`). Everything below is
smoke-proven against stub hubs speaking the pinned protocol frames; a
live Cline session has not yet validated it — mismatches here are
exactly what this beat exists to find, starting with the session-id
equality the leg rides on (the hub session id and the hooks' `taskId`
must name the same task, or the mirrored attention lands in a separate
lane).

- [ ] Trigger an approval moment in Cline again.
  **Expect:** the same moment now lands as an answerable
  `attention.requested` (kind `permission`, Approve/Deny) in the
  attention dock, on the same `cline` lane the hooks own. At the default
  `metadata` capture the prompt names the tool, never the tool's input.
- [ ] Answer **Approve** from the dock (add a note — it rides as the
  vendor `reason`).
  **Expect:** the runtime proceeds with the tool call;
  `attention.answered { via: "control" }` cause-linked to your command,
  then `attention.resolved { resolution: "answered" }` in the Timeline.
- [ ] Trigger one more approval and answer it **in Cline itself**.
  **Expect:** the dock item settles anyway —
  `attention.answered { via: "oob" }`: the vendor's own surface answered
  the same hub loop, and the mirror says so honestly.
- [ ] With a run active, press **Cancel run**.
  **Expect:** a true vendor-side cancel — the first in this fleet: the
  daemon acks, drives the hub's `run.abort`, Cline actually stops, and
  the terminal is the vendor's own `agent_abort` hook fact —
  `run.cancelled` **cause-linked to your command** in the Timeline (the
  Causal graph draws the edge to the command, not to `run.started`).
- [ ] Press **Send input** in the session header (the composer the Steer
  button becomes on a `cline` lane) and send a short instruction.
  **Expect:** the dialog says user-plane input, not advisory steering —
  Cline queues it as a pending prompt (`delivery: "queue"`); the
  composer settles "accepted", a cause-linked `x.cline.input.sent`
  lands in the Timeline, and the text arrives as the session's next
  user input. This is deliberately a different verb from the steering
  family (`x.cline.control.send_input`): watch what the session does
  with it and record it.
- [ ] End the Cline session with an approval still pending (if you can
  stage one).
  **Expect:** `attention.resolved { resolution: "dismissed" }` lands
  BEFORE `session.ended` — the terminal is owed, never dropped.

Capability truth here is **observed, never declared**: emitter
capabilities are not consumer-visible in 0.1, so Mission Control offers
affordances send-and-settle and surfaces refusals in place. The session
view's **Control** tab is the record of exactly that — each verb this
Mission Control has sent on the lane with its last settle
(`accepted` / `refused · reason`, untried otherwise). Check it after
the sends above; it never claims anything a send has not proven.

Extra credit: `pre_compact` fires as the vendor's only exposed (PRE)
moment — `session.compacted` lands *before* compaction actually happens
here, a documented deviation from adapters that only announce it after.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle: start / finish / resume |  |  |
| 2 | Tool trio: pairing / honest tool.failed |  |  |
| 3 | Attention: observed vendor-side decision |  |  |
| 4 | Cancel: nack, true run.cancelled, run.failed, session end |  |  |
| 5 | Replay / resume |  |  |
| 6 | Hub control: answered approval (control + oob), vendor-side cancel cause-linked, send input, dismissal terminal |  |  |

## Reset & re-run

Ctrl-C the adapter and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The adapter's per-session
JSONL logs live under `~/.aep/logs/cline/`; keep them — they are the
capture evidence for anything you file. Remove the hook entry from
Cline's loader configuration to detach it entirely. Mission Control's
saved positions live in the browser's `localStorage` per relay URL; a
fresh browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh Cline session that has the hook registered — the
session under observation can drive its own script:

```text
You are the agent under observation in a guided live session. A relay,
the Cline hook adapter, and Mission Control are already running; your
hook script is registered, so everything you do lands on an event stream
a tester is watching.

Work through these steps, pausing after each so the tester can check the
stream. Use a scratch directory. Announce each step before you do it.

1. Acknowledge this prompt (that already opened the session and a run).
2. List the files in the current directory with a tool call.
3. Try to read ./does-not-exist.txt so one tool call fails — this
   surface can report a real, typed tool failure, so tell the tester
   what error you saw.
4. Do something that triggers an approval prompt, and handle it
   YOURSELF — in the default posture the tester cannot answer this one
   from Mission Control. Note what the approval looked like on your
   side.
5. When the tester tells you to, abort the current task from your own
   side (not the tester's) so they can watch for a true run.cancelled;
   note what you did to trigger it.
6. If the tester says the HUB CONTROL LEG is enabled: trigger another
   approval prompt and WAIT — the tester answers it from Mission
   Control this time. Note whether your runtime honored their decision
   (and, on a deny, what reason text you saw). Then pause and wait
   again: the tester will send you input remotely — report exactly what
   arrived and how you treated it. Finally, keep a task running so the
   tester can cancel it from their side; confirm whether you actually
   stopped.
7. Report a short summary the tester can paste into the guide's results
   table: for each step, what you did and whether the round-trip
   behaved as described.

Be honest about anything that did not match; mismatches are the point of
the session.
```
