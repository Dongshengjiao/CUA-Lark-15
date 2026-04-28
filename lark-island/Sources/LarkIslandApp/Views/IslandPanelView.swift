// M4 task 3.4: rewritten as a minimal SwiftUI shell for the dynamic
// island. The upstream 2375-line version was a session-list driven UI
// for Claude Code / Codex / Cursor coding agents (with permission
// approval cards, ask-question prompts, terminal jump rows, claude-usage
// drawers, etc.). The web-agent product has a single linear task with
// a prompt and step-by-step status, so the entire view collapses to:
//   - closed state: small pill with status indicator + age
//   - opened state: task card showing prompt, latest step, phase
// Future M5 enhancements (interactive input bar, approvals UI) will be
// added back as standalone view modules per task 4.x.

import LarkIslandCore
import SwiftUI

struct IslandPanelView: View {
    let model: AppModel

    var body: some View {
        // The hosting NSPanel spans the full screen width (so opened-state
        // task cards can use the resolved content width), but the visible
        // chrome should be horizontally centered over the notch area and
        // pinned to the screen top. Without `.frame(.., alignment: .top)`
        // SwiftUI lays out from the leading-top corner of the hosting
        // view and the pill drifts left of center.
        Group {
            switch model.notchStatus {
            case .closed:
                ClosedIslandView(model: model)
            case .opened:
                OpenedIslandView(model: model)
            case .popping:
                ClosedIslandView(model: model)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(.spring(response: 0.32, dampingFraction: 0.85), value: model.notchStatus)
    }
}

// MARK: - Closed (pill) state — hanging-from-notch geometry

private struct ClosedIslandView: View {
    let model: AppModel

    var body: some View {
        let notchSize = NSScreen.main?.notchSize
            ?? CGSize(width: 210, height: 38)

        // The pill must be wider than the notch and taller than the
        // menu bar so the chrome's NotchShape draws a visible "hanging
        // pill" silhouette: top edges tuck *under* the notch, the
        // bottom expands outward into rounded corners that float below
        // the menu bar. Without these extras the shape collapses
        // exactly onto the notch and the user sees nothing.
        let lateralOverhang: CGFloat = 12 // pill wider than notch on each side
        let bottomOverhang: CGFloat = 18 // pill hangs this much below menu bar
        let needsRoom = (model.activeIslandCardSession?.title.isEmpty == false)
        let extraWidth: CGFloat = needsRoom ? 110 : 0

        let pillWidth = notchSize.width + lateralOverhang * 2 + extraWidth
        let pillHeight = notchSize.height + bottomOverhang

        // The top `notchSize.height` of the pill is hidden behind the
        // menu bar — it's drawn purely so NotchShape's concave top
        // corners tuck flush with the notch. All visible content goes
        // in the bottom `bottomOverhang` slice.
        VStack(spacing: 0) {
            // Spacer matching the menu-bar/notch height so the visible
            // strip below is the only place we put content.
            Color.clear.frame(height: notchSize.height)

            HStack(spacing: 7) {
                statusDot
                if let session = model.activeIslandCardSession,
                   !session.title.isEmpty {
                    Text(session.title)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(.white.opacity(0.92))
                        .lineLimit(1)
                        .truncationMode(.middle)
                } else {
                    Text("Lark Island")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(.white.opacity(0.55))
                }
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(width: pillWidth, height: pillHeight, alignment: .center)
        .background(
            // NotchShape: concave top corners (tuck under the notch)
            // and convex bottom corners (round outward like Apple's
            // Dynamic Island).
            NotchShape.closed
                .fill(Color.black)
        )
        .shadow(color: .black.opacity(0.55), radius: 7, y: 3)
    }

    @ViewBuilder
    private var statusDot: some View {
        if model.runnerOffline {
            Circle().fill(.red).frame(width: 8, height: 8)
        } else if let session = model.activeIslandCardSession {
            Circle().fill(color(for: session.phase)).frame(width: 8, height: 8)
        } else {
            Circle().fill(.gray.opacity(0.5)).frame(width: 8, height: 8)
        }
    }

    private func color(for phase: SessionPhase) -> Color {
        switch phase {
        case .running: return .blue
        case .waitingForApproval: return .orange
        case .waitingForAnswer: return .yellow
        case .completed: return .green
        }
    }
}

// MARK: - Opened (expanded card) state

private struct OpenedIslandView: View {
    let model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let session = model.activeIslandCardSession {
                taskHeader(session: session)
                Divider().opacity(0.18)
                taskBody(session: session)
            } else {
                idleHeader
            }

            if model.runnerOffline {
                runnerOfflineBanner
            }
        }
        .padding(14)
        .frame(width: 360)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.black.opacity(0.92))
        )
        .foregroundStyle(.white)
    }

    private var idleHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Lark Island")
                    .font(.headline)
                Spacer()
                Text(model.activeProfileName)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.55))
            }
            Text("No active task. Open the menu bar to start one.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.6))
        }
    }

    @ViewBuilder
    private func taskHeader(session: AgentSession) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                phaseLabel(for: session.phase)
                Spacer()
                Text(session.spotlightAgeBadge)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.5))
            }
            Text(session.title.isEmpty ? "(untitled task)" : session.title)
                .font(.body.weight(.semibold))
                .lineLimit(2)
        }
    }

    @ViewBuilder
    private func taskBody(session: AgentSession) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if !session.summary.isEmpty {
                Text(session.summary)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.85))
                    .lineLimit(4)
            }

            if let req = session.permissionRequest {
                approvalRow(request: req)
            }

            if let q = session.questionPrompt {
                questionRow(prompt: q)
            }
        }
    }

    private func approvalRow(request: PermissionRequest) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.shield")
                .foregroundStyle(.orange)
            Text("Approval needed: \(request.summary)")
                .font(.caption)
                .lineLimit(2)
        }
    }

    private func questionRow(prompt: QuestionPrompt) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "questionmark.bubble")
                .foregroundStyle(.yellow)
            Text(prompt.title)
                .font(.caption)
                .lineLimit(2)
        }
    }

    private func phaseLabel(for phase: SessionPhase) -> some View {
        let text: String
        let color: Color
        switch phase {
        case .running:             text = "RUNNING";  color = .blue
        case .waitingForApproval:  text = "APPROVAL"; color = .orange
        case .waitingForAnswer:    text = "QUESTION"; color = .yellow
        case .completed:           text = "DONE";     color = .green
        }
        return Text(text)
            .font(.system(size: 10, weight: .heavy, design: .rounded))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.22), in: Capsule())
            .foregroundStyle(color)
    }

    private var runnerOfflineBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Text("Runner offline. Restart from Settings.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.85))
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(.red.opacity(0.18))
        )
    }
}
