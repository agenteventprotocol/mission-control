# Guided session — pi

Observes a real pi session through the reference extension adapter
(`reference/impl/adapter-pi/`), verified against the published
extension types in `@earendil-works/pi-coding-agent@0.80.6`.
**Observe-only is the DEFAULT posture, by non-subscription**: pi
registers handlers per event, and at the default posture this
extension module never registers an interception surface — no
`tool_call`, no `tool_result`, no `context`, no `input`, no
`before_provider_*`, no `session_before_*`. Non-subscription itself is
the neutrality here, not a policy layered on top of a capability the
adapter chooses not to use — which is exactly why the opt-in below is
drawn at registration.

**Respond from Mission Control: opt-in** — by default there is nothing
to answer; VENDOR approval outcomes are not visible on this bus at all
in any posture. `AEP_PI_CONTROL=1` (beat 6) registers exactly one
additional surface — the blockable `tool_call` — and holds matched
calls as an answerable **Allow/Deny operator gate**. A deny rides the
vendor's own block result and the model sees the reason; the observed
skip stays the pinned `tool.failed` (never a `tool.denied` recast —
pi's bus does not distinguish blocked-from-failed, so the denial story
lives on the attention pair).

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and pi (`@earendil-works/pi-coding-agent`) installed.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

> **Quick path:** `node impl/setup/aep-setup.js up pi` in the reference
> repo automates this section (registration via `write pi`, backed up
> and idempotent) — see [Quick setup](README.md#quick-setup-automated).
> The steps below stay canonical.

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the adapter daemon (same token)
AEP_TOKEN=<token> node impl/adapter-pi/adapter.js &

# 3 — register the extension by explicit path — the auto-discovery
# directories scan *.ts only, so either:
#   ~/.pi/agent/settings.json:
#     { "extensions": ["/path/to/impl/adapter-pi/pi-extension.js"] }
# or:
#   pi -e /path/to/impl/adapter-pi/pi-extension.js
```

The daemon listens on `127.0.0.1:8396` (`AEP_ADAPTER_PORT` changes it).
Check `GET http://127.0.0.1:8396/healthz` → `{ ok, relay }` — `relay`
turns true once the WS binding to the relay is live. Extensions load in
all four pi modes (interactive TUI, `--mode rpc`, `--mode json`,
`-p`/`--print`); drive the TUI for this guided script. The extension is
strictly fail-open: a dead or slow daemon never breaks the agent.

Useful knobs: `AEP_CAPTURE` (default `metadata`), `AEP_LOG_DIR`,
`AEP_PI_DELTAS` (set `1` to opt `message_update` / `tool_execution_update`
stream traffic onto the `x.pi.*` debug plane — off by default, and
never required for the durable story). Control gate (beat 6, BOTH
processes): `AEP_PI_CONTROL` · `AEP_PI_GATE_TOOLS` ·
`AEP_ATTENTION_TIMEOUT_MS` (default 55 000).

## The guided script

Work in a scratch directory. Find your lane in Fleet by agent name:
**pi**.

### 1 — Lifecycle

- [ ] Start a pi session and submit any prompt.
  **Expect:** a `pi` lane appears in Fleet (`session_start` →
  `session.started`, with typed arrival reason). The prompt opens
  `agent_start` → `run.started` — one agent loop is one run.
- [ ] Let the turn finish.
  **Expect:** a turn boundary lands `run.step.*` (`turn_start` /
  `turn_end`, the vendor's own `turnIndex` on the envelope `step`) —
  the session detail **State** tab is the expect for these. When the
  agent loop itself settles, `agent_end` closes the run by the typed
  `stopReason` — normal completion is `run.finished`.

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless.
  **Expect:** `tool_execution_start`/`end` → `tool.requested` →
  `tool.completed`, `cause`-linked in the Timeline (the Causal graph
  draws the edge).
- [ ] Make a tool fail.
  **Expect:** `tool.failed` from the honest `isError` split on
  `tool_execution_end` — no result is ever reclassified as success.
- [ ] Optional, with `AEP_PI_DELTAS=1` set before starting the daemon:
  watch the severity lens at **debug** during a longer tool run.
  **Expect:** `message_update` / `tool_execution_update` stream traffic
  on the `x.pi.*` debug plane — extra-credit only, shed first, never
  part of the durable story.

### 3 — Attention: honest absence (default posture)

- [ ] Trigger any approval-shaped interaction pi offers in your setup.
  **Expect:** **nothing lands on `attention.*`, and no `tool.denied`
  appears** — VENDOR approval outcomes are not visible on this bus at
  all. At the default posture this adapter registers no interception
  surface, so there is structurally nothing to answer; that is the
  correct, documented result, not a gap to chase. (The fork Oh-My-Pi's
  typed approval pair is the named trigger for revisiting the vendor
  side — it is expected-compatible but unanchored, so this fixture
  pins upstream pi only. The only `attention.*` this adapter ever
  emits is its own opt-in held gate, beat 6 — and even that never
  produces a `tool.denied`.)
- [ ] Confirm the absence: check the Attention center after the
  interaction and record that nothing appeared there.

### 4 — Cancel

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:` nack —
  this adapter declares no control commands at the default posture
  (and never `control.cancel`, in ANY posture: aborts belong to pi's
  client-owned modes, not the extension bus), so the relay nacks
  `control.cancel` on pi's behalf. The agent stays sovereign; this is
  the correct result, not a bug.
- [ ] Abort the loop on the pi side instead (however your setup
  interrupts a running turn).
  **Expect:** a **true `run.cancelled`** — `agent_end`'s typed
  `stopReason` can close the run as `run.finished`, `run.failed`, or
  `run.cancelled`, so a vendor-side abort is one of the few paths on
  this surface that lands a real cancellation. If you then retry or
  resubmit, watch for a **second, distinct run** — a retried loop is a
  new run, not a reopened one; note two ribbons, not one continuing.
- [ ] End the session (however your pi session normally exits).
  **Expect:** `session_shutdown` → `session.ended`, with the typed
  teardown reason.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in a fresh pi
  session. Reopen the tab.
  **Expect:** lanes rebuild from the persisted `(session, epoch, seq)`
  positions with no gaps — the events emitted while you were away are
  there.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back and
  follows.

### 6 — Control (opt-in) — smoke-proven, live pending

Restart the daemon AND pi with `AEP_PI_CONTROL=1` in their environment
(the extension factory reads it at registration time; both processes
must see it), and scope the gate before you start:
`AEP_PI_GATE_TOOLS='bash|write'` (regex over tool names, fullmatch —
an unscoped gate holds EVERY tool call). Wait for `control: true` on
the daemon's `/healthz`. This leg is smoke-proven against the real
extension held mid-call; a live pi session has not yet validated it —
mismatches here are exactly what this beat exists to find. Two honesty
notes before you drive it: pi imposes **no timeout of its own** on the
hold and the hold is **abort-blind** — a user abort (Esc) during a
held gate waits for the release, so keep the window modest
(`AEP_ATTENTION_TIMEOUT_MS`, default 55 s, is the ONLY clock). And the
gate mints no permission: an allowed call still faces whatever trust
flow pi itself would apply.

- [ ] Ask for a gated tool action (one matching your scope regex).
  **Expect:** the same tool call that beat 2 merely observed now ALSO
  raises an answerable `attention.requested` (kind `permission`,
  **Allow**/**Deny**) in the attention dock, on the same `pi` lane,
  paired to its `tool.requested` — while pi itself sits waiting on the
  held handler.
- [ ] Answer **Deny** from the dock, with a note.
  **Expect:** `attention.answered` (`option: "deny"`, your note as
  `answer.text`, `via: "control"`) cause-linked to your command, then
  `attention.resolved`. pi's model sees your note as an immediate
  error tool result and execution is skipped — and the observed skip
  lands as **`tool.failed`, cause-linked to your command** in the
  Timeline. **No `tool.denied` appears, by design**: pi's bus does not
  distinguish a blocked call from a failed one, and the mapping
  refuses to invent the distinction — the denial story is the
  attention pair plus the cause link, not a recast tool fact.
- [ ] Ask for another gated action and answer **Allow**.
  **Expect:** the request settles `answered` via control and the call
  proceeds normally (`tool.completed`) — allowing the gate granted
  nothing; pi's own trust flow still applies.
- [ ] Let one gate expire unanswered.
  **Expect:** `attention.timeout`, and **the tool RUNS** — the gate
  fails OPEN (an absent answer behaves like an absent handler). An
  unanswered deny gate is not a deny; this expectation is
  load-bearing.
- [ ] Try a free-text-only reply from the dock (no option).
  **Expect:** an inline `respond failed:` nack (`invalid`) — nothing
  on this gate takes free text alone; the reason rides WITH a Deny.
- [ ] Re-check beat 4's cancel while gated on.
  **Expect:** still the sender-side nack — the gate declares
  `control.attention.respond` only; `control.cancel` stays nacked in
  every posture.

No consumer-side change is involved anywhere in this beat: the same
AttentionCard renders the Allow/Deny options and the same respond path
drives them — the opt-in leg changes what the ADAPTER registers and
holds, never what Mission Control does.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle |  |  |
| 2 | Tool trio: completed / failed / deltas |  |  |
| 3 | Attention: honest absence |  |  |
| 4 | Cancel: nack, vendor abort → run.cancelled, retry = new run, session end |  |  |
| 5 | Replay / resume |  |  |
| 6 | Control opt-in: held Allow/Deny gate — deny w/ reason → `tool.failed` cause-linked (no `tool.denied`, by design), allow mints nothing, fail-open expiry, invalid free-text, cancel still nacked |  |  |

## Reset & re-run

Ctrl-C the adapter and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The adapter's per-session
JSONL logs live under `~/.aep/logs/pi/` — keep them; they are the
capture evidence for anything you file. Remove the `extensions` entry
from `~/.pi/agent/settings.json` (or drop the `-e` flag) to detach pi
entirely. Mission Control's saved positions live in the browser's
`localStorage` per relay URL; a fresh browser profile is a clean
observer.

## Session prompt for an assistant

Paste this into a fresh pi session that has the extension registered —
the session under observation can drive its own script:

```text
You are the agent under observation in a guided live session. A relay,
the pi extension adapter, and Mission Control are already running; the
extension is registered, so everything you do lands on an event stream
a tester is watching.

Work through these steps, pausing after each so the tester can check
the stream. Use a scratch directory. Announce each step before you do
it.

1. Acknowledge this prompt (that already opened the session and a run).
2. Do something tool-shaped and harmless with a tool call.
3. Try an action that fails as a tool call, so one tool call fails.
4. If your setup offers any approval-shaped interaction, trigger it and
   resolve it yourself — the tester CANNOT answer or even observe the
   outcome from Mission Control on this surface. Note in one line that
   nothing should appear there.
5. When the tester aborts your current run on their side, note what you
   experienced. If you then get retried or resubmitted, point out that
   this is a new run, not a continuation of the old one.
6. If the session is gated (AEP_PI_CONTROL=1), attempt one tool action
   the tester said is in scope and PAUSE — the tester will Deny it
   with a note, and your tool call should come back as an immediate
   error carrying their note. Then attempt another; the tester will
   Allow it and it should run normally. Report what you saw either
   way.
7. Report a short summary the tester can paste into the guide's
   results table: for each step, what you did and whether the
   round-trip behaved as described.

Be honest about anything that did not match; mismatches are the point
of the session.
```
