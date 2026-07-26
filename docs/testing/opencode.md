# Guided session — OpenCode

Observes a real OpenCode session through the reference plugin adapter
(`reference/impl/adapter-opencode/`). Two runtimes: a plugin shim inside
OpenCode's own Bun process forwards bus events and the two interception
moments over local HTTP to a Node daemon, which owns identity, capture
gating, and the relay binding.

**Verification status: documented + fixture-proven, live-session
validation pending.**

**Respond from Mission Control: yes** — the hold-open `permission.ask`
round-trip (`control.attention.respond`).

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and OpenCode installed.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

> **Quick path:** `node impl/setup/aep-setup.js up opencode` in the reference
> repo automates this section (registration via `write opencode`, backed up
> and idempotent) — see [Quick setup](README.md#quick-setup-automated).
> The steps below stay canonical.

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the adapter daemon (same token)
AEP_TOKEN=<token> node impl/adapter-opencode/adapter.js &

# 3 — the plugin
cp impl/adapter-opencode/opencode-plugin.js ~/.config/opencode/plugins/
# (or .opencode/plugins/ in the project)
```

The plugin POSTs to the daemon on `127.0.0.1:8390` (`AEP_ADAPTER_PORT`
changes it). Check `GET http://127.0.0.1:8390/healthz` → `{ ok, relay }`
and wait for `relay: true`. The plugin is strictly fail-open: a dead or
slow daemon never breaks OpenCode, and an unanswered `permission.ask`
falls through to OpenCode's own prompt.

Useful knobs: `AEP_CAPTURE` (default `metadata`), `AEP_CAPTURE_ATTENTION`
(default `redacted`), `AEP_ATTENTION_TIMEOUT_MS` (default 55 000).
Plugin-side: `AEP_PERMISSION_HOLD_MS` (default 60 000 — keep it above the
daemon's attention timeout so the daemon's fail-open answer, not an
aborted fetch, settles the hook).

## The guided script

Work in a scratch directory. Find your lane in Fleet by agent name:
**opencode**.

### 1 — Lifecycle

- [ ] Start an OpenCode session and submit any prompt.
  **Expect:** an `opencode` lane appears in Fleet (`session.started`),
  and the `message.updated` with `role: "user"` opens a run
  (`run.started`) — OpenCode exposes no turn id, so the run is
  synthesized on the user-message/idle boundary, not a vendor-native id.
- [ ] Let the turn finish.
  **Expect:** `session.idle` closes the run cause-linked
  (`run.finished`). Steering mid-turn never double-opens a run.

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless: *"list the files in
  this directory"*.
  **Expect:** `tool.requested` → `tool.completed` pairs in the session
  Timeline, matched exactly by `callID` and `cause`-linked (the Causal
  graph draws the edge). At the default capture only the args digest
  rides along.
- [ ] Make a tool fail: *"read the file ./does-not-exist.txt"*.
  **Expect:** no `tool.failed` on the Timeline — this surface's typed
  hook payloads expose no error field, so failures don't pair with the
  requesting tool call at all. Instead watch for
  `x.opencode.session.error` at `error` severity, session-scoped. This
  is a documented gap, not a missed pairing.

### 3 — Attention: answer from Mission Control

- [ ] Trigger a permission gate (ask for an action OpenCode prompts on).
  **Expect:** the attention dock slides in (`attention.requested`, kind
  `permission`, severity `notice`); the fleet card grows its inline
  quick-answer strip; the rail bell and tab title count it.
- [ ] Answer **allow** from the dock.
  **Expect:** the card flips to "responding", then settles off the
  stream (`attention.answered`, `attention.resolved`) — the hook itself
  settles as `output.status: "allow"`, and OpenCode proceeds **without
  showing its own permission prompt**. A deny settles the same hook as
  `output.status: "deny"`.
- [ ] Type the word `allow` (any case) into the reply box on a fresh
  gate — no button click.
  **Expect:** the typed word IS the option (the AEP-0008 receiver
  rule): `attention.answered` records `option: "allow"` with no text
  residue, and the hook settles `output.status: "allow"` exactly as a
  clicked Allow.
- [ ] Try answering with free text that is NOT an option word.
  **Expect:** the refusing status — the hook settles
  `output.status: "deny"`, never an allow. Your text is visible on
  `attention.answered` in the Inspector, but it **cannot reach
  OpenCode** — the hold-open hook output only carries `status`, so the
  words themselves go nowhere on the wire. This is a hard ceiling of
  the hook shape, not a bug in the adapter.
- [ ] Let one request time out instead.
  **Expect:** `attention.timeout` on the stream, and the hook answers
  `{status: "ask"}` — OpenCode falls back to its own interactive prompt.
  The adapter never blocks the agent indefinitely.

### 4 — Cancel

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:` nack —
  this adapter declares `control.attention.respond` only, the relay
  nacks `control.cancel` on its behalf, and Mission Control surfaces the
  refusal exactly where you clicked. The agent stays sovereign; this is
  the correct result, not a bug.
- [ ] Interrupt the session on the OpenCode side instead and **record
  what lands** — the mapping documents `session.idle` as the only close
  boundary; what a vendor-side interrupt produces live is exactly the
  kind of fact these sessions exist to pin down.
- [ ] End the session.
  **Expect:** whatever terminal OpenCode's own close path produces —
  note it in the results table alongside what the guide expected.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in a fresh
  OpenCode session. Reopen the tab.
  **Expect:** lanes rebuild from the persisted `(session, epoch, seq)`
  positions with no gaps — the events emitted while you were away are
  there.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back and
  follows.

Extra credit: watch a todo-list edit turn into
`progress.task.planned`/`progress.task.completed` transitions — the
adapter diffs `todo.updated` snapshots rather than forwarding them raw,
so the Timeline shows state changes, not repeated full lists.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle |  |  |
| 2 | Tool trio: pairing / honest tool.failed absence |  |  |
| 3 | Attention: allow / deny / typed word / free-text ceiling / timeout |  |  |
| 4 | Cancel: nack, vendor interrupt, session end |  |  |
| 5 | Replay / resume |  |  |

## Reset & re-run

Ctrl-C the adapter and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The adapter's per-session
JSONL logs live under `~/.aep/logs/opencode/`; keep them — they are the
capture evidence for anything you file. Remove the plugin file from
`~/.config/opencode/plugins/` (or `.opencode/plugins/`) to detach
OpenCode entirely. Mission Control's saved positions live in the
browser's `localStorage` per relay URL; a fresh browser profile is a
clean observer.

## Session prompt for an assistant

Paste this into a fresh OpenCode session that has the plugin installed —
the session under observation can drive its own script:

```text
You are the agent under observation in a guided live session. A relay,
the OpenCode plugin adapter, and Mission Control are already running;
the plugin is installed, so everything you do lands on an event stream a
tester is watching.

Work through these steps, pausing after each so the tester can check the
stream. Use a scratch directory. Announce each step before you do it.

1. Acknowledge this prompt (that already opened the session and a run).
2. List the files in the current directory with a tool call.
3. Try to read ./does-not-exist.txt. Note that this surface has no
   tool.failed mapping — the tester is watching for a session-scoped
   error event instead of a paired failure.
4. Do something that triggers a permission prompt, and WAIT — the tester
   answers it from Mission Control, not the terminal. Note in one line
   whether the answer reached you without your own prompt appearing.
5. If the tester answers with free text instead of a button, note that
   you can only observe a status decision (allow/deny/ask) — a typed
   option word arrives as that decision, any other words do not reach
   you at all; confirm that is what happened.
6. Stop and wait while the tester interrupts you mid-turn on their side
   or ends the session; afterwards, note what you experienced.
7. Report a short summary the tester can paste into the guide's results
   table: for each step, what you did and whether the round-trip
   behaved as described.

Be honest about anything that did not match; mismatches are the point of
the session.
```

See also: [OpenCode over SSE](bridge-opencode-sse.md), the zero-install
second channel that observes the same server without touching the plugin
config at all.
