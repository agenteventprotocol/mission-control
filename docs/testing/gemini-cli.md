# Guided session — Gemini CLI

Observes a real Gemini CLI session through the reference hook adapter
(`reference/impl/adapter-gemini-cli/`), specified from the vendor's
published hook documentation — **documented + fixture-proven,
live-session validation pending**.

**Respond from Mission Control: no** — Gemini CLI exposes no
human-in-the-loop hook. Its `Notification` hook is observability-only:
it can neither grant nor deny, so it never raises `attention.requested`
— a respond affordance the runtime cannot honor would be a lie, so none
renders here.

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and Gemini CLI installed.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup — a token isn't load-
  bearing for this surface since nothing here answers a command, but
  the shared setup assumes one).

## Bring the stack up

> **Quick path:** `node impl/setup/aep-setup.js up gemini-cli` in the reference
> repo automates this section (registration via `write gemini-cli`, backed up
> and idempotent) — see [Quick setup](README.md#quick-setup-automated).
> The steps below stay canonical.

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the adapter daemon (same token; capture level to taste)
AEP_TOKEN=<token> AEP_CAPTURE=metadata node impl/adapter-gemini-cli/adapter.js &

# 3 — register the hooks
# merge impl/adapter-gemini-cli/settings.example.json "hooks" object
# into your Gemini CLI settings.json (user or project scope)
```

The shim `gemini-hook.js` POSTs to the daemon on `127.0.0.1:8379`
(`AEP_ADAPTER_PORT` changes it; the shim reads `AEP_ADAPTER_URL` and
`AEP_HOOK_TIMEOUT_MS` if you need to point it elsewhere or retune its
timeout). Check `GET http://127.0.0.1:8379/healthz` → `{ ok, relay }`
and wait for `relay: true` — that is the daemon's WebSocket binding to
the relay going live. Gemini CLI runs only `type: "command"` hooks (one
JSON object on stdin, JSON on stdout, and stdout must otherwise stay
silent — the vendor's "golden rule"); the shim fails open, so a dead
daemon looks like silence, not breakage.

Useful knobs: `AEP_CAPTURE` (default `metadata`), `AEP_LOG_DIR` (default
`~/.aep/logs`).

## The guided script

Work in a scratch directory. Find your lane in Fleet by agent name:
**gemini-cli**.

### 1 — Lifecycle

- [ ] Start Gemini CLI and submit any prompt.
  **Expect:** a `gemini-cli` lane appears in Fleet (`session.started`),
  and the prompt opens a run (`run.started` from `BeforeAgent`). Gemini
  exposes no turn id, so the adapter synthesizes one AEP run per
  `BeforeAgent`/`AfterAgent` pair — the lane's run ribbon shows it
  active regardless.
- [ ] Let the turn finish.
  **Expect:** `run.finished` closes the run (`AfterAgent`), cause-linked
  back to its `run.started`.

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless: *"list the files in
  this directory"*.
  **Expect:** `tool.requested` → `tool.completed` pairs in the session
  Timeline (`BeforeTool` / `AfterTool`). Gemini exposes no call id, so
  pairing keys on `(session, tool)` rather than an id — the Causal
  graph still draws the edge. At the default capture only the args
  digest rides along.
- [ ] Make a tool fail: *"read the file ./does-not-exist.txt"*.
  **Expect:** an honest `tool.failed`, not a swallowed failure — when
  `AfterTool` carries `tool_response.error`, the mapping splits to
  `tool.failed` with `error.type` at metadata (`message` at
  `redacted`+), severity `error`. This is the split the vendor's own
  data supports, unlike sources with no failure hook at all.

### 3 — Attention: observe the vendor-side decision

- [ ] Trigger a permission moment (ask for an action Gemini CLI prompts
  on) and answer it **in the Gemini CLI dialog itself** — there is
  nothing to click in Mission Control for this step.
  **Expect:** no attention dock, no dock entry, no rail-bell count —
  by design. What you do see: a `progress.status` event (from
  `Notification`) as the vendor surfaces the moment, followed by the
  tool events that carry the outcome you chose. Watch the session
  Timeline for `progress.status` and the `tool.requested`/`tool.completed`
  pair that follows, and confirm the lane never grows a quick-answer
  strip. That absence is the fact this beat exists to demonstrate, not
  a bug to route around.

### 4 — Cancel

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:` nack —
  this adapter declares no control capabilities at all, the relay nacks
  `control.cancel` on its behalf, and Mission Control surfaces the
  refusal exactly where you clicked. The agent stays sovereign; this is
  the correct result, not a bug.
- [ ] Interrupt the turn on the vendor side instead and **record what
  lands** — the mapping documents `AfterAgent` as the finishing hook;
  what a vendor-side interrupt produces live is exactly the kind of
  fact these sessions exist to pin down.
- [ ] End the session on the vendor side.
  **Expect:** `session.ended` (`SessionEnd`; vendor reasons — exit,
  clear, logout, … — collapse to `normal`); the lane's status flips to
  ended.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in a fresh
  Gemini CLI session. Reopen the tab.
  **Expect:** lanes rebuild from the persisted `(session, epoch, seq)`
  positions with no gaps — the events emitted while you were away are
  there.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back and
  follows.

Extra credit: trigger a context compression — `PreCompress` is the only
compaction moment Gemini exposes (advisory, unblockable), so
`session.compacted` lands at the PRE moment here, a documented deviation
from the sibling adapters' post-moment timing (the same fleet fact, a
timing skew of seconds). If your settings additionally register
`AfterModel` (left unregistered in the example file — it fires per
streamed chunk), watch for `x.gemini-cli.session.*` events at severity
`debug` instead of the core types.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle |  |  |
| 2 | Tool trio (incl. honest tool.failed) |  |  |
| 3 | Attention: vendor-side decision observed |  |  |
| 4 | Cancel: nack, vendor interrupt, session end |  |  |
| 5 | Replay / resume |  |  |

## Reset & re-run

Ctrl-C the adapter and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The adapter's per-session
JSONL logs live under `~/.aep/logs/gemini-cli/` — keep them; they are
the capture evidence for anything you file. Remove the hook entries
from your Gemini CLI `settings.json` to detach it entirely. Mission
Control's saved positions live in the browser's `localStorage` per
relay URL; a fresh browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh Gemini CLI session that has the hooks
registered — the session under observation can drive its own script.
Because this surface is observe-only, the tester cannot answer anything
from Mission Control; the agent notes the vendor-side decision instead:

```text
You are the agent under observation in a guided live session. A relay,
the Gemini CLI hook adapter, and Mission Control are already running;
your hooks are registered, so everything you do lands on an event
stream a tester is watching. This adapter is observe-only: nothing you
do can be answered from Mission Control, so any permission prompt you
hit will be answered by the tester in your own interface, not the
dashboard.

Work through these steps, pausing after each so the tester can check
the stream. Use a scratch directory. Announce each step before you do
it.

1. Acknowledge this prompt (that already opened the session and a run).
2. List the files in the current directory with a tool call.
3. Try to read ./does-not-exist.txt so one tool call fails — note that
   this vendor exposes real tool errors, so the tester should see a
   genuine tool.failed, not a swallowed one.
4. Do something that triggers a permission prompt. WAIT for the tester
   to tell you they've seen a progress.status event on the stream, then
   answer the prompt yourself in your own interface (there is no
   Mission Control affordance for this). Note in one line what you
   observed on your side.
5. Stop and wait while the tester interrupts you mid-turn on their
   side; afterwards, note what you experienced.
6. Report a short summary the tester can paste into the guide's
   results table: for each step, what you did and whether the
   behavior matched what the guide describes.

Be honest about anything that did not match; mismatches are the
point of the session.
```
