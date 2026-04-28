# Project: CUA-Lark-15

## Mission

Build **Lark Island** — a macOS dynamic-island companion that drives a
browser-sandboxed agent (powered by UI-TARS Browser Operator + Qwen3-VL-Plus)
to complete real-world web tasks (Feishu IM/Calendar/Docs first, then
generalized) without ever taking over the user's local mouse/keyboard.

## High-Level Architecture

```
Lark Island (Swift macOS app)  <-- IPC -->  Web Agent Runner (TS/Node)
        ↓                                            ↓
   user-facing UI                          headless Chromium sandbox
   (notch overlay,                         (Playwright + UI-TARS BO)
    input panel,                                    ↓
    LLM settings)                          OpenAI-compatible VLM
                                           (default: Qwen3-VL-Plus
                                            via DashScope)
```

## Repository Layout (Aggregation)

This repo is a **GPL v3 §5 aggregation**. Three components, three licenses:

| Subdirectory | Role | License | Notes |
|---|---|---|---|
| [`lark-island/`](../lark-island/) | macOS app shell | **GPL v3** | Forked from open-vibe-island @0fb4830 |
| [`runners/`](../runners/) | Web agent runner (Node) | Apache-2.0 | IPC-only with lark-island |
| [`larkvision/`](../larkvision/) | Frozen Python CUA archive | MIT | Vendored from TuriX-CUA, not actively maintained |
| [`openspec/`](.) | OpenSpec change proposals | this dir | The thing you are reading now |

License boundary detail: see [LICENSE.md](../LICENSE.md) and [NOTICE.md](../NOTICE.md).

## Tech Stack

- **macOS app**: Swift 6.2 + SwiftUI/AppKit (macOS 14+)
- **Runner**: Node 20+, TypeScript, `@ui-tars/operator-browser`,
  `@agent-infra/browser`, `@ui-tars/sdk`
- **Browser sandbox**: Chromium (Playwright/Puppeteer), headless by default,
  user-data-dir per skill
- **VLM (default)**: Qwen3-VL-Plus via DashScope OpenAI-compatible endpoint
  (`https://dashscope.aliyuncs.com/compatible-mode/v1`). Switchable via
  in-app LLM Settings to any OpenAI-compatible vision model
  (Doubao-1.5-UI-TARS, HF UI-TARS-1.5-7B, Azure OpenAI, etc.). Anthropic
  Claude reachable via user-run LiteLLM proxy.
- **IPC**: Unix domain socket at
  `~/Library/Application Support/LarkIsland/bridge.sock`,
  newline-delimited JSON (`BridgeEnvelope` codec).

## Development Workflow

This project uses **OpenSpec** for change management. Each new feature or
non-trivial fix gets its own `openspec/changes/<name>/` directory containing
proposal, design, tasks, and (later) archived completion record.

Active development happens on the `feat/lark-island` git branch (do **not**
push to `main` directly — see `lark-island/CLAUDE.md` for rules carried over
from upstream Open Island).

Non-OpenSpec project documents:
- [`/Users/neolix/Documents/CUA-Lark-15/.cursor/plans/island-web-agent-pivot_3704f689.plan.md`](../.cursor/plans/island-web-agent-pivot_3704f689.plan.md) — original pivot roadmap (pre-dates OpenSpec adoption)
- [`lark-island/NOTICE.md`](../lark-island/NOTICE.md) — fork modifications log under GPL v3 §4(b)

## Current Status (as of 2026-04-28)

- M0a Vendor: done (commit `dd4d28a`)
- M0b Strip files & Sparkle: done (commit `3f4f7b3`)
- License aggregation map: done (commit `696e444`)
- M0b Core rewrite: done (commit `18590dc`) — OpenIslandCore compiles cleanly
- **M0b App-layer prune**: in progress — ~750 dangling references in
  AppModel.swift / Views/* still need to be cut
- M0c Rename: not started
- M1+ Runner / Bridge / UI / Skills / Demo: not started

## Constraints to Remember

1. **GPL aggregation boundary**: never put a GPL v3 full-text file at the
   repo root (it would imply the whole repo is GPL); never compile-time
   link `lark-island/` Swift modules with `runners/` code.
2. **Local-first**: no servers, no telemetry, no analytics. Everything runs
   on the user's Mac.
3. **No mouse takeover**: the whole point of switching from
   larkvision (which used Quartz CGEvent to drive the desktop Lark app) is
   that the new browser-sandbox path leaves the user's local input devices
   alone.
4. **Single-user, single-task v0**: no concurrency, no multi-tenant. Just
   one runner serving the local user one task at a time.
