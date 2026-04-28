# License Map

This repository (`CUA-Lark-15`) is an **aggregation** of multiple components
under different open source licenses, governed by GPL v3 §5 ("mere
aggregation"). Each subdirectory is governed by its own license.

There is **no single project-level license**. To use any component, refer
to its directory-local `LICENSE` file.

## Subdirectory License Map

| Subdirectory | License | Notes |
|---|---|---|
| [`lark-island/`](lark-island/) | **GPL v3** | Forked from [open-vibe-island](https://github.com/Octane0411/open-vibe-island) commit `0fb4830` (2026-04-28). Modifications under GPL v3. See [`lark-island/LICENSE`](lark-island/LICENSE) for the full text and [`lark-island/NOTICE.md`](lark-island/NOTICE.md) for the change log. |
| [`runners/`](runners/) | **Apache-2.0** (our code) + per-package licenses for npm dependencies | Communicates with `lark-island/` only via Unix socket IPC (no compile-time linking, no module imports). Therefore not a derivative work of `lark-island/`. See [FSF GPL FAQ — GPLAndPlugins](https://www.gnu.org/licenses/gpl-faq.html#GPLAndPlugins). |
| [`larkvision/`](larkvision/) | **MIT** | Vendored from [TurixAI/TuriX-CUA](https://github.com/TurixAI/TuriX-CUA). Frozen archive, no longer actively maintained. See [`larkvision/LICENSE`](larkvision/LICENSE) and [`larkvision/UPSTREAM.md`](larkvision/UPSTREAM.md). |
| Top-level docs (`docs/`, `plan/`, `README.md`, `NOTICE.md`, this file) | Unspecified (treat as all-rights-reserved unless individual files state otherwise) | Project-internal documentation. |

## Why "aggregation, not a single project license"?

GPL v3 §5 explicitly permits storing GPL programs alongside non-GPL programs
on the same medium (e.g. one git repository) **as long as the components are
independent works**, not derived from one another. The FSF FAQ confirms that
inter-process communication (Unix sockets, pipes, HTTP) does **not** create
a derivative work, so a GPL component can call (or be called by) non-GPL
components in the same aggregate without copyleft propagation.

If we ever combined `lark-island/` and `runners/` at the source-import or
static-link level, the aggregation boundary would collapse and
`runners/` would have to be relicensed under GPL v3. We avoid this by
design: communication is exclusively over a documented Unix socket
protocol.

## Unbundling

Any subdirectory can be split out into a standalone repository at any
time, retaining its license. For example,
`git subtree split --prefix=lark-island/` produces a standalone GPL v3
repo without any license re-negotiation.

## Distribution

If we eventually distribute compiled binaries (DMG, App Store, GitHub
Release), the GPL v3 §6 "Conveying Non-Source Forms" provisions take
effect for the `lark-island/` portion: source must be made available
alongside the binary. The `runners/` and `larkvision/` portions retain
their own redistribution requirements (Apache-2.0 NOTICE, MIT
attribution).
