# Guided session — Hermes

Observes a real Hermes agent session through the reference hook adapter
(`reference/impl/adapter-hermes/`). The mapping is pinned against
**source** — the vendor publishes no typed schema artifact, so the
design record carries file:line citations at the pinned tag, and every
payload's own `telemetry_schema_version` string
(`hermes.observer.v1`) is the drift sentinel the daemon warns on.
**Observe-only is the DEFAULT posture**: the block-capable hook output
is unused, and the vendor's own approval gate is observed read-only —
in every posture.

**Respond from Mission Control: opt-in** — by default the attention
gate the vendor raises has no answerable channel on this bus (the
human's decision reaches Hermes out of band, and this session watches
it arrive, not grants it) — and the card now SAYS so: the observed
request carries the vendor's decision menu as data and declares
`respond_via: ["oob"]`, so Mission Control renders it as information
(AEP-0008). `AEP_HERMES_CONTROL=1` (beat 6) adds an answerable
**operator-deny gate** on tool calls: a held `pre_tool_call` becomes
an Allow/Deny attention request — typed text is honored per the
AEP-0008 receiver rule (an option word counts as that option; other
free text is a deny with your words as the reason) — and a deny rides
the vendor's own block directive. The vendor's OWN approval gate stays
read-only either way — pre-answering it is the one thing the vendor
forbids its hooks.

**Steer from Mission Control: opt-in** — `AEP_INSTRUCT=1` on the daemon
(beat 7) declares `x.hermes.control.instruct`: queued text is delivered
through the vendor's own context injection — the `pre_llm_call` hook
reply, joined into the user message at turn start — so an instruction
lands at latest on the next turn.

**The clarify form overlay: always on** — Hermes's `clarify`
ask-the-user tool additionally maps a `kind: "form"` attention card
(AEP-0006) beside its ordinary tool events, `respond_via: ["oob"]` —
you SEE the question, its choices, and the vendor-delivered answer on
the stream, and the card renders read-only (beat 8).

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and Hermes installed.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

> **Quick path:** `node impl/setup/aep-setup.js up hermes` in the reference
> repo automates this section (registration via `write hermes`, backed up
> and idempotent) — see [Quick setup](README.md#quick-setup-automated).
> The steps below stay canonical.

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the adapter daemon (same token)
AEP_TOKEN=<token> node impl/adapter-hermes/adapter.js &

# 3 — declare the shim as the command for each observed event
# in the hooks: block of ~/.hermes/config.yaml:
#   impl/adapter-hermes/hermes-hook.js
```

The daemon listens on `127.0.0.1:8393` (`AEP_ADAPTER_PORT` changes it).
Check `GET http://127.0.0.1:8393/healthz` → `{ ok, relay }` and wait for
`relay: true`. The vendor prompts for **first-use consent per (event,
command) pair** the first time each hook fires — expect one consent
prompt per event the first time you drive this script, and accept them
all or the corresponding beat goes silent. The shim is strictly
fail-open (exit 0 always): with the daemon down, Hermes behaves as if
unhooked, so a dead daemon looks like silence, not breakage.

Useful knobs: `AEP_CAPTURE` (default `metadata`), `AEP_CAPTURE_ATTENTION`
(default `redacted`), `AEP_LOG_DIR`, `AEP_INSTRUCT` (beat 7 — both
processes must see it). Shim-side: `AEP_ADAPTER_URL` ·
`AEP_HOOK_TIMEOUT_MS` (default 1500 — bounded so the agent never waits
on a slow observer).

## The guided script

Work in a scratch directory. Find your lane in Fleet by agent name:
**hermes**.

### 1 — Lifecycle

- [ ] Start a Hermes session and submit any prompt.
  **Expect:** a `hermes` lane appears in Fleet (`session.started`), and
  the turn opens a run — the vendor's per-turn `turn_id` rides verbatim
  as the run id (`pre_llm_call`). The lane's run ribbon shows it active.
- [ ] Let the turn finish normally.
  **Expect:** `run.finished` closes the run. This is the per-turn
  boundary hook, and it closes **runs, not sessions** — it fires at the
  end of every turn, so expect a fresh `run.started`/`run.finished` pair
  each time you prompt again in the same session.

### 2 — Tool trio

- [ ] Ask for something tool-shaped and harmless.
  **Expect:** `tool.requested` → `tool.completed` pairs in the session
  Timeline, `cause`-linked (the Causal graph draws the edge).
- [ ] Make a tool fail.
  **Expect:** `tool.failed` with the vendor's typed error name (message
  redacted+), visible in the severity heat on the lane.
- [ ] Trigger a policy-denied tool if your setup allows one (otherwise
  just record that this beat could not be forced).
  **Expect:** `tool.denied` with `data.by: "policy"` — Hermes's own
  `blocked` outcome, the three-way honest split of the tool result
  (`ok` / `error` / `blocked`).

### 3 — Attention: observe the vendor's own gate

- [ ] Trigger Hermes's own approval gate (ask for an action it prompts
  on).
  **Expect:** `attention.requested` (kind `permission`) carrying the
  vendor's own decision menu **as data** — `options`
  `once`/`session`/`always`/`deny` with Hermes's own menu wording —
  and `respond_via: ["oob"]`: the request itself declares that its
  answer arrives in the agent's own UI (AEP-0008). The card lands on
  the session's own lane (the adapter joins the approval's
  `session_key`; a card on the `#unknown` lane here is a bug — report
  it). Mission Control renders the menu as read-only chips plus an
  "answered in the agent's own UI" note — **no option buttons, no
  reply box**: the consumer honors the request's own channel
  declaration, so there is nothing to send and nothing to nack. (The
  opt-in gate of beat 6 raises a DIFFERENT, answerable request —
  don't confuse the two. The observed-refusal advisory appears only
  on requests that do NOT declare their channel.)
- [ ] Approve the prompt **in Hermes itself** (pick "Allow once") —
  Mission Control cannot answer it.
  **Expect:** the human decision rides as `attention.answered` via
  `"oob"` with `answer.option` naming the menu choice you made
  (`once` here — the same id the card's chips carry), then
  `attention.resolved` — watch the card settle on that stream
  traffic, not on any click of yours.
- [ ] Let one gate time out instead.
  **Expect:** `attention.timeout` on the stream.

### 4 — Cancel

- [ ] With a run active, press **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:
  unsupported` **right at the button — on the compact fleet lane too**,
  not only in the session header (the outcome renders at the click
  site; a hover tooltip is not a troubleshooting surface). In the
  default posture this adapter declares no control commands
  (`accepts: []`), and even under the beat-6 gate it declares ONLY
  `control.attention.respond`, so the relay nacks `control.cancel` on
  Hermes's behalf in every posture (no vendor cancel write exists on
  this surface). The agent stays sovereign; this is the correct result,
  not a bug. The session's Control tab records the settle
  (`refused · unsupported`), and from then on the cancel affordance
  carries an **observed-refusal advisory** up front (visible text in
  the session header, the button title on the lane) — advisory only,
  the send stays available in case the target's gate changes; a bare
  dead-end with no feedback anywhere would be a finding.
- [ ] Interrupt the turn on the Hermes side instead.
  **Expect:** a **true `run.cancelled` (`by: "user"`)** — the per-turn
  boundary hook's `interrupted` outcome maps directly here, so this is
  one of the few surfaces where a vendor-side interrupt lands a real
  cancellation rather than an unmapped gap.
- [ ] End the session from Hermes's own finalize/reset moment.
  **Expect:** `session.ended` — real session ends come only from those
  moments, never from a turn boundary. No compaction moment is invented
  on this surface; there is no compaction hook to observe.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Run one more prompt in a fresh
  Hermes session. Reopen the tab.
  **Expect:** lanes rebuild from the persisted `(session, epoch, seq)`
  positions with no gaps — the events emitted while you were away are
  there.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back and
  follows.

### 6 — Control (opt-in) — smoke-proven, live pending

Restart the daemon AND Hermes with `AEP_HERMES_CONTROL=1` in their
environment (the shim inherits it from Hermes; both processes must see
it), and scope the gate before you start:
`AEP_HERMES_GATE_TOOLS='terminal|write_file'` (regex over tool names,
fullmatch — an unscoped gate holds EVERY tool call). Wait for
`control: true` on the daemon's `/healthz`. This leg is smoke-proven
against the real shim held mid-call; a live Hermes session has not yet
validated it — mismatches here are exactly what this beat exists to
find. The gate mints no permission: an allowed call still faces the
vendor's own edit-approval and human-approval gates downstream. The
vendor-side bound: the per-hook `timeout:` in `~/.hermes/config.yaml`
(default 60 s) must exceed the hold window (default 55 s) — the
defaults already satisfy it.

- [ ] Ask for a gated tool action (one matching your scope regex).
  **Expect:** the same tool call that beat 2 merely observed now ALSO
  raises an answerable `attention.requested` (kind `permission`,
  **Allow**/**Deny**) in the attention dock, on the same `hermes` lane,
  paired to its `tool.requested` — while Hermes itself sits waiting on
  the held hook.
- [ ] Answer **Deny** from the dock, with a note.
  **Expect:** `attention.answered` (`option: "deny"`, your note as
  `answer.text`, `via: "control"`) cause-linked to your command, then
  `attention.resolved`. Hermes's model sees your note as the tool's
  error result, and the vendor reports the block back as
  `tool.denied` (`by: "policy"` — the vendor's own class for a hook
  block; the pinned mapping does not move) **cause-linked to your
  command** in the Timeline. The human attribution is on the answered
  event, not on `tool.denied.by`.
- [ ] Ask for another gated action and answer **Allow**.
  **Expect:** the request settles `answered` via control and the call
  proceeds — possibly straight into the vendor's OWN approval prompt
  (beat 3's read-only observation): allowing the gate granted nothing.
- [ ] Let one gate expire unanswered.
  **Expect:** `attention.timeout`, and **the tool RUNS** — the gate
  fails OPEN, exactly the vendor's own hook-timeout semantics. An
  unanswered deny gate is not a deny; this expectation is load-bearing.
- [ ] Type the word `allow` (any case) into the reply box on a fresh
  gate — no button click.
  **Expect:** the typed word IS the option (the AEP-0008 receiver
  rule): `attention.answered` records `option: "allow"` with no text
  residue, and the call proceeds exactly as a clicked Allow.
- [ ] Type a free-text reply that is NOT an option word (e.g. "use the
  staging registry instead") on another fresh gate.
  **Expect:** a DENY carrying your words as the reason —
  `attention.answered` records `option: "deny"` plus your text as
  `answer.text`, the model reads it as the tool's error result, and
  the block lands as `tool.denied` cause-linked to your command.
  Free text is never an allow, and it is never nacked on this gate:
  only an empty answer or a foreign option earns
  `respond failed: invalid`.
- [ ] Re-check beat 4's cancel while gated on.
  **Expect:** still the sender-side nack — the gate declares
  `control.attention.respond` only.

No consumer-side change is involved anywhere in this beat: the same
AttentionCard renders the Allow/Deny options and the same respond path
drives them — the opt-in leg changes what the ADAPTER declares and
honors, never what Mission Control does. One observation worth making:
after your first successful Allow/Deny, the session view's **Control**
tab records `control.attention.respond` as `accepted` — the observed
settle record at work (beat 3's card, by contrast, never sends at all:
its request declares `respond_via: ["oob"]`).

### 7 — Steer (opt-in; smoke-proven, live pending)

The steering path is proven end to end by the adapter's own steering
smoke (relay-behalf refusal, the `pre_llm_call` delivery, the audited
drop, the re-ack discipline) — what a **live** Hermes session does with
the injected context is still unvalidated; that is what this beat pins
down. Restart the daemon AND Hermes with `AEP_INSTRUCT=1` in their
environment when the beat asks for it (the shim inherits it from
Hermes; both processes must see it). This surface has exactly ONE
delivery moment: the vendor reads hook-returned context only at turn
start, into the user message.

The exact commands (from the reference repo root; the panel path —
Stop, then Start with the **Steering (instruct)** toggle on — is
equivalent, and the panel's Restart re-applies your last start
options):

```sh
# daemon side — reboot with the flag (a running daemon keeps its
# boot-time env; `up` alone on a live daemon will NOT apply it):
node impl/setup/aep-setup.js down hermes
node impl/setup/aep-setup.js up hermes --env AEP_INSTRUCT=1

# verify before driving the beat:
curl -s http://127.0.0.1:8393/healthz   # expect "instruct": true

# vendor side — the shim inherits Hermes's environment, so launch
# Hermes itself from a shell where the flag is set:
AEP_INSTRUCT=1 hermes
```

- [ ] With the daemon running **without** `AEP_INSTRUCT`, press
  **Steer** in the session header and send any instruction.
  **Expect:** an inline `refused: … unsupported` right in the composer —
  the verb is absent from the daemon's `hello`, so the relay refuses the
  command sender-side on the target's behalf (AEP-0004 §4.2).
  Observe-only is the default posture; like the cancel nack, this
  refusal is the correct result, not a bug.
- [ ] Restart with `AEP_INSTRUCT=1` (the `hello` now declares
  `x.hermes.control.instruct`) and steer again with something visible.
  **Expect:** the composer settles "accepted by the target"; the
  instruction is QUEUED — nothing delivers yet if the agent is idle
  or mid-turn.
- [ ] Submit a prompt (start the next turn) and watch.
  **Expect:** on the turn's `pre_llm_call` the Timeline gains a
  cause-linked `x.hermes.instruction.delivered { queued_ms }` right
  beside the turn's `run.started` — the text was joined into the user
  message the model reads this turn (vendor semantics; advisory).
  Whether and how the agent honors it is exactly the kind of fact to
  record.
- [ ] Queue an instruction mid-turn and let the turn END without a new
  one (the per-turn boundary closes the RUN).
  **Expect:** NO drop — the queue survives turn boundaries on this
  surface; the instruction delivers on the NEXT turn you start. A drop
  here would be a finding.
- [ ] Queue one more instruction, then end the SESSION on the vendor
  side (`/exit` or shutdown) before any new turn starts.
  **Expect:** `x.hermes.instruction.dropped { reason: "session-ended" }`,
  cause-linked, **before** `session.ended` — nothing queued dies
  silently.

### 8 — Clarify: the observed form overlay

No opt-in — this rides the default observation posture.

- [ ] Ask Hermes to use its `clarify` tool with choices (for example:
  "Use the clarify tool to ask me which deployment target to use,
  offering staging and production"). Don't answer yet.
  **Expect:** beside the ordinary `tool.requested`, an
  `attention.requested` (kind `form`, cause-linked to the tool call)
  lands on the lane and the dock: the question as the field label, the
  choices as **read-only chips** plus an `Other…` marker, and the
  "answered in the agent's own UI" note — NO submit button, NO reply
  box (`respond_via: ["oob"]`, AEP-0006/0008: no result-consuming hook
  exists on this surface, so the bus honestly cannot answer).
- [ ] Pick a choice in Hermes's own UI (arrow keys + Enter).
  **Expect:** `attention.answered` via `oob` with the pick recorded as
  its **structural 1-based choice id** in `answer.values`, then
  `attention.resolved (answered)`; `tool.completed` rides beside them,
  cause-linked to the same call.
- [ ] Trigger another clarify and answer through **Other** with your
  own words (or have it ask open-ended — no choices).
  **Expect:** the answer rides `values` as your free text (the
  adapter's attention ceiling is `redacted` by default, so the text is
  visible; at a `metadata` ceiling it would be dropped, never leaked).
- [ ] Trigger one more and let it TIME OUT (the CLI default is 120 s;
  the panel shows a countdown).
  **Expect:** `attention.timeout` — and the model proceeds on its own
  (the vendor's timeout instruction; the card never fabricates an
  answer). Interrupting a clarify instead (Ctrl-C) resolves the card
  `dismissed`.
- [ ] (Optional, with beat 6's gate scoped to include `clarify`.)
  Trigger a clarify and DENY the held gate.
  **Expect:** two honest cards for one call — the answerable
  permission gate, then the form card; on the deny, `tool.denied`
  (policy) lands and the form card resolves `dismissed`: the agent DID
  ask, policy killed the ask before you ever saw it in the Hermes UI.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle |  |  |
| 2 | Tool trio: completed / failed / denied |  |  |
| 3 | Attention: oob answer / resolved / timeout |  |  |
| 4 | Cancel: nack, vendor interrupt → run.cancelled, session end |  |  |
| 5 | Replay / resume |  |  |
| 6 | Control opt-in: held deny gate — deny w/ reason, allow mints nothing, fail-open expiry, invalid free-text, cancel still nacked |  |  |
| 7 | Steer: refusal (flag off), turn-start delivery, queue survives turn end, dropped at session end |  |  |
| 8 | Clarify: read-only form card (oob), picked choice as structural id, Other free text, timeout / dismissed, gate interplay |  |  |

## Reset & re-run

Ctrl-C the adapter and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). The adapter's per-session
JSONL logs live under `~/.aep/logs/hermes/` — keep them; they are the
capture evidence for anything you file. Remove the hook entries from
the `hooks:` block of `~/.hermes/config.yaml` to detach Hermes entirely.
Mission Control's saved positions live in the browser's `localStorage`
per relay URL; a fresh browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh Hermes session that has the hooks registered —
the session under observation can drive its own script:

```text
You are the agent under observation in a guided live session. A relay,
the Hermes hook adapter, and Mission Control are already running; your
hooks are registered, so everything you do lands on an event stream a
tester is watching.

Work through these steps, pausing after each so the tester can check
the stream. Use a scratch directory. Announce each step before you do
it.

1. Acknowledge this prompt (that already opened the session and a run).
2. Do something tool-shaped and harmless with a tool call.
3. Try an action that fails as a tool call, so one tool call fails.
4. Do something that triggers your own approval gate, and WAIT — the
   tester CANNOT answer this from Mission Control on this surface; they
   will approve or deny it directly in you. Note in one line what you
   observed once the decision lands.
5. When the tester interrupts your current turn, note what you
   experienced — this surface closes the run, not the session, so
   expect to still be alive afterward.
6. If the tester tells you the operator-deny gate is on: attempt a tool
   action they named as gated, and WAIT — your tool call is held until
   they Allow or Deny it from Mission Control. If denied, report the
   error text your tool call returned verbatim (it is the tester's own
   reason); if allowed, note that your own approval prompt may still
   follow — the gate grants nothing.
7. Use your clarify tool to ask the tester a question with two or three
   choices, and note what answer your tool call returned (they may pick
   a choice, type their own through Other, or deliberately let it time
   out — report which you received, verbatim).
8. Report a short summary the tester can paste into the guide's results
   table: for each step, what you did and whether the round-trip
   behaved as described.

Be honest about anything that did not match; mismatches are the point
of the session.
```
