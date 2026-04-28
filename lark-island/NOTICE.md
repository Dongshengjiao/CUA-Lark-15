# Lark Island — fork notice

This subdirectory is **forked from [open-vibe-island](https://github.com/Octane0411/open-vibe-island)**
and is licensed under **GPL v3** (see [`LICENSE`](LICENSE) for full
text).

## Fork point

- Upstream commit: `0fb48307538dc4bb37e3edbf8290ce7eb1f5211a`
  (main HEAD on 2026-04-28, "Merge pull request #397 from
  Octane0411/chore/contributors-v1.0.27", v1.0.27 contributor refresh)
- Vendored on: 2026-04-28
- Vendor method: `cp -R` (no `.git` history preserved); deleted the
  `ios/` subdirectory at fork time.

## Why fork

Open Vibe Island is a macOS companion for AI coding agents (Claude
Code, Codex, Cursor, Gemini CLI, Kimi CLI, OpenCode, etc.). We are
pivoting it into a different product — **Lark Island** — a macOS
companion for a *web-driven* general-purpose agent. The dynamic-island
shell, bridge transport, and overlay UI are reused; everything related
to monitoring local coding agents is removed.

## Modifications under GPL v3 §4(b)

The following changes have been made on top of the upstream commit.
Per GPL v3 §4(b), these are recorded here in lieu of (or in addition
to) per-file modification notices.

### M0a — Vendor (commit `dd4d28a`)
Pure copy of upstream tree at `0fb4830`, with `.git/` and `ios/`
removed. No code changes.

### M0b — Strip coding-agent monitoring (commit `3f4f7b3`)
Deleted entire feature surface for monitoring CLI coding agents:

**Sources/OpenIslandApp/ — 16 files removed**
- `ActiveAgentProcessDiscovery.swift`
- `CodexAppServerCoordinator.swift`
- `ForegroundTerminalSessionProbe.swift`
- `HarnessArtifactRecorder.swift`
- `HarnessLaunchConfiguration.swift`
- `HarnessRuntimeMonitor.swift`
- `HookInstallationCoordinator.swift`
- `IslandDebugScenario.swift`
- `KeystrokeInjector.swift`
- `ProcessMonitoringCoordinator.swift`
- `SessionDiscoveryCoordinator.swift`
- `TerminalJumpService.swift`
- `TerminalJumpTargetResolver.swift`
- `TerminalSessionAttachmentProbe.swift`
- `TerminalTextSender.swift`
- `UpdateChecker.swift` (Sparkle wrapper)

**Sources/OpenIslandCore/ — 36 files removed**
All `Claude*` / `Codex*` / `Cursor*` / `Gemini*` / `Kimi*` /
`OpenCode*` / `Warp*` variants of `Hooks`, `HookInstaller`,
`SessionRegistry`, `TranscriptReader`, `Usage`, plus
`AgentHookIntent`, `BridgeCommandClient`, `HookHealthCheck`,
`HooksBinaryLocator`, `WatchHTTPEndpoint`,
`WatchNotificationRelay`, `WorkspaceNameResolver`.

**Removed targets**
- `Sources/OpenIslandHooks/` (executable CLI invoked by agent hooks)
- `Sources/OpenIslandSetup/` (installer CLI for hook configs)

**Removed in `Package.swift`**
- `OpenIslandHooks` and `OpenIslandSetup` products and targets
- `Sparkle` package dependency and its product reference

**Removed elsewhere**
- `appcast.xml` (Sparkle update feed pointing to upstream releases)
- 24 corresponding test files in `Tests/OpenIslandAppTests/` and
  `Tests/OpenIslandCoreTests/`

### M0b (continued) — prune dangling references (pending)
The deletions in M0b commit `3f4f7b3` left dangling references in
retained files (notably `AppModel.swift`, `BridgeServer.swift`,
`AgentEvent.swift`, `AgentSession.swift`, `Views/SettingsView.swift`,
`Views/IslandPanelView.swift`, `Views/ControlCenterView.swift`,
`Localization/*.strings`). These will be pruned in a follow-up
commit once the Swift 6.2 toolchain is available locally to drive
the compiler-error walk.

### M0c — Rename to LarkIsland (pending)
Global rename of module/target/bundle identifiers, socket paths,
Application Support directory, log paths, environment variables, and
localization strings: `OpenIsland` → `LarkIsland`,
`open-island` → `lark-island`, `OPEN_ISLAND` → `LARK_ISLAND`,
`com.octane.openisland` → `ai.neolix.lark-island`.

### M1 onwards — new product direction
Subsequent commits add a Web Agent UI layer (input panel, overlay,
LLM settings) and integrate with a sibling Node runner at
[`../runners/web-agent/`](../runners/web-agent/) over Unix socket
IPC. See [`/.cursor/plans/island-web-agent-pivot_3704f689.plan.md`](../.cursor/plans/island-web-agent-pivot_3704f689.plan.md).

## Per-file prominent notices

GPL v3 §4(b) requires prominent notices on modified files. During
private development (this stage) we record changes centrally here.
Before any public distribution (DMG, GitHub release), a
batch-add of per-file `// Modified by Lark Island contributors,
2026-04-28. Originally from open-vibe-island. See
lark-island/NOTICE.md.` headers will be performed (planned in M7
release backlog).
