// M4 task 3.5: trimmed appearance pane. The upstream version had
// extensive controls for status colors, pixel-shape styles, custom
// avatar images, and per-coding-agent appearance switches. The minimal
// viable web-agent product just needs a hide-idle toggle; richer
// appearance customization moves to M5+.

import SwiftUI

struct AppearanceSettingsPane: View {
    let model: AppModel

    var body: some View {
        Form {
            Section {
                Toggle("Hide island when idle (slide to screen edge)", isOn: Binding(
                    get: { model.showsIdleEdgeWhenCollapsed },
                    set: { model.showsIdleEdgeWhenCollapsed = $0 }
                ))
            } header: {
                Text("Island visibility")
            } footer: {
                Text("When enabled, the island slides to the edge of the screen when no task is running.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                Toggle("Auto-collapse when pointer leaves", isOn: Binding(
                    get: { model.shouldAutoCollapseOnMouseLeave },
                    set: { model.shouldAutoCollapseOnMouseLeave = $0 }
                ))
            } header: {
                Text("Behavior")
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}
