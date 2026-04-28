// M4: minimal LarkIslandApp entry point + menu bar status item.
//
// The web-agent product UI lives mostly in:
//   - the dynamic island overlay (OverlayPanelController)
//   - the menu bar status item (this file) which surfaces a popover
//     hosting WebAgentInputPanel for entering prompts
//   - the Settings scene (SettingsView)
// Harness runtime monitor + debug-scenario snapshot loading from the
// upstream OpenIslandApp delegate are deliberately gone.

import AppKit
import SwiftUI

@main
struct LarkIslandApp: App {
    @NSApplicationDelegateAdaptor(LarkIslandAppDelegate.self) private var delegate

    var body: some Scene {
        Settings {
            if let model = delegate.model {
                SettingsView(model: model)
            } else {
                Text("Loading…")
            }
        }
    }
}

@MainActor
final class LarkIslandAppDelegate: NSObject, NSApplicationDelegate {
    var model: AppModel?

    private var statusItem: NSStatusItem?
    private var inputPopover: NSPopover?

    func applicationDidFinishLaunching(_ notification: Notification) {
        ProcessInfo.processInfo.disableAutomaticTermination(
            "Lark Island stays active while the web-agent runner is alive."
        )
        ProcessInfo.processInfo.disableSuddenTermination()

        let model = AppModel()
        self.model = model

        NSApp.setActivationPolicy(model.showDockIcon ? .regular : .accessory)
        model.startIfNeeded()

        installMenuBarItem(model: model)
    }

    func applicationWillTerminate(_ notification: Notification) {
        model?.shutdown()
    }

    // MARK: - Menu bar

    private func installMenuBarItem(model: AppModel) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            button.image = NSImage(
                systemSymbolName: "globe",
                accessibilityDescription: "Lark Island"
            )
            button.toolTip = "Lark Island"
            button.action = #selector(toggleInputPopover(_:))
            button.target = self
        }
        self.statusItem = item

        let popover = NSPopover()
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(
            rootView: WebAgentInputPanel(model: model) { [weak self] in
                self?.inputPopover?.performClose(nil)
            }
        )
        self.inputPopover = popover
    }

    @objc private func toggleInputPopover(_ sender: Any?) {
        guard let popover = inputPopover, let button = statusItem?.button else { return }
        if popover.isShown {
            popover.performClose(sender)
            return
        }
        // Bring the app to the front so the popover's host window
        // doesn't get buried behind whichever IDE / browser is active
        // (default NSPopover hosts at .floating which loses to apps
        // that hold the active window). Activating + bumping the level
        // to popUpMenu keeps the input panel above everything except
        // system menus.
        NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        if let popoverWindow = popover.contentViewController?.view.window {
            popoverWindow.level = .popUpMenu
            popoverWindow.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        }
    }
}
