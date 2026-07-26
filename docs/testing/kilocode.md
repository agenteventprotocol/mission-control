# Guided session — Kilo Code

Observes a real Kilo Code session through the reference plugin adapter
(`reference/impl/adapter-kilocode/`). Kilo Code's CLI core is an
OpenCode fork, and at the pinned versions the published bus union is
byte-identical to OpenCode's — this adapter carries the proven OpenCode
shape whole, on Kilo Code's own identity.

**Verification status: types-verified + fixture-proven, live-session
validation pending.**

**Respond from Mission Control: yes** — the hold-open `permission.ask`
round-trip (`control.attention.respond`), the same pattern as OpenCode.

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and Kilo Code installed.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

> **Quick path:** `node impl/setup/aep-setup.js up kilocode` in the reference
> repo automates this section (registration via `write kilocode`, backed up
> and idempotent) — see [Quick setup](README.md#quick-setup-automated).
> The steps below stay canonical.

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the adapter daemon (same token)
AEP_TOKEN=<token> node impl/adapter-kilocode/adapter.js &

# 3 — the plugin
# register impl/adapter-kilocode/kilocode-plugin.js in Kilo Code's
# config `plugin` array (see the vendor's plugins documentation)
```

The plugin POSTs to the daemon on `127.0.0.1:8391` (`AEP_ADAPTER_PORT`
changes it). Check `GET http://127.0.0.1:8391/healthz` → `{ ok, relay }`
and wait for `relay: true`. The plugin is strictly fail-open: a dead or
slow daemon never breaks Kilo Code, and an unanswered `permission.ask`
falls through to Kilo Code's own prompt.

Useful knobs: `AEP_CAPTURE` (default `metadata`), `AEP_CAPTURE_ATTENTION`
(default `redacted`), `AEP_ATTENTION_TIMEOUT_MS` (default 55 000).
Plugin-side: `AEP_PERMISSION_HOLD_MS` (default 60 000 — keep it above the
daemon's attention timeout so the daemon's fail-open answer, not an
aborted fetch, settles the hook).

## The guided script

Work in a scratch directory. Find your lane in Fleet by agent name:
**kilocode**.

### 1 — Lifecycle

- [ ] Start a Kilo Code session and submit any prompt.
  **Expect:** a `kilocode` lane appears in Fleet (`session.started`),
  and the `message.updated` with `role: "user"` opens a run
  (`run.started`) — Kilo Code exposes no turn id, so the run is
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
  **Expect:** no `tool.failed` on the Timeline — the typed hook payloads
  expose no error field, so failures don't pair with the requesting tool
  call at all. Instead watch for `x.kilocode.session.error` at `error`
  severity, session-scoped. This is a documented gap, not a missed
  pairing. Also note what the adapter deliberately leaves out: it
  registers observation hooks ONLY — the output-mutating model and
  compaction hooks stay unused, because an observer that changes what it
  observes has broken capture honesty.

### 3 — Attention: answer from Mission Control

> **Prerequisite — the gate must actually fire.** Turn auto-approval OFF
> in Kilo Code's Auto-Approve settings, at minimum for **Commands**
> (leave the rest off too for a clean run), then use a prompt that needs
> a gated action, e.g.: `run "ls" in the terminal`.
>
> **Know your build — the vendor changed this surface.** Kilo Code
> `7.4.6+` (check `kilocode --version`) removed the hold-open
> `permission.ask` hook: the ask now arrives as a bus notification
> (`permission.asked`) while **Kilo Code's own prompt stays on screen in
> parallel** — the Mission Control card and the vendor prompt coexist,
> and whichever side answers first wins. The card's options mirror the
> vendor's reply enum: **Allow once / Always allow / Reject**. (On
> `7.4.5` and earlier the old held-hook flow applies: options are
> Allow/Deny and answering from the dock suppresses the vendor prompt.)
> Diagnostic split if no card appears: events flow on the lane but no
> card → the daemon build lacks the dual-surface support; restart it
> from a current checkout; no events at all → the plugin isn't loaded
> (re-check the setup section's plugin registration) or the daemon is
> down (`curl http://127.0.0.1:8391/healthz`); Kilo Code does NOT prompt
> either → the action was auto-approved and no ask exists — pick a
> gated action or re-check auto-approve.

- [ ] Trigger a permission gate (with auto-approve off, ask for a command
  run as above).
  **Expect:** the attention dock slides in (`attention.requested`, kind
  `permission`, severity `notice`, options `once`/`always`/`reject`);
  the fleet card grows its inline quick-answer strip; the rail bell and
  tab title count it. Kilo Code's own prompt is ALSO up — that is the
  `7.4.6+` shape, not a bug. No `x.kilocode.permission.asked` duplicate
  rides the wire.
- [ ] Answer **Allow once** from the dock.
  **Expect:** the card flips to "responding", then settles off the
  stream (`attention.answered` with `option: "once"`,
  `attention.resolved`) — the adapter delivers the decision over the
  vendor server's reply route and Kilo Code's own prompt clears and the
  command runs. **Reject** settles the same way and Kilo Code refuses
  the action.
- [ ] Answer a fresh gate from the **Kilo Code side** instead (its own
  prompt).
  **Expect:** the card resolves off the stream (`attention.resolved`,
  resolution `answered`) with no answer sent from Mission Control — a
  vendor-side settle stands the pending card down; a late answer from
  the dock nacks (`control.rejected`, no pending request).
- [ ] Type the word `reject` (any case) into the reply box on a fresh
  gate — no button click.
  **Expect:** the typed word IS the option (the AEP-0008 receiver
  rule): `attention.answered` records `option: "reject"` with no text
  residue. `once` and `always` work the same way.
- [ ] Try answering with free text that is NOT an option word (e.g.
  `use the staging registry instead`).
  **Expect:** the refusing status — `option: "reject"`, never an allow.
  On `7.4.6+` your words now REACH Kilo Code as the reject message (the
  vendor reply carries `message`); on the old held-hook surface they
  were stream-visible only.
- [ ] Ask a question mid-run (a prompt that makes Kilo Code use its
  followup-question tool), then answer it from the dock.
  **Expect:** `attention.requested` kind `form` — the question with its
  suggested answers as choices (free text allowed when the vendor
  permits a custom answer). Answering delivers your choice to Kilo Code
  verbatim; answering in the TUI instead resolves the card off the
  stream (`question.replied`).
- [ ] Let one request time out instead.
  **Expect:** `attention.timeout` on the stream and NOTHING sent to the
  vendor — Kilo Code's own prompt (already up) remains the live
  decision point; when you eventually answer it there, the request
  resolves off the stream (the post-timeout settle). The adapter never
  blocks the agent.

### 4 — Cancel

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:` nack —
  this adapter declares `control.attention.respond` only, the relay
  nacks `control.cancel` on its behalf, and Mission Control surfaces the
  refusal exactly where you clicked. The agent stays sovereign; this is
  the correct result, not a bug.
- [ ] Interrupt the session on the Kilo Code side instead and **record
  what lands** — the mapping documents `session.idle` as the only close
  boundary; what a vendor-side interrupt produces live is exactly the
  kind of fact these sessions exist to pin down.
- [ ] End the session.
  **Expect:** whatever terminal Kilo Code's own close path produces —
  note it in the results table alongside what the guide expected.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in a fresh
  Kilo Code session. Reopen the tab.
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
| 3 | Attention: once / always / reject / vendor-side settle / typed word / free text / question form / timeout |  |  |
| 4 | Cancel: nack, vendor interrupt, session end |  |  |
| 5 | Replay / resume |  |  |

## Reset & re-run

Ctrl-C the adapter and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The adapter's per-session
JSONL logs live under `~/.aep/logs/kilocode/`; keep them — they are the
capture evidence for anything you file. Remove the plugin entry from
Kilo Code's config `plugin` array to detach it entirely. Mission
Control's saved positions live in the browser's `localStorage` per relay
URL; a fresh browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh Kilo Code session that has the plugin registered
— the session under observation can drive its own script:

```text
You are the agent under observation in a guided live session. A relay,
the Kilo Code plugin adapter, and Mission Control are already running;
the plugin is registered, so everything you do lands on an event stream
a tester is watching.

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
5. If the tester answers with free text instead of a button, it lands
   as a reject: a typed option word arrives as that decision, and on
   7.4.6+ any other words reach you as the reject message (on older
   builds only the decision arrives). Report what you received.
6. Stop and wait while the tester interrupts you mid-turn on their side
   or ends the session; afterwards, note what you experienced.
7. Report a short summary the tester can paste into the guide's results
   table: for each step, what you did and whether the round-trip
   behaved as described.

Be honest about anything that did not match; mismatches are the point of
the session.
```
