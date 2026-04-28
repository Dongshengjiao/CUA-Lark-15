# NOTICE

This file complements [LICENSE.md](LICENSE.md) by recording the
provenance of vendored / forked components and the third-party software
on which this aggregation depends.

---

## `lark-island/` — forked from open-vibe-island

- Origin: <https://github.com/Octane0411/open-vibe-island>
- Vendored at commit: `0fb48307538dc4bb37e3edbf8290ce7eb1f5211a`
  ("Merge pull request #397 from Octane0411/chore/contributors-v1.0.27",
  main HEAD as of 2026-04-28)
- Original copyright: Open Vibe Island contributors, 2025-2026
- License: GPL v3 (full text preserved at [`lark-island/LICENSE`](lark-island/LICENSE))
- Pivot summary: stripped of all "AI coding-agent monitoring" features
  (Claude Code, Codex, Cursor, Gemini CLI, Kimi, OpenCode hook listeners
  and terminal jump-back), retained as a UI shell for a new product
  direction — a web-agent companion driven by a UI-TARS Browser Operator
  runner (see [`runners/web-agent/`](runners/web-agent/)).
- Detailed change log: [`lark-island/NOTICE.md`](lark-island/NOTICE.md)

## `larkvision/` — frozen archive of TuriX-CUA fork

- Origin: <https://github.com/TurixAI/TuriX-CUA>
- Vendored at commit: `8f80ae656ebb72a86592128c87fde3ef1c49af17`
  (main "update QRcode")
- License: MIT (preserved at [`larkvision/LICENSE`](larkvision/LICENSE))
- Status: frozen on branch `feat-browser-base`; superseded by the
  `lark-island/` + `runners/web-agent/` direction. Kept for reference
  and for the 2026 Lark AI Campus Challenge FAQ Q4 attribution
  requirement. Detailed change log:
  [`larkvision/UPSTREAM.md`](larkvision/UPSTREAM.md)

## `runners/web-agent/` — design inspired by UI-TARS Browser Operator

- Reference: <https://github.com/bytedance/UI-TARS-desktop>
  (`packages/ui-tars/operators/browser-operator/`)
- License of reference: Apache-2.0
- Our implementation is original Python/TypeScript code; reference
  patterns adopted: `factors: [1000, 1000]` coordinate scaling,
  highlight-clickable-elements-before-screenshot, GUI/DOM/Hybrid
  strategy separation. No source code copied verbatim.
- npm dependencies (resolved at install time) carry their own licenses;
  see `runners/web-agent/package-lock.json` for the full graph.

---

## Aggregation boundary

Per [LICENSE.md](LICENSE.md), this repository is an aggregation under
GPL v3 §5. The boundary is preserved by:

1. No top-level `LICENSE` file containing GPL v3 (only this map).
2. `lark-island/` and `runners/` communicate exclusively via Unix
   socket IPC; no source imports, no static linking.
3. `larkvision/` is a frozen archive with no runtime coupling to other
   subdirectories.

Removing or refactoring any of these guarantees may collapse the
aggregation and propagate GPL v3 to the entire repository.
