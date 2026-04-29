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
import type { Skill } from '../skills/registry.js';
import { ensureLoggedIn, type BrowserRef } from './login.js';
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
  /**
   * Skill object selected by the router, or null if the prompt did
   * not match any registered skill (i.e. generic mode).
   */
  skill?: Skill | null;
}

/** Re-export so callers don't need to dig into the login module. */
export type { BrowserRef } from './login.js';

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
  /**
   * Mutable handle to the live LocalBrowser. The runtime can swap the
   * underlying browser in/out (e.g. headless ↔ visible during a QR
   * scan) and the runner main loop reads back through the same ref so
   * it always sees the active browser when the socket closes.
   */
  browserRef: BrowserRef;
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

// Default UI-TARS system prompt as shipped by @ui-tars/sdk. We
// intentionally inline it (instead of importing) because the constants
// module isn't a public re-export of the package.
//
// M9 hotfix appended the "## ACTION SYNTAX — STRICT" block. The base
// `## Action Space` section above already shows the canonical
// `click(start_box='[...]')` shape with single quotes, but Qwen3-VL-Plus
// has been observed (m7 doc Run 1, m9 generic-mode runs of "what is 1+1")
// to drift to `click(start_box=[...])` (no quotes) with non-trivial
// frequency. The BrowserOperator parser then surfaces startY as falsy
// and throws "Missing startX(...) or startY..." after 3 retries,
// killing the task. Adding an explicit WRONG/CORRECT block to the BASE
// prompt covers generic mode + all 5 feishu skills with a single fix
// (skills' own systemPromptAddendum still has its own ACTION SYNTAX
// block; the duplication is harmless and only reinforces the rule).
const BASE_SYSTEM_PROMPT = `You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
\`\`\`
Thought: ...
Action: ...
\`\`\`

## Action Space
click(start_box='[x1, y1, x2, y2]')
left_double(start_box='[x1, y1, x2, y2]')
right_single(start_box='[x1, y1, x2, y2]')
drag(start_box='[x1, y1, x2, y2]', end_box='[x3, y3, x4, y4]')
hotkey(key='')
type(content='') #If you want to submit your input, use "\\n" at the end of \`content\`.
scroll(start_box='[x1, y1, x2, y2]', direction='down or up or right or left')
wait() #Sleep for 5s and take a screenshot to check for any changes.
finished()
call_user() # Submit the task and call the user when the task is unsolvable, or when you need the user's help.

## ACTION SYNTAX — STRICT

The action parser is unforgiving. The coordinate box for click /
left_double / right_single / drag / scroll MUST be a SINGLE-QUOTED
STRING in the start_box / end_box field. Only these forms are valid:

    click(start_box='[x1, y1, x2, y2]')         ← CORRECT
    click(start_box='[x, y]')                    ← also CORRECT (single point)
    drag(start_box='[10,20]', end_box='[30,40]') ← CORRECT
    scroll(start_box='[100,100]', direction='down')

These forms are SILENTLY DROPPED or mis-parsed (startY ends up null
and BrowserOperator throws "Missing startX(...) or startY..."):

    click(start_box=[x1, y1, x2, y2])            ← WRONG, missing quotes
    click(start_box="[x1, y1, x2, y2]")          ← WRONG, double quotes
    click(start_box='x1,y1')                     ← WRONG, no brackets
    click([x1, y1, x2, y2])                      ← WRONG, no field name

For hotkey, the key must be the FULL WORD from the supported set
(\`escape\`, not the three-letter shorthand; \`enter\`, \`tab\`,
\`space\`, \`backspace\`, \`cmd\`, \`ctrl\`, etc.). Combinations join
with '+' or a single space. Case insensitive.

    hotkey(key='escape')                         ← CORRECT
    hotkey(key='cmd enter')                      ← CORRECT
    hotkey(key='cmd+enter')                      ← CORRECT

## Note
- Write a small plan and finally summarize your next action (with its target element) in one sentence in \`Thought\` part.

## User Instruction
`;

export class AgentRuntime {
  protected readonly sink: EnvelopeSink;
  protected readonly browserRef: BrowserRef;
  protected readonly logger: Logger;
  protected readonly maxLoopCount: number;
  protected readonly vlmTimeoutMs: number;
  protected readonly env: NodeJS.ProcessEnv;

  constructor(options: AgentRuntimeOptions) {
    this.sink = options.sink;
    this.browserRef = options.browserRef;
    this.logger = options.logger ?? new ConsoleLogger('[runtime]');
    this.maxLoopCount = options.maxLoopCount ?? DEFAULT_LOOP_COUNT;
    this.vlmTimeoutMs = options.vlmTimeoutMs ?? DEFAULT_VLM_TIMEOUT_MS;
    this.env = options.env ?? process.env;
  }

  async runTask(command: RunTaskCommand, profile: ResolvedProfile): Promise<void> {
    const startedAt = Date.now();
    const skill = command.skill ?? null;

    this.logger.info(
      `routed task ${command.taskID} to skill ${skill?.id ?? 'generic'}`,
    );

    this.emit({
      type: 'event',
      event: {
        type: 'webAgentTaskStarted',
        payload: {
          taskID: command.taskID,
          prompt: command.prompt,
          skill: skill?.id ?? null,
          profileName: profile.name,
          timestamp: new Date(startedAt),
        },
      },
    });

    // M5 task 3.x: login pre-check + QR flow. Subclasses can override
    // `runLoginPrecheck` for testing without spinning up a real Chromium.
    if (skill) {
      const outcome = await this.runLoginPrecheck(skill, command.taskID);
      if (!outcome.ok) {
        this.emitFailure(command.taskID, outcome.kind, outcome.message, startedAt);
        return;
      }
    }

    let stepCount = 0;
    let totalTokens = 0;
    let finalAnswer: string | null = null;
    // GUIAgent.run() can finish without throwing even when execution
    // failed — it captures BrowserOperator errors via async-retry,
    // surfaces them through onError, and resolves the run() promise
    // normally. We record any such failure here so runTask() can emit
    // webAgentTaskFailed instead of falsely emitting completed.
    type RecordedFailure = { kind: WebAgentFailureKind; message: string };
    const failureRef: { current: RecordedFailure | null } = { current: null };

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
        skill,
        onStep,
        onFinalAnswer: (answer) => {
          finalAnswer = answer;
        },
        onError: (errPayload) => {
          // GUIAgent passes a GUIAgentError-shaped payload here.
          // Pull out a reasonable string regardless of shape.
          const errAny = errPayload as { name?: string; message?: string; status?: number };
          const synthesized = new Error(errAny?.message ?? String(errPayload));
          if (errAny?.name) synthesized.name = errAny.name;
          if (failureRef.current === null) {
            failureRef.current = this.classifyError(synthesized);
          }
        },
      });
    } catch (err) {
      const { kind, message } = this.classifyError(err);
      this.emitFailure(command.taskID, kind, message, startedAt);
      throw err;
    }

    // If the skill defines a startingURL, navigate there before letting
    // GUIAgent take over. Generic mode lets the prompt itself dictate
    // the first navigation.
    if (skill && skill.startingURL.trim() !== '') {
      await this.navigateToStartingURL(skill);
    }

    try {
      await agent.run(command.prompt);
    } catch (err) {
      const { kind, message } = this.classifyError(err);
      this.emitFailure(command.taskID, kind, message, startedAt);
      return;
    }

    // Even if agent.run() resolved normally, GUIAgent may have signaled
    // an error via onError without throwing. Treat that as a failed task
    // per spec ("异常按 WebAgentFailureKind 分类回灌").
    if (failureRef.current !== null) {
      this.emitFailure(
        command.taskID,
        failureRef.current.kind,
        failureRef.current.message,
        startedAt,
      );
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

  /**
   * Compose the GUIAgent system prompt by appending the skill's
   * `systemPromptAddendum` to the base UI-TARS prompt. Exposed as
   * protected so tests can verify the combined string without
   * instantiating a real GUIAgent.
   */
  protected buildSystemPrompt(skill: Skill | null): string {
    // M9 hotfix: inject the wall-clock date so the VLM does not have
    // to guess "today / tomorrow / next week" from training data.
    // Calendar verify-run #9 reproduced a date-picker bug where the
    // VLM read "5月1" as "4月1" because it was simultaneously trying
    // to figure out what "明天" meant from the prompt — giving it the
    // ground-truth "today" string anchors the reasoning.
    const dateContext = this.formatDateContext(new Date());
    const base = `${BASE_SYSTEM_PROMPT}\n${dateContext}\n`;
    if (!skill) return base;
    return `${base}\n${skill.systemPromptAddendum.trim()}\n`;
  }

  protected formatDateContext(now: Date): string {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dayAfter = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return `${y}-${m}-${day}（${weekdays[d.getDay()]}）`;
    };
    return [
      '## CURRENT DATE — anchor for relative-time prompts',
      '',
      `今天 (today) = ${fmt(now)}`,
      `明天 (tomorrow) = ${fmt(tomorrow)}`,
      `后天 (day after tomorrow) = ${fmt(dayAfter)}`,
      '',
      'When the user prompt contains relative times like "明天" / "tomorrow"',
      '/ "下周一" / "next Monday", convert them to the explicit YYYY-MM-DD',
      'date above before clicking date pickers. When confirming a selection,',
      'READ THE PICKER HEADER (year + month) — the digit "1" inside a date',
      'grid means "the 1st of the CURRENT picker month", which may be a',
      'different month than today. If the picker is on April but you',
      'wanted May, click the > arrow to advance the month BEFORE clicking',
      'the day cell.',
    ].join('\n');
  }

  /**
   * Test hook: override to skip the actual page navigation. Default
   * opens a new page and goto's the skill's startingURL.
   */
  protected async navigateToStartingURL(skill: Skill): Promise<void> {
    try {
      const page = await this.browserRef.current.createPage();
      await page.goto(skill.startingURL, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
    } catch (err) {
      this.logger.warn(`[runtime] startingURL nav failed: ${err}`);
    }
  }

  /**
   * Test hook: override in subclasses to short-circuit the login flow
   * without launching a visible browser. Default delegates to
   * `ensureLoggedIn` from `./login`.
   */
  protected async runLoginPrecheck(
    skill: Skill,
    taskID: string,
  ): Promise<{ ok: true } | { ok: false; kind: WebAgentFailureKind; message: string }> {
    return ensureLoggedIn({
      taskID,
      skill,
      browserRef: this.browserRef,
      sink: this.sink,
      logger: this.logger,
    });
  }

  // Test hook: override to inject a mock GUIAgent without touching real
  // BrowserOperator / @ui-tars/sdk. Production builds a real GUIAgent
  // wired to the shared LocalBrowser.
  protected async createAgent(args: {
    profile: ResolvedProfile;
    skill: Skill | null;
    onStep: (data: GUIAgentData) => void;
    onFinalAnswer: (answer: string) => void;
    onError: (error: unknown) => void;
  }): Promise<RunnableAgent> {
    const operator = new BrowserOperator({
      browser: this.browserRef.current as unknown as never,
      browserType: 'chrome' as never,
      logger: this.logger,
      // M9 hotfix: highlightClickableElements (UIHelper) injects DOM
      // overlays via document.body.appendChild() before each
      // screenshot. On heavy SPAs (M9 verify-run #8: feishu calendar
      // entry via messenger sidebar) the body element is briefly
      // unavailable while React rebuilds the surface, and the helper
      // throws "Cannot read properties of null (reading 'appendChild')"
      // — which BrowserOperator surfaces as a screenshot failure that
      // GUIAgent retries 3x and gives up on. The highlight overlay is a
      // nice-to-have visual cue (orange box around clickable elements)
      // that the VLM does not actually need to ground correctly. Turn
      // it off for stability; revisit once @ui-tars/operator-browser
      // ships defensive null-checks in UIHelper.
      highlightClickableElements: false,
      showActionInfo: false,
      showWaterFlow: false,
      onFinalAnswer: async (answer) => {
        args.onFinalAnswer(answer);
      },
    });

    const systemPrompt = this.buildSystemPrompt(args.skill);

    const guiAgent = new GUIAgent({
      operator,
      model: {
        baseURL: args.profile.baseURL,
        apiKey: args.profile.apiKey,
        model: args.profile.model,
        timeout: this.vlmTimeoutMs,
      },
      systemPrompt,
      logger: this.logger,
      maxLoopCount: this.maxLoopCount,
      onData: ({ data }) => args.onStep(data),
      onError: ({ error }) => {
        this.logger.error(`[runtime] agent error: ${error}`);
        args.onError(error);
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
      /quota|api[ _-]?key|insufficient|invalid model|unsupported model/i.test(rawMessage)
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
