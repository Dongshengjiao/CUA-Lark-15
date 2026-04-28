// M3 AgentRuntime. Drives one web-agent task end-to-end:
//   1. Emit webAgentTaskStarted
//   2. Build a fresh page + BrowserOperator + GUIAgent for this task
//   3. Translate every onData callback into a webAgentStepUpdate envelope,
//      writing screenshot bytes to disk fire-and-forget
//   4. Catch the final answer and translate into webAgentTaskCompleted
//   5. Catch any throw and translate into webAgentTaskFailed with a
//      WebAgentFailureKind classification

import { ConsoleLogger, defaultLogger, type Logger } from '@agent-infra/logger';
import { BrowserOperator } from '@ui-tars/operator-browser';
import { GUIAgent } from '@ui-tars/sdk';
import type { LocalBrowser } from '@agent-infra/browser';
import type { GUIAgentData } from '@ui-tars/shared/types';
import { saveScreenshot, screenshotPathFor } from './screenshots.js';
import type { ResolvedProfile } from '../profiles/index.js';
import type {
  AgentEvent,
  BridgeEnvelope,
  WebAgentFailureKind,
  WebAgentStepUpdate,
} from '../bridge/types.js';

export interface EnvelopeSink {
  send(envelope: BridgeEnvelope): void;
}

export interface RunTaskCommand {
  taskID: string;
  prompt: string;
  skill?: string | null;
}

/**
 * Minimal subset of GUIAgent the runtime actually relies on, so tests
 * can substitute it without instantiating real models.
 */
export interface RunnableAgent {
  run(instruction: string): Promise<void>;
  stop?(): void;
}

export interface AgentRuntimeOptions {
  sink: EnvelopeSink;
  browser: LocalBrowser;
  /** Logger, defaults to a console logger labeled "[runtime]". */
  logger?: Logger;
  /** Loop cap forwarded to GUIAgent; default 25 (UI-TARS SDK default). */
  maxLoopCount?: number;
  /** VLM connect timeout in milliseconds, default 180s. */
  vlmTimeoutMs?: number;
  /** Override the screenshots root via env (used in tests). */
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_LOOP_COUNT = 8;
const DEFAULT_VLM_TIMEOUT_MS = 180_000;

export class AgentRuntime {
  protected readonly sink: EnvelopeSink;
  protected readonly browser: LocalBrowser;
  protected readonly logger: Logger;
  protected readonly maxLoopCount: number;
  protected readonly vlmTimeoutMs: number;
  protected readonly env: NodeJS.ProcessEnv;

  constructor(options: AgentRuntimeOptions) {
    this.sink = options.sink;
    this.browser = options.browser;
    this.logger = options.logger ?? new ConsoleLogger('[runtime]');
    this.maxLoopCount = options.maxLoopCount ?? DEFAULT_LOOP_COUNT;
    this.vlmTimeoutMs = options.vlmTimeoutMs ?? DEFAULT_VLM_TIMEOUT_MS;
    this.env = options.env ?? process.env;
  }

  async runTask(command: RunTaskCommand, profile: ResolvedProfile): Promise<void> {
    const startedAt = Date.now();

    this.emit({
      type: 'event',
      event: {
        type: 'webAgentTaskStarted',
        payload: {
          taskID: command.taskID,
          prompt: command.prompt,
          skill: command.skill ?? null,
          profileName: profile.name,
          timestamp: new Date(startedAt),
        },
      },
    });

    let stepCount = 0;
    let totalTokens = 0;
    let finalAnswer: string | null = null;

    const onStep = (data: GUIAgentData) => {
      const lastConv = data.conversations[data.conversations.length - 1];
      if (!lastConv) return;
      const stepIndex = stepCount;
      stepCount += 1;

      const parsed = lastConv.predictionParsed?.[0];
      const screenshotBase64 = lastConv.screenshotBase64;
      const path = screenshotPathFor(command.taskID, stepIndex, this.env);

      if (screenshotBase64) {
        // fire-and-forget — write failure must not break the task loop
        saveScreenshot(screenshotBase64, path).catch((err) => {
          this.logger.error(`[runtime] screenshot save failed: ${err}`);
        });
      }

      // Aggregate token cost — UITarsModel sets this on the next-to-last
      // conversation when the model returns; we read defensively.
      if (lastConv.timing?.cost && typeof lastConv.timing.cost === 'number') {
        // timing.cost is per-step ms, not tokens; tokens land elsewhere
      }

      const stepEvent: WebAgentStepUpdate = {
        taskID: command.taskID,
        stepIndex,
        thought: parsed?.thought ?? '',
        actionRaw: typeof lastConv.value === 'string' ? lastConv.value : null,
        actionType: parsed?.action_type ?? null,
        screenshotURL: screenshotBase64 ? path : null,
        costMs: lastConv.timing?.cost ?? null,
        costTokens: null,
        timestamp: new Date(),
      };

      this.emit({
        type: 'event',
        event: { type: 'webAgentStepUpdate', payload: stepEvent },
      });
    };

    let agent: RunnableAgent;
    try {
      agent = await this.createAgent({
        profile,
        onStep,
        onFinalAnswer: (answer) => {
          finalAnswer = answer;
        },
      });
    } catch (err) {
      const { kind, message } = this.classifyError(err);
      this.emitFailure(command.taskID, kind, message, startedAt);
      throw err;
    }

    try {
      await agent.run(command.prompt);
    } catch (err) {
      const { kind, message } = this.classifyError(err);
      this.emitFailure(command.taskID, kind, message, startedAt);
      return;
    }

    const totalMs = Date.now() - startedAt;
    this.emit({
      type: 'event',
      event: {
        type: 'webAgentTaskCompleted',
        payload: {
          taskID: command.taskID,
          finalAnswer: finalAnswer ?? '',
          totalSteps: stepCount,
          totalTokens,
          totalMs,
          timestamp: new Date(),
        },
      },
    });
  }

  // Test hook: override to inject a mock GUIAgent without touching real
  // BrowserOperator / @ui-tars/sdk. Production builds a real GUIAgent
  // wired to the shared LocalBrowser.
  protected async createAgent(args: {
    profile: ResolvedProfile;
    onStep: (data: GUIAgentData) => void;
    onFinalAnswer: (answer: string) => void;
  }): Promise<RunnableAgent> {
    const operator = new BrowserOperator({
      browser: this.browser as unknown as never,
      browserType: 'chrome' as never,
      logger: this.logger,
      highlightClickableElements: true,
      showActionInfo: false,
      showWaterFlow: false,
      onFinalAnswer: async (answer) => {
        args.onFinalAnswer(answer);
      },
    });

    const guiAgent = new GUIAgent({
      operator,
      model: {
        baseURL: args.profile.baseURL,
        apiKey: args.profile.apiKey,
        model: args.profile.model,
        timeout: this.vlmTimeoutMs,
      },
      logger: this.logger,
      maxLoopCount: this.maxLoopCount,
      onData: ({ data }) => args.onStep(data),
      onError: ({ error }) => {
        this.logger.error(`[runtime] agent error: ${error}`);
      },
    });

    return guiAgent;
  }

  // Map any thrown value to a WebAgentFailureKind. Conservative: anything
  // we don't recognize lands as `pageError` so the M4 UI can offer
  // "Restart browser" as the recovery action.
  protected classifyError(err: unknown): { kind: WebAgentFailureKind; message: string } {
    const e = err as { name?: string; message?: string; code?: string };
    const name = e?.name ?? 'Error';
    const rawMessage = e?.message ?? String(err);
    const trimmed = rawMessage.length > 256 ? rawMessage.slice(0, 256) + '…' : rawMessage;
    const message = `${name}: ${trimmed}`;

    if (
      name === 'APIConnectionTimeoutError' ||
      /timed out/i.test(rawMessage) ||
      e?.code === 'ETIMEDOUT'
    ) {
      return { kind: 'vlmTimeout', message };
    }
    if (
      name === 'APIConnectionError' ||
      name === 'AuthenticationError' ||
      name === 'BadRequestError' ||
      /quota|api[ _-]?key|insufficient|invalid model|unsupported/i.test(rawMessage)
    ) {
      return { kind: 'vlmError', message };
    }
    return { kind: 'pageError', message };
  }

  protected emitFailure(
    taskID: string,
    kind: WebAgentFailureKind,
    message: string,
    _startedAtMs: number,
  ): void {
    this.emit({
      type: 'event',
      event: {
        type: 'webAgentTaskFailed',
        payload: {
          taskID,
          kind,
          message,
          timestamp: new Date(),
        },
      },
    });
  }

  protected emit(envelope: BridgeEnvelope): void {
    try {
      this.sink.send(envelope);
    } catch (err) {
      // sink is bridge — if it errors out here the runner main loop
      // catches the close event and exits. We just log.
      this.logger.error(`[runtime] failed to send envelope: ${err}`);
    }
  }
}

// Re-export AgentEvent for consumers that wire envelopes through the runtime.
export type { AgentEvent };
