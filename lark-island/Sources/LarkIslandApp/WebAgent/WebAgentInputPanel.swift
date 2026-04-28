// M4 task 4.2: prompt-input panel attached to the menu-bar status item.
//
// Renders a multi-line text editor + submit button, plus a small label
// showing the active VLM profile. Submitting calls
// `model.startWebAgentTask(prompt:)`. Esc dismisses; submit also
// dismisses via the close callback.

import SwiftUI

struct WebAgentInputPanel: View {
    let model: AppModel
    /// Optional callback to dismiss the popover after submit.
    let onClose: (() -> Void)?

    @State private var prompt: String = ""
    @State private var isSubmitting: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "globe")
                    .foregroundStyle(.blue)
                Text("Lark Island")
                    .font(.headline)
                Spacer()
                Text(model.activeProfileName)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.gray.opacity(0.18), in: Capsule())
            }

            TextEditor(text: $prompt)
                .font(.body)
                .frame(minHeight: 80, maxHeight: 160)
                .padding(8)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.gray.opacity(0.2), lineWidth: 1)
                )
                .overlay(alignment: .topLeading) {
                    if prompt.isEmpty {
                        Text("Enter a task, e.g. ‘Open example.com and read the title’.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 12)
                            .allowsHitTesting(false)
                    }
                }

            HStack {
                if model.runnerOffline {
                    Label("Runner offline", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .font(.caption)
                }
                Spacer()
                Button("Cancel") { onClose?() }
                    .keyboardShortcut(.cancelAction)
                Button("Run") { submit() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
            }
        }
        .padding(16)
        .frame(width: 420)
    }

    private func submit() {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSubmitting = true
        model.startWebAgentTask(prompt: trimmed)
        prompt = ""
        isSubmitting = false
        onClose?()
    }
}
