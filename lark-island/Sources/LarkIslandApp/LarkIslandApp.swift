// M4: minimal LarkIslandApp entry point.
//
// Differs from the upstream Open Island AppDelegate: no harness runtime
// monitor, no debug-scenario snapshot loading, no startup ceremony around
// hooks installation. The web-agent product just needs:
//   1. the menu bar / dock activation policy
//   2. a single AppModel that owns BridgeServer + RunnerSupervisor
//   3. SwiftUI scene wiring for Settings (group 4) — no main window
// Everything else (overlay window, runner spawn, BridgeServer listen)
// is set up by AppModel.startIfNeeded().

import AppKit
import SwiftUI

@main
struct LarkIslandApp: App {
    @NSApplicationDelegateAdaptor(LarkIslandAppDelegate.self) private var delegate

    var body: some Scene {
        // Minimal scene; the real UI lives in the menu bar extra and the
        // overlay panel. Settings are added in M4 group 4.
        Settings {
            EmptyView()
        }
    }
}

@MainActor
final class LarkIslandAppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel()

    func applicationDidFinishLaunching(_ notification: Notification) {
        ProcessInfo.processInfo.disableAutomaticTermination(
            "Lark Island stays active while the web-agent runner is alive."
        )
        ProcessInfo.processInfo.disableSuddenTermination()

        NSApp.setActivationPolicy(model.showDockIcon ? .regular : .accessory)
        model.startIfNeeded()
    }

    func applicationWillTerminate(_ notification: Notification) {
        model.shutdown()
    }
}
