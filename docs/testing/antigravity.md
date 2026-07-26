# Guided session — Antigravity

Observes a real Antigravity session through the reference hook adapter
(`reference/impl/adapter-antigravity/`). The surface is the five-hook
`hooks.json` command system **shared by Antigravity 2.0 and the
Antigravity CLI** (only the app data directory differs), pinned against
the **official hooks documentation** plus the vendor's public changelog
— the binary is closed, so the docs page and the changelog are the
drift watch. **Observe-only by design**: the required `PreToolUse`
decision is answered with the vendor's own no-opinion value
(`{"decision": ""}`), `Stop` never returns `"continue"`, and the
invocation pair never injects.

**Respond from Mission Control: no** — approval outcomes are not
hook-visible on this surface at all; nothing maps to `attention.*` or
`tool.denied`, stated rather than papered over.

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and Antigravity 2.0 or the Antigravity CLI installed — **minimum CLI
  1.0.16** (that release's changelog pins the safely-handled empty
  decision string this adapter's neutrality depends on).
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

> **Quick path:** `node impl/setup/aep-setup.js up antigravity` in the reference
> repo automates this section (registration via `write antigravity`, backed up
> and idempotent) — see [Quick setup](README.md#quick-setup-automated).
> The steps below stay canonical.

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the adapter daemon (same token)
AEP_TOKEN=<token> node impl/adapter-antigravity/adapter.js &

# 3 — register the shim once per event in hooks.json
# (workspace .agents/hooks.json or global ~/.gemini/config/hooks.json),
# matcher "*" on the tool pair, EACH entry passing its own event name
# as the argument — no Antigravity payload names its own event, so the
# registration itself is the discriminator. Use absolute paths (the
# vendor resolves relative paths against the launch directory). The
# header of impl/adapter-antigravity/antigravity-hook.js carries the
# exact registration snippet to copy.
```

The daemon listens on `127.0.0.1:8395` (`AEP_ADAPTER_PORT` changes it).
Check `GET http://127.0.0.1:8395/healthz` → `{ ok, relay }` and wait for
`relay: true`. The shim is strictly fail-open (exit 0 always): with the
daemon down, Antigravity behaves as if unhooked.

Useful knobs: `AEP_CAPTURE` (default `metadata`), `AEP_LOG_DIR`.
Shim-side: `AEP_ADAPTER_URL` · `AEP_HOOK_TIMEOUT_MS` (default 1500 —
bounded well under the vendor's 30 s handler timeout so the agent never
waits on a slow observer).

## The guided script

Work in a scratch directory. Find your lane in Fleet by agent name:
**antigravity**.

### 1 — Lifecycle

- [ ] Start an Antigravity session and submit any prompt.
  **Expect:** an `antigravity` lane appears in Fleet (`session.started`
  on first sight, keyed on `conversationId`). The run is synthesized —
  it opens at the first invocation boundary, not from a dedicated start
  hook.
- [ ] Let the turn finish.
  **Expect:** `run.finished` (`model_stop` or `max_steps_exceeded` as
  metadata — a bounded termination is still a completion) from `Stop`'s
  typed `terminationReason`. A model-side error would land `run.failed`
  instead.

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless.
  **Expect:** `tool.requested` on `PreToolUse` (name + `step_idx`, the
  join key), then `tool.completed` on the joined `PostToolUse` — paired
  in the session Timeline, `cause`-linked. Watch `run.step.started` /
  `run.step.finished` land alongside from the invocation pair
  (`invocationNum` sets the envelope step) — the session detail **State**
  tab is the expect for reconstructing these.
- [ ] Make a tool fail.
  **Expect:** `tool.failed` from the joined `PostToolUse`'s non-empty
  `error` (the vendor's own error fact; message redacted+).
- [ ] Optional: watch for an unjoined or dangling case as you work.
  **Expect:** an unjoined completion falls back honestly to
  `x.antigravity.step.completed` (step index + outcome only — a tool
  name is never invented). A dangling `PreToolUse` with no matching
  completion synthesizes **nothing** — denied, rejected, and
  still-running are indistinguishable here; record whichever you see.

### 3 — Attention: honest absence

- [ ] Trigger an approval in the Antigravity UI (its own
  `ask_permission`-style interaction).
  **Expect:** **nothing lands on `attention.*`, and no `tool.denied`
  appears.** This is the documented correct result, not a missing
  feature — approval outcomes are not hook-visible on this
  surface. The vendor's interaction tools are observed only as ordinary
  tool calls; their outcomes are not exposed.
- [ ] Confirm the absence: check the session Timeline and the Attention
  center after the approval — record that nothing appeared there.

### 4 — Cancel

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:` nack —
  this adapter declares no control commands, so the relay nacks
  `control.cancel` on Antigravity's behalf. The agent stays sovereign;
  this is the correct result, not a bug.
- [ ] Interrupt the turn on the Antigravity side instead, and **record
  what lands** — the mapping documents `Stop`'s two terminals
  (`run.finished` / `run.failed`); what a vendor-side interrupt actually
  produces live is exactly the kind of fact this session exists to pin
  down.
- [ ] Try to end the session from the Antigravity side.
  **Expect:** **no session end lands** — the surface exposes neither a
  session-end nor a compaction hook, so the lane never flips to ended.
  That is correct for this surface, not a bug; state it as such in your
  results.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in a fresh
  Antigravity session. Reopen the tab.
  **Expect:** lanes rebuild from the persisted `(session, epoch, seq)`
  positions with no gaps — the events emitted while you were away are
  there.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back and
  follows.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle |  |  |
| 2 | Tool trio: completed / failed / unjoined / dangling |  |  |
| 3 | Attention: honest absence |  |  |
| 4 | Cancel: nack, vendor interrupt, no session end |  |  |
| 5 | Replay / resume |  |  |

## Reset & re-run

Ctrl-C the adapter and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The adapter's per-session
JSONL logs live under `~/.aep/logs/antigravity/` — keep them; they are
the capture evidence for anything you file. Remove the hook entries
from `hooks.json` to detach Antigravity entirely. Mission Control's
saved positions live in the browser's `localStorage` per relay URL; a
fresh browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh Antigravity session that has the hooks
registered — the session under observation can drive its own script:

```text
You are the agent under observation in a guided live session. A relay,
the Antigravity hook adapter, and Mission Control are already running;
your hooks are registered, so everything you do lands on an event
stream a tester is watching.

Work through these steps, pausing after each so the tester can check
the stream. Use a scratch directory. Announce each step before you do
it.

1. Acknowledge this prompt (that already opened the session and a run,
   synthesized at your first tool invocation).
2. Do something tool-shaped and harmless with a tool call.
3. Try an action that fails as a tool call, so one tool call fails.
4. Trigger your own approval/permission interaction, and WAIT — the
   tester CANNOT answer this from Mission Control on this surface, and
   nothing about the outcome will appear there either. Resolve it
   yourself and note in one line what the tester should NOT expect to
   see (no attention card, no denial event).
5. Stop and wait while the tester interrupts you mid-turn on their
   side; afterwards, note whether you finished normally, failed, or
   were cut off, and what you experienced.
6. Report a short summary the tester can paste into the guide's
   results table: for each step, what you did and whether the
   round-trip behaved as described.

Be honest about anything that did not match; mismatches are the point
of the session.
```
