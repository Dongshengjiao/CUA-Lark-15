// M4 task 3.6: rewritten as a minimal "current task" status panel for
// the web-agent product. The upstream 639-line version was a Claude /
// Codex hooks usage dashboard bound to AppModel coordinators that no
// longer exist (M0b deleted them).

import LarkIslandCore
import SwiftUI

struct ControlCenterView: View {
    let model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header

            if let session = model.activeIslandCardSession {
                taskCard(session: session)
            } else {
                idlePlaceholder
            }

            Divider().padding(.vertical, 4)
            footer
        }
        .padding(20)
        .frame(width: 360, height: 320)
    }

    private var header: some View {
        HStack {
            Text("Lark Island")
                .font(.title3.weight(.semibold))
            Spacer()
            statusBadge
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        if model.runnerOffline {
            Label("Runner offline", systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
                .font(.caption)
        } else if model.runnerSupervisor.currentPID != nil {
            Label("Ready", systemImage: "circle.fill")
                .foregroundStyle(.green)
                .font(.caption)
        } else {
            Label("Starting…", systemImage: "ellipsis.circle")
                .foregroundStyle(.secondary)
                .font(.caption)
        }
    }

    @ViewBuilder
    private func taskCard(session: AgentSession) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(session.title)
                .font(.body.weight(.medium))
                .lineLimit(2)
            Text(phaseLabel(for: session.phase))
                .font(.caption)
                .foregroundStyle(.secondary)
            if !session.summary.isEmpty {
                Text(session.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(NSColor.controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var idlePlaceholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "tray")
                .font(.system(size: 32))
                .foregroundStyle(.secondary)
            Text("No active task")
                .font(.callout)
                .foregroundStyle(.secondary)
            Text("Click the menu bar icon to start a task.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(20)
    }

    private var footer: some View {
        HStack {
            Text("Profile: \(model.activeProfileName)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
    }

    private func phaseLabel(for phase: SessionPhase) -> String {
        switch phase {
        case .running: return "运行中"
        case .waitingForApproval: return "等待批准"
        case .waitingForAnswer: return "等待回答"
        case .completed: return "已完成"
        }
    }
}
