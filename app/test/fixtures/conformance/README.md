# Conformance test fixtures

Vendored snapshot from
[`agenteventprotocol/agent-event-protocol`](https://github.com/agenteventprotocol/agent-event-protocol)
at commit `adbffe24433d0afa50279e3a3c51312cb0400df1`, so the consumer-class
self-certification suite (`app/test/conformance.test.ts`) runs offline
against the standard's own corpus:

| File | Source in the spec repo | Transform |
|---|---|---|
| `golden.jsonl` | `conformance/fixtures/golden/golden.jsonl` | none — byte-identical |

The corpus is the conformance class table's designated consumer input: it
covers all fourteen mandatory types (the success, failure, and cancel run
terminals; the answered and timed-out attention arcs; the form loop) and
deliberately contains shapes unknown to this app — a vendor extension type,
extension envelope attributes, foreign-emitter seq-less events, and an
agent-scoped event without a session.

**Never edit this file here** — corpus changes belong in the spec repo
(spec text + schemas + fixtures travel in one commit there); then re-vendor
and update the pin above.
