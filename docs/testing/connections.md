# Guided session — the Connections view (onboarding & plumbing)

Exercises Mission Control's own plumbing surface end to end: zero-paste
onboarding off the setup tool's connect link, the automatic stream
bridge (the status-truth contract: the rail dot and the panel must
never contradict each other), one-click start scenarios, the labeled
overview graph, inline relay management, and failure-first
troubleshooting. Unlike the per-agent guides this one tests the
CONSUMER, not an adapter — no vendor agent is strictly required,
though beat 3 is best with one installed (any of the setup tool's
agents works).

## What you need

- Node ≥ 22 and a clone of
  [the reference stack](https://github.com/agenteventprotocol/reference).
- Mission Control served (`pnpm install && pnpm dev` →
  `http://127.0.0.1:8788`). Do **not** pre-configure anything — beat 1
  starts from a blank panel on purpose. (To rehearse the broken-state
  beats on a profile with history, that history is an asset — keep it.)
- **Forwarded-port setups** (VS Code Remote / WSL, SSH tunnels, a
  container): the browser talks to the RELAY port directly, not only to
  the app and ops ports — forward the relay port (default `8787`) too.
  `serve` prints the relay endpoint in its boot block for exactly this
  reason; auto-forwarders that watch terminal output pick it up from
  there. If you forget, beat 2's failure reading below shows the exact
  split you will see. Note the relay started by the Local stack binds
  the **same address family its URL names** (`127.0.0.1` = IPv4), so
  its loopback forward lands on IPv4 and the `http://127.0.0.1:8787`
  URL is reachable — a relay you start by hand without `AEP_HOST` binds
  dual-stack, whose WSL/SSH loopback mirror surfaces on IPv6 (`::1`)
  only and leaves the IPv4 URL refused even when "forwarded".

## Beats

1. **Zero-paste onboarding.** In the reference clone run
   `node impl/setup/aep-setup.js serve`. It prints a **connect link**
   (`http://localhost:8788/#/connections?ops=…&opsToken=…`). Open it.
   *Expect:* the Connections view loads with the Local stack section
   already connected (agent cards render); the address bar shows plain
   `#/connections` — the token was ingested and stripped, and nothing
   was copied or pasted. The CLI verbs stay printed beneath the link.

2. **The automatic bridge and the honest dot.** With `serve` connected
   and a relay up (use **Start relay** on the relay row if it is
   down): *expect* an "adopted from the local stack — stream token
   synced" receipt on the relay row, "Mission Control stream: live" on
   the row and on the relay card, and the rail dot **green** — through
   Mission Control's own stream connection, never cosmetically. No
   "Connect" click anywhere.
   *Failure reading — the two-vantage split:* if the receipt appears
   but the stream flips to `error` with `net::ERR_CONNECTION_REFUSED`
   in the console while the relay row still says up, the stack reaches
   its relay and your browser does not. Two causes: the relay port is
   not forwarded (forward it — VS Code: Ports panel), OR it is
   forwarded but on a different address family than the URL — a
   dual-stack relay's loopback forward surfaces as IPv6 `::1` while
   `http://127.0.0.1:8787` pins IPv4, so the request is refused even
   though the port shows forwarded. The Local stack's relay avoids the
   second case by binding `127.0.0.1` to match its URL; if you hit it
   with a hand-started relay, **Start relay**/restart from the Local
   stack rebinds it. The row and the card say this and name the remedy;
   a bare "is it running?" here would be a finding — the relay IS
   running.

3. **One-click scenario.** Pick an installed agent's card → **Start**.
   Leave the defaults (register when missing, open Fleet) and run it.
   *Expect:* a receipt line per executed step naming the CLI call it
   mirrors; vendor consent steps the tool cannot perform surface as
   explicit manual beats; on all-green the app lands in Fleet filtered
   to that agent, and once the agent emits, lanes appear.

   Every agent and bridge card — including the info-only manual ones —
   carries a **testing guide** link beneath its CLI hint: one hop to
   that subject's checklist in `docs/testing/<id>.md` (the card id is
   the guide slug). *Expect:* the link opens the matching per-agent or
   per-bridge guide in a new tab.

   With a relay up and the agent connected, its **Instances** block
   shows a row `on the relay @<instance>` (with the control verbs it
   accepts and its session ids) drawn from the relay's own
   `/connections` — a distinct truth from the store-derived "seen on
   the stream" count below it. *Expect:* the two can differ (a party
   can appear before Mission Control has seen an event), and the parties
   row disappears when the relay is stopped.

4. **Failure-first troubleshooting.** Stop the relay (relay row →
   **Stop**). *Expect:* the stream state flips to `error` WITH its
   detail and a plain-language suggestion (relay card, rail-dot
   tooltip, overview edge title) — never a bare "error". Open Fleet
   with no sessions: the empty state names the stream error, the
   suggestion, and links back to Connections. **Start relay** again:
   the stream recovers by itself (the SDK retries; resume survives a
   relay restart).

5. **The overview reads at a glance.** *Expect:* three labeled columns
   (Agents → Relays → Mission Control), a legend in plain words
   (events flowing / connecting / stream error / not connected),
   port-labeled relay chips with the `local stack` tag on the managed
   one; agent chips navigate to Fleet (`#/fleet?q=<agent>`), relay
   chips scroll to their card. With the Local stack connected, the
   **ops server is its own node** (port-labeled, under Mission
   Control): the MC↔ops edge is colored by the panel's reachability, a
   dashed `manages` edge runs to the managed relay, agents the stack
   manages carry a dot marker, and the legend names both new edge
   kinds — how the ops layer relates to agents, relays, and this panel
   is on the diagram itself. An ops layer visible in the panel below
   but absent from the diagram would be a finding.

6. **Inline relay management (the one surface).** The rail gear routes
   to `#/connections` — there is no separate relay dialog. Under
   **Manage relays**, add a bogus relay (`http://127.0.0.1:9999`) and
   Apply. *Expect:* a second rail dot appears and goes red with an
   "is it running?" suggestion in its tooltip; the overview grows a
   second band with a dashed red edge. Remove it again the same way.

7. **Longevity: the stream must survive a profile that has watched
   many sessions.** The resume set is bounded on the wire and capped
   in storage, so the stream request can never grow past server header
   limits. If any relay shows a permanent `error` with a healthy
   relay, that is a finding; the failure detail on the card is the
   first thing to paste into the report.

## Report

File observations as an issue on this repository, the repo that
documents these claims (the [index](README.md#recording-results) has
the shared guidance). Name the beat, what rendered (receipts, states,
dots), and any failure detail text verbatim.
