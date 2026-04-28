# web-agent-bridge fixtures

Canonical JSON encodings of `BridgeEnvelope` cases used by the M2
web-agent bridge protocol. Both the Swift test suite
(`Tests/LarkIslandCoreTests/WebAgentEventTests.swift`) and the
TypeScript test suite
(`runners/web-agent/test/bridge.test.ts`) read from this directory
to keep their codecs byte-compatible.

Conventions:
- All envelopes use `BridgeCodec` defaults: dates encoded as
  Unix milliseconds (integer), no key sorting, no pretty-printing.
- `1730000000000` ms = 2024-10-27 04:53:20 UTC. All fixtures use this
  timestamp deterministically.
- One fixture per envelope shape; envelopes are full
  `{"type":"...","<case>":...}` discriminated unions, ready to be
  written to the wire as a single newline-terminated frame.

If a test on either side fails to round-trip a fixture, the wire
schema has drifted between Swift and TypeScript — fix the offender
to match the fixture, not the other way around.
