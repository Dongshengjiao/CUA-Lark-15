// M4: rewritten as the minimal owner of web-agent state + island chrome
// forwarders. The pre-M4 1545-line OpenIsland AppModel is gone; this
// version preserves only the property/method surface that
// IslandPanelView, OverlayPanelController, and OverlayUICoordinator
// actually depend on (verified via grep before the rewrite). New
// fields are added for the web-agent product (BridgeServer, runner
// supervisor stub, profile store stub, runnerOffline banner).
//
// Group 4 of m4-island-ui-rewrite replaces the local stub types with
// real LLMProfileStore + WebAgentRunnerSupervisor implementations.

import AppKit
import Foundation
import LarkIslandCore
import Observation
import SwiftUI

@MainActor
@Observable
final class AppModel {
    // MARK: - Static configuration

    static let hoverOpenDelay: TimeInterval = 0.15

    static let defaultStatusColors: [SessionPhase: String] = [
        .running: "#6E9FFF",
        .waitingForApproval: "#FFB547",
        .waitingForAnswer: "#FFD95A",
        .completed: "#42E86B",
    ]

    // MARK: - Persistence keys

    private static let soundMutedDefaultsKey = "overlay.sound.muted"
    private static let showDockIconDefaultsKey = "app.showDockIcon"
    private static let hapticFeedbackEnabledDefaultsKey = "app.hapticFeedbackEnabled"
    private static let islandAppearanceModeDefaultsKey = "appearance.island.mode"
    private static let islandClosedDisplayStyleDefaultsKey = "appearance.island.closedDisplayStyle"
    private static let islandHideIdleToEdgeDefaultsKey = "appearance.island.hideIdleToEdge"
    private static let islandPixelShapeStyleDefaultsKey = "appearance.island.pixelShapeStyle"
    private static let islandStatusColorsDefaultsKey = "appearance.island.statusColors"

    // MARK: - Localization

    let lang = LanguageManager.shared

    // MARK: - Owned subsystems

    /// SessionState reducer holding the state derived from web-agent events.
    var state = SessionState() {
        didSet {
            _cachedSessionBuckets = nil
            bridgeServer.updateStateSnapshot(state)
        }
    }

    @ObservationIgnored
    private var _cachedSessionBuckets: (primary: [AgentSession], overflow: [AgentSession])?

    /// Bridge server: spawns Unix socket listener and routes envelopes
    /// between observer (this app) and webAgentRunner (the Node child).
    let bridgeServer: BridgeServer

    /// Island chrome state forwarder.
    let overlay = OverlayUICoordinator()

    /// Profile + secrets storage. Group 4 replaces this stub with the
    /// real LLMProfileStore implementation (file + Keychain).
    var profileStore = StubProfileStore()

    /// Runner subprocess supervisor. Group 4 replaces this stub with the
    /// real WebAgentRunnerSupervisor implementation (Process spawn +
    /// crash backoff).
    var runnerSupervisor = StubRunnerSupervisor()

    // MARK: - Forwarder properties (read by IslandPanelView etc.)

    var notchStatus: NotchStatus {
        get { overlay.notchStatus }
        set { overlay.notchStatus = newValue }
    }

    var notchOpenReason: NotchOpenReason? {
        get { overlay.notchOpenReason }
        set { overlay.notchOpenReason = newValue }
    }

    var islandSurface: IslandSurface {
        get { overlay.islandSurface }
        set { overlay.islandSurface = newValue }
    }

    var isOverlayVisible: Bool { overlay.isOverlayVisible }

    var isOverlayCloseTransitionPending: Bool { overlay.isCloseTransitionPending }

    // MARK: - Simple appearance / behavior toggles

    var hapticFeedbackEnabled: Bool {
        didSet { UserDefaults.standard.set(hapticFeedbackEnabled, forKey: Self.hapticFeedbackEnabledDefaultsKey) }
    }

    var showDockIcon: Bool {
        didSet { UserDefaults.standard.set(showDockIcon, forKey: Self.showDockIconDefaultsKey) }
    }

    var isSoundMuted: Bool {
        didSet { UserDefaults.standard.set(isSoundMuted, forKey: Self.soundMutedDefaultsKey) }
    }

    var showsIdleEdgeWhenCollapsed: Bool {
        didSet { UserDefaults.standard.set(showsIdleEdgeWhenCollapsed, forKey: Self.islandHideIdleToEdgeDefaultsKey) }
    }

    var shouldAutoCollapseOnMouseLeave: Bool = true

    /// M4: completion-reply was a coding-agent feature; web-agent has no
    /// equivalent. Hard-code false so chrome height calculations that
    /// reference this flag default to 0 reply-input height.
    let completionReplyEnabled: Bool = false

    /// Notification-mode height measured by SwiftUI; chrome uses this when
    /// computing notch open height. Defaults to 0; ignored for web-agent
    /// task cards (they auto-size).
    var measuredNotificationContentHeight: CGFloat = 0

    /// Status color overrides for SessionPhase (light/dark theme).
    var statusColorHexes: [SessionPhase: String] = AppModel.defaultStatusColors

    // MARK: - Web-agent state

    /// True when the runner has crashed too many times in succession and
    /// supervisor stopped restarting it. UI displays a red banner.
    var runnerOffline: Bool = false

    /// Errors from BridgeServer / RunnerSupervisor surfaced to the user.
    var lastErrorMessage: String?

    /// Currently-active LLM profile name. Group 4 wires this to
    /// profileStore.defaultProfileName.
    var activeProfileName: String { profileStore.defaultProfileName ?? "qwen-default" }

    // MARK: - Init

    init() {
        let defaults = UserDefaults.standard
        self.hapticFeedbackEnabled = defaults.object(forKey: Self.hapticFeedbackEnabledDefaultsKey) as? Bool ?? true
        self.showDockIcon = defaults.object(forKey: Self.showDockIconDefaultsKey) as? Bool ?? false
        self.isSoundMuted = defaults.object(forKey: Self.soundMutedDefaultsKey) as? Bool ?? false
        self.showsIdleEdgeWhenCollapsed = defaults.object(forKey: Self.islandHideIdleToEdgeDefaultsKey) as? Bool ?? true
        self.bridgeServer = BridgeServer()
    }

    // MARK: - Lifecycle

    /// Start BridgeServer + spawn runner. Called from the AppDelegate
    /// after applicationDidFinishLaunching.
    func startIfNeeded() {
        do {
            try bridgeServer.start()
        } catch {
            lastErrorMessage = "BridgeServer start failed: \(error)"
            return
        }
        runnerSupervisor.start()
        overlay.appModel = self
        overlay.restoreDisplayPreference()
    }

    func shutdown() {
        runnerSupervisor.stop()
        bridgeServer.stop()
    }

    // MARK: - Web-agent commands (group 6 fully wires these)

    func startWebAgentTask(prompt: String) {
        guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        // Group 6 will implement: build BridgeCommand.runWebAgentTask
        // and bridgeServer.sendToRunner(command). Stubbed here so
        // group 4 UIs compile and call into a no-op.
        lastErrorMessage = "startWebAgentTask: not yet wired (group 6)"
    }

    func cancelCurrentTask() {
        // Group 6 + M5 cancel command.
    }

    // MARK: - Island chrome forwarders (called by OverlayPanelController)

    func notchOpen(reason: NotchOpenReason) {
        overlay.notchOpen(reason: reason)
    }

    func notchClose() {
        overlay.notchClose()
    }

    func notePointerInsideIslandSurface() {
        overlay.notePointerInsideIslandSurface()
    }

    func handlePointerExitedIslandSurface() {
        overlay.handlePointerExitedIslandSurface()
    }

    // MARK: - Derived session views (used by IslandPanelView + OverlayPanelController)

    /// Sessions that should appear on the island, ordered by priority.
    /// For web-agent v0 (single-task serial) this is at most one session.
    var surfacedSessions: [AgentSession] {
        state.sessions.filter(\.isVisibleInIsland)
    }

    var liveSessionCount: Int { state.liveSessionCount }

    var islandListSessions: [AgentSession] { surfacedSessions }

    var activeIslandCardSession: AgentSession? {
        state.activeActionableSession ?? surfacedSessions.first
    }

    // MARK: - Harness-mode flags (kept as simple bools; harness was deleted in M0b)

    var ignoresPointerExitDuringHarness: Bool = false
    var disablesOverlayEventMonitoringDuringHarness: Bool = false
}

// MARK: - Group 4 stubs

/// Stub that gets replaced by the real LLMProfileStore in group 4. Holds
/// a single hard-coded `qwen-default` profile so AppModel.activeProfileName
/// has a meaningful value before group 4 lands.
@MainActor
@Observable
final class StubProfileStore {
    var defaultProfileName: String? = "qwen-default"
}

/// Stub that gets replaced by the real WebAgentRunnerSupervisor in
/// group 4. Provides the `start()` / `stop()` surface AppModel calls,
/// but does not actually spawn a Process yet.
@MainActor
@Observable
final class StubRunnerSupervisor {
    var isRunning: Bool = false
    func start() { isRunning = false /* group 4 wires Process spawn */ }
    func stop() { isRunning = false }
}
