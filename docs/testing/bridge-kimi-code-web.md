# Guided session — Kimi over the web channel (kap-server)

Observes a running `kimi web` server through the reference bridge
(`reference/impl/bridge-kimi-code-web/`) — zero-install observation
over the server's own WebSocket event stream, no hook file needed.
Cross-link: the [Kimi Code CLI](kimi-code.md) guide covers the hook
adapter this bridge can either complement or replace — and note the
scope: this channel reaches **kap-hosted (`kimi web`) sessions only**;
the interactive terminal TUI has no server surface by vendor design.
**Fixture-proven (wire shapes oracle-captured from the shipped 0.28.1;
control leg smoke-proven), live validation pending.**

**Respond from Mission Control: opt-in** — observation-only is the
DEFAULT posture (nothing can answer through the stream itself), and
`AEP_KIMI_WEB_CONTROL=1` in `--primary` mode pairs the stream with
exactly two REST writes: the approval decision and a run-scoped cancel
(beat 6). Companion mode is read-only always.

## What you need

- Node ≥ 22, a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference),
  and Kimi Code CLI ≥ 0.28.1 (`@moonshot-ai/kimi-code` — the scoped
  package).
- A running kap-server: `kimi web --no-open` (default
  `http://127.0.0.1:58627`; the bearer token is printed at startup and
  persisted at `~/.kimi-code/server.token`).
- Mission Control running and connected to a **tokened** relay
  (the [index](README.md) has the shared setup).

## Bring the stack up

```sh
# 1 — relay (skip if already up from the index setup)
AEP_TOKEN=<token> node impl/relay/server.js &

# 2 — the bridge, attaching to the kap-server's WS stream
AEP_TOKEN=<token> node impl/bridge-kimi-code-web/receiver.js &            # companion (default)
AEP_TOKEN=<token> node impl/bridge-kimi-code-web/receiver.js --primary &  # stream-only
```

The bridge attaches to `/api/v1/ws` on `AEP_KIMI_WEB_URL` (default
`http://127.0.0.1:58627`) with the vendor's bearer subprotocol; the
token comes from `AEP_KIMI_WEB_TOKEN` or, left empty, from the vendor's
own `~/.kimi-code/server.token` file — the zero-config local attach.
Check `GET http://127.0.0.1:4323/healthz` →
`{ ok, relay, source, control }` (`AEP_KIMI_WEB_PORT` changes the
port): `relay` is the WS binding to the AEP relay, `source` is the
attachment to the kap-server — both reconnect on whichever of
error/close fires first.

Two modes, chosen at startup:

- **companion** (default) — the external hooks in the one global
  `config.toml` fire for kap-hosted sessions too, so if the
  [Kimi hook adapter](kimi-code.md) is running it remains the **sole
  core-type authority**: this bridge emits only the channel-visible
  `x.kimi-code.web.*` family, zero core types. Run this guide's beats
  in a kap session while the hook adapter is up to see the extra
  channel-visibility rows land alongside the core lane it already
  produces.
- **`--primary`** — a stream-only deployment (no hooks registered):
  the wire mapping applies, with the vendor's REAL turn boundaries
  carrying the run pair (no synthesis on this channel).

For beat 6 only, restart the primary bridge with the control gate:

```sh
AEP_TOKEN=<token> AEP_KIMI_WEB_CONTROL=1 \
  node impl/bridge-kimi-code-web/receiver.js --primary &
```

`/healthz` gains `control: true` exactly when the gate is honored
(set AND primary — companion ignores it).

## The guided script

Drive the session from the **kimi web UI in the browser** (that is the
kap-hosted client; a terminal `kimi` session is a different engine this
bridge cannot see). Find your lane in Fleet by agent name:
**kimi-code**.

### 1 — Lifecycle: real turn boundaries

- [ ] Create a session in the kimi web UI and submit a prompt.
  **Expect (primary):** `run.started` opens on the vendor's own
  `turn.started` (trigger `user`) — note there is NO `session.started`
  on this channel (kap sessions outlive connections; nothing is
  fabricated). **Expect (companion):** `x.kimi-code.web.turn.started`
  and friends land as channel rows; the core lane, if present, belongs
  to the hook adapter.
- [ ] Let the turn finish.
  **Expect (primary):** `run.finished` on `turn.ended` reason
  `completed`, cause-linked to the start.

### 2 — Tool pair

- [ ] Ask for one harmless tool call (e.g. run `echo`).
  **Expect (primary):** `tool.requested` (name + call id, args digest)
  then `tool.completed` paired by call id — the result names no tool on
  the wire, so the bridge re-attaches the name it recorded at the
  request.
- [ ] Make a tool fail.
  **Expect (primary):** `tool.failed` with the error message at the
  redacted ceiling — this channel HAS the failure split.

### 3 — Attention: observe the vendor-side decision

- [ ] With the control gate **off** (the default posture), trigger a
  tool Kimi asks approval for, and answer it **in the kimi web UI**.
  **Expect (primary):** `attention.requested` (kind `permission`,
  subject = the approval id) with **no options and no `respond_via`**
  — nothing can answer through the stream. The web-UI answer lands
  `attention.answered` (`via: "oob"`, the decision word as the option,
  any feedback as `answer.text`) plus `attention.resolved`.
- [ ] Abort a turn while an approval is pending (Esc in the web UI or
  the UI's stop control).
  **Expect:** the pending ask stands down as `attention.resolved`
  (`resolution: "dismissed"` — the wire resolve carries no decision),
  and the run closes as `run.cancelled` on the vendor's own
  `turn.ended` reason `cancelled`.

### 4 — Cancel (default posture)

- [ ] With a run visible and the control gate **off**, press
  **Cancel run** on the lane.
  **Expect:** the confirm dialog, then an inline `cancel failed:` nack
  — gated off this bridge declares no control capabilities, so the
  relay nacks `control.cancel` on its behalf. The correct sovereign
  result, not a bug (the gated-on cancel is beat 6).

### 5 — Replay / resume

- [ ] Close the Mission Control tab. Generate one more event in the
  kimi web session. Reopen the tab.
  **Expect:** the lane rebuilds from the persisted
  `(session, epoch, seq)` positions with no gaps.
- [ ] Restart the kap-server (`kimi web`) or the bridge process
  mid-session, then let the bridge reattach.
  **Expect:** `source` in `/healthz` flips and recovers; the bridge
  re-lists sessions and re-subscribes on its own reconnect logic.

### 6 — Control (opt-in, primary mode only)

Restart the primary bridge with `AEP_KIMI_WEB_CONTROL=1` (see the
bring-up section) and confirm `/healthz` shows `control: true`. No
Mission Control change is needed — the same answer card and Cancel-run
button drive it.

- [ ] Trigger an approval moment.
  **Expect:** the attention card now carries the vendor's own two
  decisions — **Approve / Reject** — because the request arrived with
  `options` and `respond_via: ["control"]`.
- [ ] Answer **Reject** and include free text.
  **Expect:** the send settles (ack), the text reaches Kimi as the
  `feedback` the vendor renders as the rejection reason, and the
  Timeline shows `attention.answered` (`via: "control"`, cause-linked
  to your command) then `attention.resolved` — the outcome rides the
  vendor's own `event.approval.resolved` broadcast, not the bridge's
  REST 200. The blocked call lands `tool.failed` with the vendor's own
  rejection text.
- [ ] Try a free-text reply **without choosing an option**.
  **Expect:** an inline `invalid` refusal — the vendor decision surface
  needs `approved` or `rejected`; text rides WITH a decision, never
  instead of one.
- [ ] With a run active, press **Cancel run**.
  **Expect:** the confirm dialog, an accepted send, and the run closing
  as `run.cancelled` (cause-linked to your command) when the vendor's
  own `turn.ended` reason `cancelled` boundary lands — the bridge
  drives the session's active-work abort. A pending approval in that
  turn stands down as dismissed.
- [ ] Press **Cancel run** again while the session is idle (no run).
  **Expect:** an inline `refused` nack — no open run exists to cancel.
- [ ] Answer an approval from the kimi web UI itself while the gate is
  on.
  **Expect:** the plain oob `attention.answered`/`attention.resolved`
  pair — a vendor-side decision keeps the plain path; only
  command-driven answers ride `via: "control"`.

## Results

| # | Beat | Result (pass / fail / n.a.) | What you saw |
|---|---|---|---|
| 1 | Lifecycle: real turn boundaries, no fabricated session lifecycle |  |  |
| 2 | Tool pair incl. tool.failed |  |  |
| 3 | Attention observed (oob answer; abort stands the ask down) |  |  |
| 4 | Cancel: sender-side nack gated off |  |  |
| 5 | Replay / resume incl. source reconnect |  |  |
| 6 | Control opt-in: Approve/Reject card, feedback text, commanded cancel, idle refusal, vendor-side plain path |  |  |

## Reset & re-run

Ctrl-C the bridge and relay. The bridge's per-session JSONL logs live
under `~/.aep/logs/kimi-code-web-<mode>/` — keep them; they are the
capture evidence for anything you file. The kap-server needs no
cleanup (the attach is zero-install); stop `kimi web` with Ctrl-C in
its terminal. Mission Control's saved positions live in the browser's
`localStorage` per relay URL; a fresh browser profile is a clean
observer.

## Session prompt for an assistant

Paste this into a fresh assistant session to help a tester bring up
the bridge and drive the script — this assistant is a **helper**, not
the agent under observation (the kimi web session is observed):

```text
You are helping a tester run a guided live session against the AEP
Kimi-web bridge. You are not the agent being observed — a kimi web
(kap-server) session in the browser is the subject; you are assisting
from outside.

Walk the tester through these steps, one at a time, confirming each
before moving on:

1. Confirm a relay is running with a token and Mission Control is
   connected to it (the testing index's shared setup).
2. Confirm a kap-server is up: kimi web --no-open (default port
   58627; the bearer token persists at ~/.kimi-code/server.token —
   the bridge reads it automatically when AEP_KIMI_WEB_TOKEN is
   unset). Remind the tester the terminal kimi TUI is a different
   engine this bridge cannot see — every beat drives the WEB UI.
3. Ask whether the Kimi hook adapter (kimi-code.md) is also running.
   If yes, run the bridge in companion mode (default); if no, run it
   with --primary. Note which mode you're using.
4. Help the tester start the bridge and confirm
   GET http://127.0.0.1:4323/healthz reports relay:true and
   source:true.
5. Have the tester create a session in the kimi web UI and submit a
   prompt. In primary mode, confirm run.started opens on the vendor's
   own turn boundary and that NO session.started appears (nothing is
   fabricated on this channel); in companion mode, confirm the
   x.kimi-code.web.* channel rows instead.
6. Have the tester ask for a harmless tool call, then a failing one.
   Confirm the tool pair pairs by call id and the failure lands
   tool.failed.
7. With the control gate OFF, have the tester trigger an approval and
   answer it in the kimi web UI (not Mission Control — the default
   posture has no respond path). Confirm the oob answered/resolved
   pair. Then have them abort a turn with an approval pending and
   confirm the ask stands down dismissed and the run closes
   run.cancelled.
8. Have the tester press Cancel run with the gate OFF and confirm the
   inline "cancel failed:" nack (the correct sovereign result).
9. Have the tester close and reopen the Mission Control tab after one
   more event (gap-free rebuild), then restart the kap-server or the
   bridge and confirm the source reconnects.
10. Restart the primary bridge with AEP_KIMI_WEB_CONTROL=1 and confirm
    /healthz gains control:true. Then, in order: answer an approval
    from the Mission Control card (expect the two vendor decisions
    Approve / Reject; attention.answered via control cause-linked,
    then attention.resolved — the outcome rides the vendor's own
    broadcast); reject one WITH free text and confirm the text reaches
    Kimi as the rendered rejection reason; try free text without an
    option (expect an inline invalid refusal — an expectation, not a
    failure); cancel an active run (expect run.cancelled cause-linked
    at the vendor's own cancelled boundary); cancel again while idle
    (expect refused); and answer one approval from the kimi web UI
    itself (expect the plain oob pair with no via:"control").
11. Help the tester fill in the guide's results table with what
    actually happened, flagging any mismatch from the guide's expect
    lines — mismatches are the point of the session.

Be precise about ports, env vars, and file paths; if something in the
guide does not match what you observe, say so plainly rather than
smoothing it over.
```
