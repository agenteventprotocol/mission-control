# Reference-stack test fixtures

Vendored snapshots from
[`agenteventprotocol/reference`](https://github.com/agenteventprotocol/reference)
at commit `e4cb50ce80bd984a3898a761c1e9a00f30e2a326`, so the headless
end-to-end acceptance runs offline against the real protocol stack — the
relay with LRU eviction, `/healthz`, graceful drain, and the control auth
gate (tokenless is watch-only: commands are refused `unauthorized`, never
routed — AEP-0004 §4.1), and an agent that can hold a lingering run open
(`--linger <ms>`), stay connected past its terminals (`--close-grace <ms>`),
and honor `control.cancel` end to end:

| File | Source in the reference repo | Transform |
|---|---|---|
| `server.cjs` | `impl/relay/server.js` | renamed `.cjs` (this workspace is `type: module`); local require of `./aep.cjs`; capture-annotations path localized (registry not vendored — noted inline); fixture header |
| `aep.cjs` | `impl/shared/aep.js` | renamed `.cjs`; fixture header |
| `synthetic-agent.cjs` | `impl/demo/synthetic-agent.js` | renamed `.cjs`; local require of `./aep.cjs`; fixture header |

Behavior is otherwise identical. **Never edit these files here** — fixes
belong in the reference repo; then re-vendor and update the pin above.
The `ws` package they need is a regular dev dependency of the app.
