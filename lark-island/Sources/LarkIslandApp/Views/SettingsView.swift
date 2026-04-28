// M4 task 3.7: rewrite SettingsView as a minimal tab shell. The
// upstream version was 1251 lines of hooks-installer / Claude-usage /
// about-update UI bound to the deleted AppModel coordinators. M4 keeps
// only:
//   - General tab (placeholder, AppearanceSettingsPane handles
//     appearance — see Views/AppearanceSettingsPane.swift)
//   - Appearance tab
//   - LLM tab (M4 group 4 fills this with LLMSettingsView)
//   - About tab (placeholder)

import SwiftUI

struct SettingsView: View {
    let model: AppModel

    @State private var selectedTab: SettingsTab = .general

    var body: some View {
        TabView(selection: $selectedTab) {
            GeneralSettingsPane(model: model)
                .tabItem { Label("General", systemImage: "gearshape") }
                .tag(SettingsTab.general)

            AppearanceSettingsPane(model: model)
                .tabItem { Label("Appearance", systemImage: "paintbrush") }
                .tag(SettingsTab.appearance)

            LLMSettingsPlaceholder()
                .tabItem { Label("LLM", systemImage: "brain.head.profile") }
                .tag(SettingsTab.llm)

            AboutSettingsPane()
                .tabItem { Label("About", systemImage: "info.circle") }
                .tag(SettingsTab.about)
        }
        .frame(width: 560, height: 440)
        .padding()
    }
}

private enum SettingsTab: Hashable {
    case general
    case appearance
    case llm
    case about
}

private struct GeneralSettingsPane: View {
    let model: AppModel

    var body: some View {
        Form {
            Toggle("Show in Dock", isOn: Binding(
                get: { model.showDockIcon },
                set: { model.showDockIcon = $0 }
            ))
            Toggle("Haptic feedback when island opens", isOn: Binding(
                get: { model.hapticFeedbackEnabled },
                set: { model.hapticFeedbackEnabled = $0 }
            ))
            Toggle("Mute notification sounds", isOn: Binding(
                get: { model.isSoundMuted },
                set: { model.isSoundMuted = $0 }
            ))
        }
        .formStyle(.grouped)
        .padding()
    }
}

/// Placeholder for the LLMSettingsView built in M4 group 4.
private struct LLMSettingsPlaceholder: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "brain.head.profile")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("LLM profile settings")
                .font(.headline)
            Text("Coming in M4 group 4: profile CRUD + Keychain-backed API keys.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct AboutSettingsPane: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Lark Island")
                .font(.title)
            Text("macOS dynamic-island companion for browser-sandboxed web agents.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}
