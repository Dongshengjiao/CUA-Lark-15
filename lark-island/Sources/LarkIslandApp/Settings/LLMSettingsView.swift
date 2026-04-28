// M4 task 4.4: LLM profile CRUD UI.
//
// Three regions:
//   - List on the left: existing profiles (radio shows the default).
//   - Detail form on the right: name, baseURL, model, family, apiKey.
//   - Toolbar at top of list: + (new), - (delete), set-default checkbox.
//
// All edits go through LLMProfileStore; apiKey is loaded into a
// SecureField only when the user clicks "Edit secret" (Keychain access
// triggers a macOS prompt on first read in dev mode).

import SwiftUI

struct LLMSettingsView: View {
    let store: LLMProfileStore

    @State private var selectedName: String?
    @State private var draft: VLMProfile = .empty
    @State private var draftAPIKey: String = ""
    @State private var isCreating: Bool = false
    @State private var revealAPIKeyEditor: Bool = false

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            sidebar
                .frame(width: 200)
                .background(Color(NSColor.windowBackgroundColor))
            Divider()
            detailPane
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear { selectInitialProfile() }
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        VStack(spacing: 0) {
            List(selection: $selectedName) {
                ForEach(store.profiles) { profile in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(profile.name).font(.body)
                            Text(profile.family).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if store.defaultProfileName == profile.name {
                            Image(systemName: "star.fill")
                                .foregroundStyle(.yellow)
                                .font(.caption)
                        }
                    }
                    .tag(profile.name as String?)
                }
            }
            .onChange(of: selectedName) { _, newValue in
                if isCreating { return }
                if let name = newValue, let p = store.profiles.first(where: { $0.name == name }) {
                    draft = p
                    draftAPIKey = ""
                    revealAPIKeyEditor = false
                }
            }

            HStack(spacing: 4) {
                Button {
                    startCreate()
                } label: {
                    Image(systemName: "plus")
                }
                Button {
                    deleteSelected()
                } label: {
                    Image(systemName: "minus")
                }
                .disabled(selectedName == nil || store.profiles.count <= 1)
                Spacer()
            }
            .padding(8)
            .buttonStyle(.borderless)
        }
    }

    // MARK: - Detail

    @ViewBuilder
    private var detailPane: some View {
        Form {
            Section("Profile") {
                TextField("Name", text: $draft.name)
                    .textFieldStyle(.roundedBorder)
                    .disabled(!isCreating && draft.name == selectedName)
                TextField("Base URL", text: $draft.baseURL)
                    .textFieldStyle(.roundedBorder)
                TextField("Model", text: $draft.model)
                    .textFieldStyle(.roundedBorder)
                TextField("Family", text: $draft.family)
                    .textFieldStyle(.roundedBorder)
            }

            Section("API key") {
                if revealAPIKeyEditor || isCreating {
                    SecureField("API key (stored in Keychain)", text: $draftAPIKey)
                        .textFieldStyle(.roundedBorder)
                } else {
                    HStack {
                        Text("•••••••• (Keychain)")
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Replace") { revealAPIKeyEditor = true }
                    }
                }
            }

            Section {
                Toggle("Use as default profile", isOn: Binding(
                    get: { store.defaultProfileName == draft.name },
                    set: { isOn in
                        if isOn { store.setDefault(draft.name) }
                    }
                ))
            }

            if let err = store.lastError {
                Section {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
        .formStyle(.grouped)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(isCreating ? "Create" : "Save") {
                    saveDraft()
                }
                .disabled(draft.name.isEmpty)
            }
        }
        .padding(.bottom, 16)
    }

    // MARK: - Actions

    private func selectInitialProfile() {
        if selectedName == nil, let first = store.profiles.first {
            selectedName = first.name
            draft = first
        }
    }

    private func startCreate() {
        isCreating = true
        revealAPIKeyEditor = true
        draft = VLMProfile(
            name: "new-profile",
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            model: "qwen3-vl-plus",
            family: "qwen3vl",
            createdAt: Date()
        )
        draftAPIKey = ""
    }

    private func saveDraft() {
        store.save(draft, apiKey: draftAPIKey.isEmpty ? nil : draftAPIKey)
        selectedName = draft.name
        isCreating = false
        revealAPIKeyEditor = false
        draftAPIKey = ""
    }

    private func deleteSelected() {
        guard let name = selectedName, store.profiles.count > 1 else { return }
        store.delete(name: name)
        selectedName = store.profiles.first?.name
        if let n = selectedName, let p = store.profiles.first(where: { $0.name == n }) {
            draft = p
        }
    }
}

private extension VLMProfile {
    static let empty = VLMProfile(
        name: "",
        baseURL: "",
        model: "",
        family: "",
        createdAt: Date()
    )
}
