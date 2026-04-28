// M4 (post-rewrite hardening): port the closed-state geometry from the
// upstream open-vibe-island IslandPanelView so we get the
// "hugs-the-notch" silhouette with a brand mark on the left, a count
// badge on the right, and a smooth hover/open animation. This drops
// the simplified Capsule/NotchShape variants the M4 minimal rewrite
// shipped — the chrome was always meant to be used with this layout.

import LarkIslandCore
import SwiftUI

// MARK: - Animation constants

private let openAnimation: Animation = .spring(response: 0.42, dampingFraction: 0.8, blendDuration: 0)
private let closeAnimation: Animation = .smooth(duration: 0.3)

struct IslandPanelView: View {
    let model: AppModel

    @State private var isHovering: Bool = false
    @State private var hoverOpenTask: Task<Void, Never>?

    private var isOpened: Bool {
        model.notchStatus == .opened
    }

    private var isPopping: Bool {
        model.notchStatus == .popping
    }

    /// Always true so the user sees a hanging silhouette even when
    /// idle (matches vibeisland.app behavior). The wings show:
    ///   - left: brand mark (animated when a task is running)
    ///   - right: live session count, or a runner-status dot when idle.
    private var hasClosedPresence: Bool { true }

    private var showsCountBadge: Bool {
        model.liveSessionCount > 0
    }

    private var hasClosedActivity: Bool {
        model.surfacedSessions.contains(where: { $0.phase == .running })
    }

    private var attentionSession: AgentSession? {
        model.surfacedSessions.first(where: { $0.phase.requiresAttention })
    }

    private var scoutTint: Color {
        if model.runnerOffline { return .red }
        if let phase = attentionSession?.phase {
            return phaseColor(phase)
        }
        if hasClosedActivity { return .blue }
        return .mint
    }

    private var notchTransitionAnimation: Animation {
        switch model.notchStatus {
        case .opened: return openAnimation
        case .closed: return closeAnimation
        case .popping: return openAnimation
        }
    }

    private var targetScreen: NSScreen? {
        NSScreen.screens.first(where: { $0.safeAreaInsets.top > 0 }) ?? NSScreen.main
    }

    private var closedNotchWidth: CGFloat {
        targetScreen?.notchSize.width ?? NSScreen.externalDisplayNotchWidth
    }

    private var closedNotchHeight: CGFloat {
        targetScreen?.islandClosedHeight ?? 24
    }

    private var sideWidth: CGFloat {
        max(0, closedNotchHeight - 12) + 10
    }

    private var countBadgeWidth: CGFloat {
        let digits = max(1, "\(model.liveSessionCount)".count)
        return CGFloat(digits) * 7 + 18
    }

    private var expansionWidth: CGFloat {
        guard hasClosedPresence else { return 0 }
        let leftWidth = sideWidth + (attentionSession != nil ? 18 : 0)
        let rightWidth = max(sideWidth, countBadgeWidth) + (attentionSession != nil ? 18 : 0)
        return leftWidth + rightWidth
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Color.clear
                notchContent(availableSize: geometry.size)
                    .frame(maxWidth: .infinity, alignment: .top)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .ignoresSafeArea()
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private func notchContent(availableSize: CGSize) -> some View {
        let panelShadowH = IslandChromeMetrics.openedShadowHorizontalInset
        let panelShadowB = IslandChromeMetrics.openedShadowBottomInset
        let layoutW = max(0, availableSize.width - panelShadowH * 2)
        let layoutH = max(0, availableSize.height - panelShadowB)

        let outerH: CGFloat = 28
        let outerB: CGFloat = 14
        let openedW = max(0, layoutW - outerH)
        let openedH = max(closedNotchHeight, layoutH - outerB)

        let closedW = closedNotchWidth + expansionWidth + (isPopping ? 18 : 0)
        let closedH = closedNotchHeight

        let usesOpened = isOpened
        let currentW = usesOpened ? openedW : closedW
        let currentH = usesOpened ? openedH : closedH

        let hInset: CGFloat = usesOpened ? 14 : 0
        let bInset: CGFloat = usesOpened ? 14 : 0
        let surfaceW = currentW + hInset * 2
        let surfaceH = currentH + bInset

        let surface = NotchShape(
            topCornerRadius: usesOpened ? NotchShape.openedTopRadius : NotchShape.closedTopRadius,
            bottomCornerRadius: usesOpened ? NotchShape.openedBottomRadius : NotchShape.closedBottomRadius
        )

        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                surface
                    .fill(Color.black)
                    .frame(width: surfaceW, height: surfaceH)

                VStack(spacing: 0) {
                    headerRow
                        .frame(height: closedNotchHeight)

                    if usesOpened {
                        OpenedTaskBody(model: model)
                            .frame(width: openedW - 24)
                            .frame(maxHeight: max(0, currentH - closedNotchHeight - 12), alignment: .top)
                            .clipped()
                    }
                }
                .frame(width: currentW, height: currentH, alignment: .top)
                .padding(.horizontal, hInset)
                .padding(.bottom, bInset)
                .clipShape(surface)
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(Color.black)
                        .frame(height: 1)
                        .padding(.horizontal, usesOpened ? NotchShape.openedTopRadius : NotchShape.closedTopRadius)
                }
                .overlay {
                    surface
                        .stroke(Color.white.opacity(usesOpened ? 0.07 : 0.04), lineWidth: 1)
                }
            }
            .frame(width: surfaceW, height: surfaceH, alignment: .top)
        }
        .scaleEffect(
            usesOpened ? 1 : (isHovering ? IslandChromeMetrics.closedHoverScale : 1),
            anchor: .top
        )
        .padding(.horizontal, panelShadowH)
        .padding(.bottom, panelShadowB)
        .animation(notchTransitionAnimation, value: model.notchStatus)
        .animation(.smooth, value: hasClosedPresence)
        .animation(.smooth, value: expansionWidth)
        .contentShape(Rectangle())
        .onHover { hovering in
            withAnimation(.spring(response: 0.38, dampingFraction: 0.8)) {
                isHovering = hovering
            }
            handleHoverChange(hovering: hovering)
        }
        .onTapGesture {
            if !isOpened {
                hoverOpenTask?.cancel()
                model.notchOpen(reason: .click)
            }
        }
    }

    // MARK: - Hover-to-open

    private func handleHoverChange(hovering: Bool) {
        hoverOpenTask?.cancel()
        guard hovering, !isOpened else {
            if !hovering, isOpened, model.notchOpenReason == .hover {
                model.notchClose()
            }
            return
        }
        let delay = AppModel.hoverOpenDelay
        hoverOpenTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled, isHovering, !isOpened else { return }
            model.notchOpen(reason: .hover)
        }
    }

    // MARK: - Header row (the closed-state silhouette)

    @ViewBuilder
    private var headerRow: some View {
        if isOpened {
            OpenedHeader(model: model)
                .frame(height: closedNotchHeight)
        } else {
            HStack(spacing: 0) {
                if hasClosedPresence {
                    HStack(spacing: 4) {
                        LarkIslandBrandMark(
                            size: 14,
                            tint: scoutTint,
                            isAnimating: hasClosedActivity,
                            style: .duotone
                        )
                        if let phase = attentionSession?.phase {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(phaseColor(phase))
                        }
                    }
                    .frame(width: sideWidth + 8 + (attentionSession != nil ? 18 : 0))
                }

                // Center black rectangle that aligns with the physical notch.
                Rectangle()
                    .fill(Color.black)
                    .frame(width: closedNotchWidth - NotchShape.closedTopRadius + (isPopping ? 18 : 0))

                if hasClosedPresence {
                    let attentionBalance: CGFloat = attentionSession != nil ? 18 : 0
                    Group {
                        if showsCountBadge {
                            ClosedCountBadge(
                                liveCount: model.liveSessionCount,
                                tint: attentionSession != nil
                                    ? phaseColor(attentionSession!.phase)
                                    : scoutTint
                            )
                        } else {
                            // Idle right wing: a simple status dot so the
                            // island stays visibly asymmetric (logo on
                            // the left + dot on the right) instead of
                            // disappearing behind the notch.
                            Circle()
                                .fill(model.runnerOffline ? Color.red : Color.green)
                                .frame(width: 6, height: 6)
                        }
                    }
                    .frame(width: max(sideWidth, countBadgeWidth) + attentionBalance)
                }
            }
            .frame(height: closedNotchHeight)
        }
    }

    private func phaseColor(_ phase: SessionPhase) -> Color {
        switch phase {
        case .running: return .blue
        case .waitingForApproval: return .orange
        case .waitingForAnswer: return .yellow
        case .completed: return .green
        }
    }
}

// MARK: - Closed count badge (right side of closed notch)

private struct ClosedCountBadge: View {
    let liveCount: Int
    let tint: Color

    var body: some View {
        Text("\(liveCount)")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Color(red: 0.14, green: 0.14, blue: 0.15), in: Capsule())
    }
}

// MARK: - Opened state header (compact bar above the body)

private struct OpenedHeader: View {
    let model: AppModel

    var body: some View {
        HStack(spacing: 8) {
            LarkIslandBrandMark(size: 14, tint: .mint, isAnimating: false, style: .duotone)
            Text("Lark Island")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.92))
            Spacer()
            Text(model.activeProfileName)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.white.opacity(0.55))
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(Color.white.opacity(0.08), in: Capsule())
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Opened state body (task card or idle hint)

private struct OpenedTaskBody: View {
    let model: AppModel

    var body: some View {
        if let session = model.activeIslandCardSession {
            taskCard(session)
        } else {
            idleHint
        }
    }

    @ViewBuilder
    private func taskCard(_ session: AgentSession) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                phasePill(session.phase)
                Spacer()
                Text(session.spotlightAgeBadge)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.5))
            }

            Text(session.title.isEmpty ? "(untitled task)" : session.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(2)

            if !session.summary.isEmpty {
                Text(session.summary)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.78))
                    .lineLimit(3)
            }

            if let req = session.permissionRequest {
                Label(req.summary, systemImage: "lock.shield")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .lineLimit(2)
            }

            if let q = session.questionPrompt {
                Label(q.title, systemImage: "questionmark.bubble")
                    .font(.caption)
                    .foregroundStyle(.yellow)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 6)
    }

    private var idleHint: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("No active task.")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
            Text("Click the menu bar globe to start one.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.55))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 6)
    }

    private func phasePill(_ phase: SessionPhase) -> some View {
        let label: String
        let color: Color
        switch phase {
        case .running:            label = "RUNNING";  color = .blue
        case .waitingForApproval: label = "APPROVAL"; color = .orange
        case .waitingForAnswer:   label = "QUESTION"; color = .yellow
        case .completed:          label = "DONE";     color = .green
        }
        return Text(label)
            .font(.system(size: 9.5, weight: .heavy, design: .rounded))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.22), in: Capsule())
            .foregroundStyle(color)
    }
}
