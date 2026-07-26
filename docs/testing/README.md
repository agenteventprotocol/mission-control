# Guided live sessions — the tester's index

One guide per capture surface, each a checklist-style script you run
against a live agent with Mission Control open. The goal is a repeatable
observation pass: bring the surface up, drive the same five beats every
guide shares, and record what you saw. Install/run steps for Mission
Control itself: [user-guide.md](../user-guide.md); a tour of the views:
[views.md](../views.md).

Every guide states its surface's verification status honestly. Most
mappings are fixture-proven with live-session validation pending — these
guided sessions are exactly how that gap closes, so please record
mismatches, not just passes.

## What every session needs

- **A relay with a token.** Control flows only on authenticated bindings
  (AEP-0004 §4.1) — a tokenless relay is watch-only and refuses commands
  with `unauthorized`. From a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference):

  ```sh
  cd reference && (cd impl/relay && npm ci)
  AEP_TOKEN=<token> node impl/relay/server.js
  ```

  The startup line confirms the auth state (`auth on`). Health:
  `GET /healthz` → `{"ok":true}`.

- **Mission Control connected to it.** `pnpm install && pnpm dev` here
  serves `http://127.0.0.1:8788`; go to **Connections** (the rail's
  cable icon, or the gear at the rail's foot) → **Manage relays**, enter
  the relay URL (default `http://127.0.0.1:8787`) and the same token,
  then **Apply**. The rail dot breathes green when live events are
  flowing. (With the setup tool's `serve` running, this is automatic —
  see below.)

- **The surface itself** — its guide's "Bring the stack up" section has
  the exact commands, ports, and env vars, quoted from the adapter or
  bridge it drives.

## Quick setup (automated)

The reference repo ships a setup tool that automates the per-agent steps
above so a live session starts in minutes — the manual path in each guide
stays canonical and is what the tool executes:

```sh
cd reference
node impl/setup/aep-setup.js detect              # what is installed, what is running
node impl/setup/aep-setup.js write <agent>       # apply the hook/plugin registration (backed up, idempotent)
node impl/setup/aep-setup.js up <agent>          # relay + daemon, wait healthy, print the URL + token to paste here
```

`print <agent>` emits the finished config for your machine (absolute
paths already substituted) when you prefer applying it by hand, and
`down` stops what `up` started. Agent ids match the guide filenames:
`claude-code` `codex` `gemini-cli` `qwen-code` `vscode` `opencode`
`kilocode` `cline` `hermes` `antigravity` `pi` `kimi-code` (for `vscode` and other
workspace-native registrations, either run `write` from the workspace
you will drive or pass `--project-dir <that workspace>`). Runtime
options ride `up <agent> --env KEY=VALUE` (repeatable), validated
against the agent's documented options catalog. Details:
[`impl/setup/`](https://github.com/agenteventprotocol/reference/tree/main/impl/setup)
in the reference repo. Bridges keep their guides' manual attach (each is
a different shape — tee, socket, receiver — with its own upstream).

Prefer clicking? `node impl/setup/aep-setup.js serve` starts the same
flows as a local ops API and prints a **connect link** — open it and
Mission Control's **Connections view** (`#/connections`) is configured
and driving them from the browser: that one `serve` command is the only
terminal step left, and nothing is pasted (the credentials ride the URL
fragment; the printed URL + token stay the manual path). The panel
adopts the local relay's stream token automatically — the rail dot
greens through Mission Control's own stream, never cosmetically. Start
runs the whole scenario
in one click (register when missing, start with runtime options off
the catalog form, and land in Fleet), with a receipt per
step; plus per-adapter health, stop/restart, log tails, preview-first
registration with an optional project directory, a standalone relay
start, and a cross-relay overview graph in labeled columns with a
legend and port-labeled relay chips. Stream failures render their
detail plus a plain-language suggestion on the relay card, the rail
dot's tooltip, and the Fleet empty state. Every
panel action shows the CLI line it mirrors, so the commands above stay
the canonical (and scriptable) path.

## Rehearse on the synthetic fleet first

`./run-demo.sh` in this repo boots everything with zero vendor installs:
a relay, the served production build, and a synthetic fleet that raises
one attention request per batch. The synthetic agents declare
`control.attention.respond` **and** `control.cancel`, so this is the one
setup where every beat — including **Cancel run** settling as a real
cause-linked `run.cancelled` — completes end to end from the UI. Do this
once before any real surface: it teaches you what a full pass looks
like. (`./run-demo.sh --once` is the same boot, self-asserting.)

## The five beats

Every guide drives the same arc, adapted to what its surface honestly
emits:

1. **Lifecycle** — start a session; watch the lane appear in Fleet
   (`session.started`, then `run.started` when work begins).
2. **Tool trio** — make the agent use tools; watch `tool.requested` /
   `tool.completed` (and `tool.failed` or its documented absence) pair up
   in the session Timeline.
3. **Attention** — trigger the surface's approval or input moment. On
   respond-capable surfaces, answer it from the Attention center —
   option buttons or typed text (receivers honor an option word as that
   option; on permission gates other free text lands as a deny with
   your words as the reason, per AEP-0008) — and watch the decision
   land back in the agent. On observe-only surfaces the guide says so,
   names the mechanism, and you observe the vendor-side decision arrive
   on the stream instead. A request that DECLARES its channel
   (`respond_via` without `control`) renders as information — menu
   chips and an "answered in the agent's own UI" note, no send
   affordance (AEP-0008: the request's own declaration is
   authoritative). Requests that declare nothing keep the reply box
   everywhere (capability claims are not consumer-visible in 0.1, so
   send-and-settle stays the honest posture); a reply such a target
   cannot take earns the designed `unsupported` nack, after which the
   card carries an observed-refusal advisory and the session's
   **Control** tab records the settle.
4. **Cancel** — stop work the way the surface really supports (usually
   vendor-side) and verify the honest terminal on the wire. Mission
   Control's **Cancel run** sends `control.cancel`; the agent stays
   sovereign — no shipped adapter accepts it today, so on real surfaces
   expect the inline `cancel failed` nack, itself a correct result.
5. **Replay / resume** — close the tab mid-session, generate more
   events, reopen: lanes rebuild from the persisted `(session, epoch,
   seq)` positions with no gaps. Then window the Timeline with the
   replay slider and snap **Back to live**.

Each guide ends with a results table to fill in and a session prompt you
can paste into a fresh assistant session so an agent can help drive the
script and record the outcome.

## The surfaces

| # | Guide | Kind | Verification status | Respond from Mission Control |
|---|---|---|---|---|
| 1 | [Claude Code](claude-code.md) | hook adapter | validated live end to end (permission + structured-input loops) | yes — permission + form loops |
| 2 | [Codex](codex.md) | hook adapter | validated live end to end (observation + sovereign cancel refusal) | yes — permission loop |
| 3 | [Qwen Code](qwen-code.md) | hook adapter | documented + fixture-proven, live pending | yes — permission loop |
| 4 | [Gemini CLI](gemini-cli.md) | hook adapter | documented + fixture-proven, live pending | no — observability-only hooks |
| 5 | [OpenCode](opencode.md) | plugin adapter | documented + fixture-proven, live pending | yes — permission loop |
| 6 | [Kilo Code](kilocode.md) | plugin adapter | types-verified + fixture-proven, live pending | yes — permission loop |
| 7 | [Cline](cline.md) | hook adapter | types-verified + fixture-proven, live pending; hub control leg smoke-proven | opt-in — hub leg: permission loop + vendor-side cancel + send input (`AEP_CLINE_HUB_CONTROL=1`) |
| 8 | [Hermes](hermes.md) | hook adapter | source-verified + fixture-proven, live pending; control + steering legs smoke-proven; the clarify form overlay smoke- and fixture-proven | opt-in — operator-deny gate on held tool calls (`AEP_HERMES_CONTROL=1`; the vendor's own gate stays read-only; steering via `x.hermes.control.instruct` under `AEP_INSTRUCT=1` — turn-start context injection; cancel nacked in every posture; the `clarify` form card is observed via `oob`, always on) |
| 9 | [Antigravity](antigravity.md) | hook adapter | docs-verified + fixture-proven, live pending | no — approval outcomes not hook-visible |
| 10 | [pi](pi.md) | extension adapter | fixture-proven, live pending; control leg smoke-proven | opt-in — operator gate on held tool calls (`AEP_PI_CONTROL=1`; deny lands `tool.failed`, never `tool.denied`; cancel nacked in every posture) |
| 11 | [VS Code agent (Copilot)](vscode.md) | hook adapter | source-pinned + fixture-proven, live pending; permission gate + steering leg smoke-proven | opt-in — held PreToolUse gate on the vendor's own allow/deny/ask surface (`AEP_VSCODE_CONTROL=1`; ask escalates to VS Code's own approval dialog; steering via `x.vscode.control.instruct` under `AEP_INSTRUCT=1`; cancel nacked in every posture) |
| 12 | [Kimi Code CLI](kimi-code.md) | hook adapter | **live-validated** (the five-beat guide run: lifecycle, tool pair + failure twin, the permission pair, Interrupt, both opt-in legs) | opt-in — held PreToolUse gate on the vendor's binary allow/deny surface (`AEP_KIMI_CONTROL=1`; a free-text deny relays the reason into Kimi's own TUI and lands `tool.denied` by policy; allow is "no hook objection" — the vendor's own permission flow still runs downstream; steering via `x.kimi-code.control.instruct` under `AEP_INSTRUCT=1`; cancel nacked in every posture; the vendor's own permission pair is observed via `oob`, always on) |
| 13 | [ACP](bridge-acp.md) | protocol bridge (stdio tee) | fixture-proven, live pairing pending | no — read-only channel |
| 14 | [AG-UI](bridge-agui.md) | protocol bridge (HTTP tee) | fixture-proven, live pending | no — read-only channel |
| 15 | [OpenHands](bridge-openhands.md) | protocol bridge (WebSocket observer) | fixture-proven, live pending; control leg smoke-proven | opt-in (control leg: permission loop + the first real pause/resume + send-input and the interrupt escalation, `AEP_OPENHANDS_CONTROL=1`; cancel refused by design) |
| 16 | [Codex over OTLP](bridge-otlp-in.md) | telemetry bridge | fixture-proven in both modes, live pending | no — telemetry mirror |
| 17 | [OpenCode over SSE](bridge-opencode-sse.md) | protocol bridge (SSE observer) | fixture-proven, live pending; control leg smoke-proven | opt-in (control leg, primary mode: permission loop + run cancel over REST, `AEP_OPENCODE_SSE_CONTROL=1`; read-only by default) |
| 18 | [Kilo Code over SSE](bridge-kilocode-sse.md) | protocol bridge (SSE observer) | fixture-proven, live pending; control leg smoke-proven | opt-in (control leg, primary mode: permission loop + run cancel over REST, `AEP_KILOCODE_SSE_CONTROL=1`; read-only by default; the OpenCode channel's fork twin: the two surfaces expose the same event union) |
| 19 | [Kimi over the web channel](bridge-kimi-code-web.md) | protocol bridge (WebSocket observer) | fixture-proven (wire shapes oracle-captured from the shipped 0.28.1), live pending; control leg smoke-proven | opt-in (control leg, primary mode: approval decisions in the vendor's own `approved`/`rejected` vocabulary + run cancel over REST, `AEP_KIMI_WEB_CONTROL=1`; read-only by default — reaches kap-hosted `kimi web` sessions only, the terminal TUI has no server surface) |
| 20 | [Connections view](connections.md) | Mission Control itself (consumer plumbing) | component/e2e-proven, live retest pending | n/a — tests the panel: zero-paste onboarding, the automatic bridge, scenarios, troubleshooting |

Port defaults at a glance: relay `8787` · app `8788` · adapter daemons
`8377` (Claude Code), `8378` (Codex), `8379` (Gemini CLI), `8380` (Qwen
Code), `8381` (VS Code agent), `8390` (OpenCode), `8391` (Kilo Code),
`8392` (Cline), `8393` (Hermes), `8395` (Antigravity), `8396` (pi),
`8398` (Kimi Code CLI) · bridge listeners/health
`8394` (ACP), `4321` (AG-UI), `8397` (OpenHands), `4319` (OTLP), `4320`
(OpenCode SSE), `4322` (Kilo SSE), `4323` (Kimi web). Every daemon and bridge serves `GET /healthz`.

## Recording results

Fill the guide's results table as you go — pass/fail plus what you
actually saw, especially where it differs from the guide's "expect"
line. A mismatch between a doc claim and live behavior is the most
valuable outcome a session can produce; please file it as an issue on
the repo that documents the claim, with the event JSON from the
Inspector (one button copies it) attached.
