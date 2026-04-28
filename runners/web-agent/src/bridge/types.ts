// TypeScript mirror of the LarkIslandCore Bridge protocol (M2).
// Schema source of truth lives in Swift at
//   lark-island/Sources/LarkIslandCore/AgentEvent.swift
//   lark-island/Sources/LarkIslandCore/BridgeTransport.swift
//   lark-island/Sources/LarkIslandCore/AgentSession.swift
// Wire fixtures shared with the Swift test suite live at
//   lark-island/Tests/LarkIslandCoreTests/Fixtures/web-agent-bridge/

// ===== Generic shell types =====

export type AgentTool = 'webAgent';
export type SessionPhase = 'running' | 'waitingForApproval' | 'waitingForAnswer' | 'completed';
export type SessionAttachmentState = 'attached' | 'stale' | 'detached';
export type SessionOrigin = 'live' | 'demo';

export interface JumpTarget {
  terminalApp: string;
  workspaceName: string;
  paneTitle: string;
  workingDirectory?: string;
}

export interface PermissionRequest {
  id: string;
  title: string;
  summary: string;
  affectedPath: string;
  primaryActionTitle: string;
  secondaryActionTitle: string;
  toolName?: string;
  toolUseID?: string;
  requiresTerminalApproval: boolean;
}

// ===== BridgeHello =====

export interface BridgeHello {
  protocolVersion: number;
  serverLabel: string;
}

// ===== BridgeClientRole =====

export type BridgeClientRole = 'observer' | 'webAgentRunner';

// ===== BridgeCommand (4 cases) =====

export type BridgeCommand =
  | { type: 'registerClient'; role: BridgeClientRole }
  | { type: 'requestQuestion'; sessionID: string; prompt: unknown }
  | { type: 'resolvePermission'; sessionID: string; resolution: unknown }
  | { type: 'answerQuestion'; sessionID: string; response: unknown }
  | {
      type: 'runWebAgentTask';
      taskID: string;
      prompt: string;
      skill?: string | null;
      profileName?: string | null;
    };

// ===== BridgeResponse =====

export type BridgeResponse = { type: 'acknowledged' };

// ===== Web-agent failure taxonomy =====

export type WebAgentFailureKind = 'vlmTimeout' | 'vlmError' | 'pageError' | 'cancelled';

// ===== AgentEvent (12 cases: 7 generic + 5 web-agent) =====

/**
 * Date is encoded as integer milliseconds since the Unix epoch on the
 * wire (BridgeCodec uses `.millisecondsSince1970`). On decode we
 * surface a JavaScript Date.
 */
export interface SessionStarted {
  sessionID: string;
  title: string;
  tool: AgentTool;
  origin?: SessionOrigin | null;
  initialPhase: SessionPhase;
  summary: string;
  timestamp: Date;
  jumpTarget?: JumpTarget | null;
  isRemote: boolean;
}

export interface SessionActivityUpdated {
  sessionID: string;
  summary: string;
  phase: SessionPhase;
  timestamp: Date;
}

export interface PermissionRequested {
  sessionID: string;
  request: PermissionRequest;
  timestamp: Date;
}

export interface QuestionAsked {
  sessionID: string;
  prompt: unknown;
  timestamp: Date;
}

export interface SessionCompleted {
  sessionID: string;
  summary: string;
  timestamp: Date;
  isInterrupt?: boolean | null;
}

export interface JumpTargetUpdated {
  sessionID: string;
  jumpTarget: JumpTarget;
  timestamp: Date;
}

export interface ActionableStateResolved {
  sessionID: string;
  summary: string;
  timestamp: Date;
}

export interface WebAgentTaskStarted {
  taskID: string;
  prompt: string;
  skill?: string | null;
  profileName: string;
  timestamp: Date;
}

export interface WebAgentStepUpdate {
  taskID: string;
  stepIndex: number;
  thought: string;
  actionRaw?: string | null;
  actionType?: string | null;
  /**
   * Absolute path or `file://` URL to a JPEG screenshot on disk.
   * The runner is responsible for writing the file before emitting.
   */
  screenshotURL?: string | null;
  costMs?: number | null;
  costTokens?: number | null;
  timestamp: Date;
}

export interface WebAgentApprovalRequested {
  taskID: string;
  kind: string;
  message: string;
  timestamp: Date;
}

export interface WebAgentTaskCompleted {
  taskID: string;
  finalAnswer: string;
  totalSteps: number;
  totalTokens: number;
  totalMs: number;
  timestamp: Date;
}

export interface WebAgentTaskFailed {
  taskID: string;
  kind: WebAgentFailureKind;
  message: string;
  timestamp: Date;
}

export type AgentEvent =
  | { type: 'sessionStarted'; payload: SessionStarted }
  | { type: 'activityUpdated'; payload: SessionActivityUpdated }
  | { type: 'permissionRequested'; payload: PermissionRequested }
  | { type: 'questionAsked'; payload: QuestionAsked }
  | { type: 'sessionCompleted'; payload: SessionCompleted }
  | { type: 'jumpTargetUpdated'; payload: JumpTargetUpdated }
  | { type: 'actionableStateResolved'; payload: ActionableStateResolved }
  | { type: 'webAgentTaskStarted'; payload: WebAgentTaskStarted }
  | { type: 'webAgentStepUpdate'; payload: WebAgentStepUpdate }
  | { type: 'webAgentApprovalRequested'; payload: WebAgentApprovalRequested }
  | { type: 'webAgentTaskCompleted'; payload: WebAgentTaskCompleted }
  | { type: 'webAgentTaskFailed'; payload: WebAgentTaskFailed };

// ===== BridgeEnvelope =====

export type BridgeEnvelope =
  | { type: 'hello'; hello: BridgeHello }
  | { type: 'event'; event: AgentEvent }
  | { type: 'command'; command: BridgeCommand }
  | { type: 'response'; response: BridgeResponse };
