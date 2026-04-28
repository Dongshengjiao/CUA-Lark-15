// M4 task 3.8: rewritten as a minimal web-agent presentation layer.
// The upstream 350-line version derived island headline / prompt /
// assistant-message / tool-call labels from coding-agent metadata
// (claudeMetadata.transcriptPath, currentToolName, lastAssistantMessageText
// etc.) — all of which were stripped from AgentSession in M0c. The
// web-agent product has a single task with a single prompt + linear
// step list, so the surface area collapses dramatically.

import CoreGraphics
import Foundation
import LarkIslandCore

enum SpotlightActivityTone {
    case live
    case idle
    case ready
    case attention
}

enum IslandSessionPresence: Equatable {
    case running
    case active
    case inactive
}

extension AgentSession {
    private static let islandActivityThreshold: TimeInterval = 20 * 60

    var islandActivityDate: Date { updatedAt }

    /// Primary headline shown in the island spotlight position. For
    /// web-agent sessions this is the running summary or final answer.
    var spotlightPrimaryText: String {
        if let request = permissionRequest {
            return request.summary
        }
        if let prompt = questionPrompt {
            return prompt.title
        }
        return summary
    }

    var spotlightSecondaryText: String? {
        if let request = permissionRequest, !request.affectedPath.isEmpty {
            return request.affectedPath
        }
        let normalizedPrimary = spotlightPrimaryText.trimmedForSurface
        let normalizedSummary = summary.trimmedForSurface
        return normalizedSummary == normalizedPrimary ? nil : summary
    }

    var spotlightStatusLabel: String {
        switch phase {
        case .running:
            return "Live"
        case .waitingForApproval:
            return "Approval"
        case .waitingForAnswer:
            return "Question"
        case .completed:
            return "Completed"
        }
    }

    /// Headline = task title. Web-agent has no concept of workspace /
    /// branch / subagent, so this is a straight passthrough.
    var spotlightHeadlineText: String { title }

    var spotlightHeadlinePromptText: String? { title.isEmpty ? nil : title }

    var spotlightPromptText: String? { title.isEmpty ? nil : title }

    var spotlightPromptLineText: String? {
        guard spotlightShowsDetailLines, let prompt = spotlightPromptText else {
            return nil
        }
        return "Prompt: \(prompt)"
    }

    var notificationHeaderPromptLineText: String? {
        phase == .completed ? nil : spotlightPromptLineText
    }

    var spotlightActivityLineText: String? {
        guard spotlightShowsDetailLines else { return nil }
        if let req = permissionRequest?.summary.trimmedForSurface, !req.isEmpty {
            return req
        }
        if let prompt = questionPrompt?.title.trimmedForSurface, !prompt.isEmpty {
            return prompt
        }
        switch phase {
        case .running: return summary.isEmpty ? "Running" : summary
        case .waitingForApproval: return permissionRequest?.summary ?? "Approval needed"
        case .waitingForAnswer: return questionPrompt?.title ?? "Answer needed"
        case .completed: return summary.isEmpty ? "Completed" : summary
        }
    }

    var spotlightActivityTone: SpotlightActivityTone {
        if phase.requiresAttention { return .attention }
        switch phase {
        case .running: return .live
        case .completed: return .idle
        case .waitingForApproval, .waitingForAnswer: return .attention
        }
    }

    var spotlightShowsDetailLines: Bool { spotlightShowsDetailLines(at: .now) }

    func spotlightShowsDetailLines(at referenceDate: Date) -> Bool {
        if phase == .running || phase.requiresAttention { return true }
        return referenceDate.timeIntervalSince(islandActivityDate) < Self.islandActivityThreshold
    }

    var spotlightAgeBadge: String {
        let age = max(0, Int(Date.now.timeIntervalSince(islandActivityDate)))
        if age < 60 { return "<1m" }
        if age < 3_600 { return "\(max(1, age / 60))m" }
        if age < 86_400 { return "\(max(1, age / 3_600))h" }
        return "\(max(1, age / 86_400))d"
    }

    func islandPresence(at referenceDate: Date) -> IslandSessionPresence {
        if phase == .running { return .running }
        if phase.requiresAttention { return .active }
        return referenceDate.timeIntervalSince(islandActivityDate) <= Self.islandActivityThreshold
            ? .active
            : .inactive
    }

    /// Used by OverlayPanelController to size the opened panel before
    /// SwiftUI reports actual content height. The web-agent task card
    /// is single-row, so we return a fixed estimate that matches the
    /// IslandPanelView header layout.
    func estimatedIslandRowHeight(at referenceDate: Date) -> CGFloat {
        var height: CGFloat = 48
        if islandPresence(at: referenceDate) == .inactive {
            return height
        }
        if !summary.isEmpty { height += 22 }
        if permissionRequest != nil { height += 22 }
        if questionPrompt != nil { height += 22 }
        return height
    }

    /// M0c removed coding-agent terminal jump-back. This stays as a
    /// stub that some Views still reference; web-agent has no terminal
    /// to jump to, so always nil.
    var spotlightTerminalLabel: String? { nil }
    var spotlightTerminalBadge: String? { nil }
    var spotlightWorkspaceName: String { title }
    var spotlightWorktreeBranch: String? { nil }
    var spotlightSubagentLabel: String? { nil }
    var spotlightCurrentToolLabel: String? { nil }
    var spotlightTrackingLabel: String? { nil }
    var isSubagentSession: Bool { false }
}

private extension String {
    var trimmedForSurface: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
