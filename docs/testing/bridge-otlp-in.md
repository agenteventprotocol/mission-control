# Guided session — Codex over OTLP

Observes Codex's native OTel log export through the reference bridge
(`reference/impl/bridge-otlp-in/`) — the second capture channel for
Codex, independent of the [hook adapter](codex.md). **Fixture-proven
in both modes; live validation pending.**

**Respond from Mission Control: no** — telemetry mirror. There is no
control surface on this channel at all.

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and Codex configured to export OTel logs.
- An OTel Collector in front of the bridge: Codex exports **protobuf**
  by default, and this receiver only accepts **JSON encoding** — point
  Codex's OTel exporter at a Collector and use the `otlphttp` exporter
  with `encoding: json` to transcode. Non-JSON input is refused, and
  the refusal names this as the fix.
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the bridge (companion mode: default)
AEP_TOKEN=<token> node impl/bridge-otlp-in/receiver.js &

# 3 — an OTel Collector transcoding Codex's protobuf export to JSON,
#     forwarding to POST http://127.0.0.1:4319/v1/logs
```

The receiver serves OTLP/HTTP `POST /v1/logs` in JSON encoding on
`127.0.0.1:4319` (`AEP_OTLP_IN_PORT` changes it). Check
`GET http://127.0.0.1:4319/healthz` → `{ ok, relay }` and wait for
`relay: true`.

Two modes, chosen at startup — not guessed at runtime:

- **companion** (default) — everything rides the channel-visible
  `x.codex.otel.*` family, core types never; run this alongside the
  [Codex hook adapter](codex.md), which stays the sole core-type
  authority for this agent.
- **`--primary`** (`node impl/bridge-otlp-in/receiver.js --primary`)
  — the designed core subset (`session.started`,
  `tool.completed`/`tool.failed`, `tool.denied` for config/automation
  denies) for deployments running no hook adapter at all.

This guide's beats assume `--primary` so the core types are visible
to check against Mission Control's mapping; note in your results which
mode you actually ran.

## The guided script

Work in a scratch directory driving Codex with OTel export pointed
(via the Collector) at the bridge. Find your lane in Fleet by agent
name: **codex**.

### 1 — Lifecycle (adapted: no run ribbons on this channel)

- [ ] Start a Codex session with OTel export enabled and submit a
  prompt.
  **Expect (primary mode):** a `codex` lane appears in Fleet
  (`session.started`, keyed on `conversation.id`). **There is no
  `run.started`/`run.finished` on this channel** — an OTel pipeline
  batches and retries, so interleavings aren't reliable enough to pair
  run boundaries honestly. Records that arrive without a
  `conversation.id` are counted and skipped rather than guessed into a
  session.
- [ ] End the Codex session.
  **Expect:** nothing closes the lane — there is no `session.ended`
  on this channel either. The lane stays open. State it, don't work
  around it.

### 2 — Tool trio (adapted: no run to pair against)

- [ ] Ask Codex for something tool-shaped and harmless.
  **Expect (primary):** `tool.completed` from the OTel tool-call
  record, standalone (no `run.started` to cause-link it to on this
  channel).
- [ ] Make a tool fail.
  **Expect (primary):** `tool.failed`. In companion mode, look instead
  for the same facts riding as `x.codex.otel.*` at whatever severity
  the vendor logged them.
- [ ] Trigger a config- or automation-level deny (not a human
  decision) if your Codex configuration has one.
  **Expect (primary):** `tool.denied` — this channel's `tool.denied`
  is scoped to config/automation denies specifically, distinct from a
  human rejection on the hook channel.

### 3 — Attention: read-only mirror

- [ ] There is no attention/approval surface on this channel at all.
  **Expect:** nothing to answer, nothing to observe here — if you
  want the approval loop, that's the [hook adapter](codex.md)'s beat
  3. Record this as n.a. in the results table rather than skipping the
  row silently.

### 4 — Cancel

- [ ] With the lane visible, press **Cancel run** — or note that no
  run ribbon exists to attach the button to in primary mode.
  **Expect:** if a run ribbon is present at all (only possible if the
  hook adapter is also feeding the same session in companion mode),
  the confirm dialog then an inline `cancel failed:` nack — this
  bridge declares no control capabilities, so the relay nacks
  `control.cancel` on its behalf. This is the correct sovereign
  result, not a bug.

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Generate one more OTel-exported
  event. Reopen the tab.
  **Expect:** the lane rebuilds from the persisted
  `(session, epoch, seq)` positions with no gaps.
- [ ] In session detail, drag the replay slider to window an earlier
  slice, then **Back to live**.
  **Expect:** the `replay` chip while windowed; the tail snaps back
  and follows.

Extra credit: check prompt content capture. `user.email` only appears
at `AEP_CAPTURE=full`; prompt text is **double-gated** — even at
`full` capture it only rides if Codex's own `otel.log_user_prompt`
setting is also enabled. Confirm both gates independently.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle: session.started, no run/session-end |  |  |
| 2 | Tool trio (no cause-link to a run) |  |  |
| 3 | Attention (n.a. — no surface on this channel) |  |  |
| 4 | Cancel: nack or n.a. |  |  |
| 5 | Replay / resume |  |  |

## Reset & re-run

Ctrl-C the bridge, Collector, and relay (the relay drains: SSE gets a
`shutting-down` comment, sockets close clean). There is no durable log
under this bridge itself — the relay plus `aep sink` own durability if
you want a capture file; keep whatever sink output you generated as
evidence for anything you file. Point Codex's OTel exporter (or the
Collector) elsewhere to detach entirely. Mission Control's saved
positions live in the browser's `localStorage` per relay URL; a fresh
browser profile is a clean observer.

## Session prompt for an assistant

Paste this into a fresh assistant session to help a tester bring up
the bridge and drive the script — this assistant is a **helper**, not
the agent under observation (a separate Codex session is observed):

```text
You are helping a tester run a guided live session against the AEP
Codex-over-OTLP bridge. You are not the agent being observed — a
separate Codex session exporting OTel telemetry is the subject; you
are assisting from outside.

Walk the tester through these steps, one at a time, confirming each
before moving on:

1. Confirm a relay is running with a token and Mission Control is
   connected to it (the testing index's shared setup).
2. Help the tester start the bridge (node impl/bridge-otlp-in/
   receiver.js, add --primary for this guide) and confirm
   GET http://127.0.0.1:4319/healthz reports relay:true.
3. Help the tester set up an OTel Collector that receives Codex's
   protobuf export and forwards to the bridge's /v1/logs endpoint
   using the otlphttp exporter with encoding: json — the bridge only
   accepts JSON and will refuse protobuf with a hint toward this fix.
4. Have the tester start a Codex session with OTel export pointed at
   the Collector and submit a prompt. Confirm a "codex" lane appears
   in Fleet. Point out explicitly that no run.started/run.finished
   will appear on this channel — that is by design, not a bug.
5. Have the tester ask for a tool-shaped action, then one that fails,
   watching for tool.completed/tool.failed without any run to
   cause-link them to.
6. Confirm there is no attention surface on this channel at all —
   nothing to trigger or answer here.
7. Have the tester try Cancel run in Mission Control if any run ribbon
   is visible, and note the result (most likely n.a. in primary mode
   with no hook adapter running).
8. Have the tester close and reopen the Mission Control tab after
   generating one more event, confirming a gap-free rebuild, then try
   the replay slider and Back to live.
9. Help the tester fill in the guide's results table with what
   actually happened, flagging any mismatch from the guide's expect
   lines — mismatches are the point of the session.

Be precise about ports, env vars, and file paths; if something in the
guide does not match what you observe, say so plainly rather than
smoothing it over.
```
