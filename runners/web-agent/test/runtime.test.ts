// M3 task 3.4: AgentRuntime tests with a mock GUIAgent.
//
// We subclass AgentRuntime and override `createAgent` to inject a
// scripted runnable. No real Chromium is launched, no real DashScope
// HTTP request is made — these tests verify only the runtime's
// envelope flow against the spec.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GUIAgentData } from '@ui-tars/shared/types';
import {
  AgentRuntime,
  type EnvelopeSink,
  type RunnableAgent,
  type RunTaskCommand,
} from '../src/agent/runtime.js';
import type { ResolvedProfile } from '../src/profiles/index.js';
import type { BridgeEnvelope } from '../src/bridge/types.js';

const PROFILE: ResolvedProfile = {
  name: 'qwen-default',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'sk-test-12345',
  model: 'qwen3-vl-plus',
  family: 'qwen-vl-prompt',
};

class FakeRuntime extends AgentRuntime {
  public agentScript: Array<GUIAgentData> = [];
  public throwOnRun: Error | null = null;
  public finalAnswer: string | null = null;
  /**
   * If set, the fake agent fires onError(...) during run() but resolves
   * normally (matching the real GUIAgent's "resolved with status:error"
   * behavior on max-retry execute failures).
   */
  public errorWithoutThrow: { name?: string; message: string } | null = null;

  // M5 capture surfaces — populated by the FakeRuntime's overrides so
  // tests can assert what the runtime would have done.
  public capturedSystemPrompts: string[] = [];
  public capturedSkillIDs: Array<string | null> = [];
  public navigatedStartingURLs: string[] = [];
  public loginPrecheckCalls: Array<{ skillID: string; taskID: string }> = [];
  public loginPrecheckResult:
    | { ok: true }
    | { ok: false; kind: 'cancelled' | 'pageError' | 'vlmTimeout' | 'vlmError'; message: string } =
    { ok: true };

  protected async createAgent(args: {
    profile: ResolvedProfile;
    skill: { id: string } | null;
    onStep: (data: GUIAgentData) => void;
    onFinalAnswer: (answer: string) => void;
    onError: (error: unknown) => void;
  }): Promise<RunnableAgent> {
    this.capturedSkillIDs.push(args.skill?.id ?? null);
    this.capturedSystemPrompts.push(this.buildSystemPrompt(args.skill as never));
    return {
      run: async (_instruction: string) => {
        for (const data of this.agentScript) {
          args.onStep(data);
        }
        if (this.errorWithoutThrow) {
          args.onError(this.errorWithoutThrow);
        }
        if (this.throwOnRun) {
          throw this.throwOnRun;
        }
        if (this.finalAnswer != null) {
          args.onFinalAnswer(this.finalAnswer);
        }
      },
    };
  }

  protected async navigateToStartingURL(skill: { startingURL: string }): Promise<void> {
    this.navigatedStartingURLs.push(skill.startingURL);
  }

  protected async runLoginPrecheck(
    skill: { id: string },
    taskID: string,
  ): Promise<{ ok: true } | { ok: false; kind: 'cancelled' | 'pageError' | 'vlmTimeout' | 'vlmError'; message: string }> {
    this.loginPrecheckCalls.push({ skillID: skill.id, taskID });
    return this.loginPrecheckResult;
  }
}

function makeStep(opts: {
  thought: string;
  actionType?: string;
  screenshotBase64?: string;
}): GUIAgentData {
  return {
    version: 'v1.5' as never,
    instruction: 'test',
    systemPrompt: '',
    modelName: 'qwen3-vl-plus',
    logTime: Date.now(),
    status: 1 as never,
    conversations: [
      {
        from: 'gpt',
        value: `Action: ${opts.actionType ?? 'click'}(...)`,
        screenshotBase64: opts.screenshotBase64,
        predictionParsed: opts.actionType
          ? [
              {
                action_type: opts.actionType,
                action_inputs: {},
                reflection: null,
                thought: opts.thought,
              } as never,
            ]
          : [],
      } as never,
    ],
  };
}

function makeSink(): { sink: EnvelopeSink; envelopes: BridgeEnvelope[] } {
  const envelopes: BridgeEnvelope[] = [];
  const sink: EnvelopeSink = {
    send(env) {
      envelopes.push(env);
    },
  };
  return { sink, envelopes };
}

describe('M3 AgentRuntime — envelope flow', () => {
  let screenshotsDir: string | null = null;

  afterEach(() => {
    if (screenshotsDir && existsSync(screenshotsDir)) {
      rmSync(screenshotsDir, { recursive: true, force: true });
    }
    screenshotsDir = null;
  });

  it('emits started → stepUpdate → completed for a one-step task', async () => {
    screenshotsDir = mkdtempSync(join(tmpdir(), 'runtime-screenshots-'));
    const { sink, envelopes } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      env: { LARK_ISLAND_WEB_AGENT_SCREENSHOTS_DIR: screenshotsDir },
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    runtime.agentScript = [makeStep({ thought: 'reading the page', actionType: 'finished' })];
    runtime.finalAnswer = 'all done';

    const command: RunTaskCommand = { taskID: 't1', prompt: 'do the thing' };
    await runtime.runTask(command, PROFILE);

    expect(envelopes.map((e) => (e as { type: string }).type)).toEqual(['event', 'event', 'event']);
    expect((envelopes[0] as { event: { type: string } }).event.type).toBe('webAgentTaskStarted');
    expect((envelopes[1] as { event: { type: string } }).event.type).toBe('webAgentStepUpdate');
    expect((envelopes[2] as { event: { type: string } }).event.type).toBe('webAgentTaskCompleted');

    const completed = envelopes[2] as { event: { type: 'webAgentTaskCompleted'; payload: { totalSteps: number; finalAnswer: string } } };
    expect(completed.event.payload.totalSteps).toBe(1);
    expect(completed.event.payload.finalAnswer).toBe('all done');
  });

  it('emits stepIndex 0..N-1 monotonically across multiple steps', async () => {
    screenshotsDir = mkdtempSync(join(tmpdir(), 'runtime-screenshots-'));
    const { sink, envelopes } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      env: { LARK_ISLAND_WEB_AGENT_SCREENSHOTS_DIR: screenshotsDir },
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    runtime.agentScript = [
      makeStep({ thought: 'step 0', actionType: 'click' }),
      makeStep({ thought: 'step 1', actionType: 'type' }),
      makeStep({ thought: 'step 2', actionType: 'click' }),
      makeStep({ thought: 'step 3', actionType: 'finished' }),
    ];
    runtime.finalAnswer = 'all four done';

    await runtime.runTask({ taskID: 't1', prompt: 'go' }, PROFILE);

    const stepEnvelopes = envelopes.filter(
      (e) => e.type === 'event' && e.event.type === 'webAgentStepUpdate',
    );
    expect(stepEnvelopes).toHaveLength(4);
    const indices = stepEnvelopes.map((e) => {
      const ev = e as { event: { payload: { stepIndex: number } } };
      return ev.event.payload.stepIndex;
    });
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it('classifies APIConnectionTimeoutError as vlmTimeout', async () => {
    const { sink, envelopes } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    const err = new Error('Request timed out.');
    err.name = 'APIConnectionTimeoutError';
    runtime.throwOnRun = err;

    await runtime.runTask({ taskID: 't1', prompt: 'go' }, PROFILE);

    const failed = envelopes.find(
      (e) => e.type === 'event' && e.event.type === 'webAgentTaskFailed',
    );
    expect(failed).toBeDefined();
    if (failed && failed.type === 'event' && failed.event.type === 'webAgentTaskFailed') {
      expect(failed.event.payload.kind).toBe('vlmTimeout');
      expect(failed.event.payload.message).toContain('APIConnectionTimeoutError');
    }
  });

  it('classifies AuthenticationError as vlmError', async () => {
    const { sink, envelopes } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    const err = new Error('Invalid api_key');
    err.name = 'AuthenticationError';
    runtime.throwOnRun = err;

    await runtime.runTask({ taskID: 't1', prompt: 'go' }, PROFILE);

    const failed = envelopes.find(
      (e) => e.type === 'event' && e.event.type === 'webAgentTaskFailed',
    );
    if (failed && failed.type === 'event' && failed.event.type === 'webAgentTaskFailed') {
      expect(failed.event.payload.kind).toBe('vlmError');
    }
  });

  it('falls back to pageError for unrecognized exceptions', async () => {
    const { sink, envelopes } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    runtime.throwOnRun = new Error('something weird from puppeteer');

    await runtime.runTask({ taskID: 't1', prompt: 'go' }, PROFILE);

    const failed = envelopes.find(
      (e) => e.type === 'event' && e.event.type === 'webAgentTaskFailed',
    );
    if (failed && failed.type === 'event' && failed.event.type === 'webAgentTaskFailed') {
      expect(failed.event.payload.kind).toBe('pageError');
    }
  });

  it('webAgentStepUpdate.screenshotURL points to the canonical path', async () => {
    screenshotsDir = mkdtempSync(join(tmpdir(), 'runtime-screenshots-'));
    const { sink, envelopes } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      env: { LARK_ISLAND_WEB_AGENT_SCREENSHOTS_DIR: screenshotsDir },
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    runtime.agentScript = [
      makeStep({
        thought: 'looking at the page',
        actionType: 'click',
        // 1x1 pixel JPEG header in base64 (just to give the writer something).
        screenshotBase64: '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//',
      }),
    ];
    runtime.finalAnswer = '';

    await runtime.runTask({ taskID: 'task-x', prompt: 'go' }, PROFILE);

    const stepEnv = envelopes.find(
      (e) => e.type === 'event' && e.event.type === 'webAgentStepUpdate',
    );
    expect(stepEnv).toBeDefined();
    if (stepEnv && stepEnv.type === 'event' && stepEnv.event.type === 'webAgentStepUpdate') {
      expect(stepEnv.event.payload.screenshotURL).toBe(
        join(screenshotsDir, 'task-x', '0.jpg'),
      );
      expect(stepEnv.event.payload.actionType).toBe('click');
      expect(stepEnv.event.payload.thought).toBe('looking at the page');
    }
  });

  it('emits webAgentTaskFailed when GUIAgent fires onError without throwing (regression: M3 e2e bug)', async () => {
    const { sink, envelopes } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    runtime.errorWithoutThrow = { name: 'PageError', message: 'Unsupported key: space' };

    await runtime.runTask({ taskID: 't1', prompt: 'go' }, PROFILE);

    const failed = envelopes.find(
      (e) => e.type === 'event' && e.event.type === 'webAgentTaskFailed',
    );
    const completed = envelopes.find(
      (e) => e.type === 'event' && e.event.type === 'webAgentTaskCompleted',
    );
    expect(failed).toBeDefined();
    expect(completed).toBeUndefined();
    if (failed && failed.type === 'event' && failed.event.type === 'webAgentTaskFailed') {
      expect(failed.event.payload.kind).toBe('pageError');
      expect(failed.event.payload.message).toContain('Unsupported key: space');
    }
  });

  it('omits screenshotURL when no screenshot bytes are available', async () => {
    const { sink, envelopes } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    runtime.agentScript = [makeStep({ thought: 'no screenshot', actionType: 'click' })];
    runtime.finalAnswer = 'ok';

    await runtime.runTask({ taskID: 't1', prompt: 'go' }, PROFILE);

    const stepEnv = envelopes.find(
      (e) => e.type === 'event' && e.event.type === 'webAgentStepUpdate',
    );
    if (stepEnv && stepEnv.type === 'event' && stepEnv.event.type === 'webAgentStepUpdate') {
      expect(stepEnv.event.payload.screenshotURL).toBeNull();
    }
  });
});

// MARK: - M5 task 5.2 additions

describe('M5 AgentRuntime — skill resolution + login precheck', () => {
  function makeFakeSkill(overrides: Partial<{ id: string; loginURL: string; startingURL: string; addendum: string }> = {}) {
    return {
      id: overrides.id ?? 'feishu_im_send',
      displayName: 'feishu',
      matchKeywords: ['飞书'],
      cookieDomain: '.feishu.cn',
      userDataDirSegment: 'feishu',
      loginURL: overrides.loginURL ?? 'https://passport.feishu.cn/',
      startingURL: overrides.startingURL ?? 'https://www.feishu.cn/messenger/',
      systemPromptAddendum: overrides.addendum ?? 'You are operating Feishu IM. Click coordinates 40-400 px wide.',
    } as never;
  }

  it('injects systemPromptAddendum when a skill is matched', async () => {
    const { sink } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    runtime.finalAnswer = 'ok';

    const skill = makeFakeSkill({ addendum: 'EXTRA-FEISHU-INSTRUCTIONS' });
    await runtime.runTask({ taskID: 't1', prompt: 'send feishu im', skill }, PROFILE);

    expect(runtime.capturedSkillIDs).toEqual(['feishu_im_send']);
    expect(runtime.capturedSystemPrompts).toHaveLength(1);
    expect(runtime.capturedSystemPrompts[0]).toContain('You are a GUI agent');
    expect(runtime.capturedSystemPrompts[0]).toContain('EXTRA-FEISHU-INSTRUCTIONS');
  });

  it('does NOT inject any addendum when skill is null (generic mode)', async () => {
    const { sink } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    runtime.finalAnswer = 'ok';

    await runtime.runTask({ taskID: 't1', prompt: 'open example.com', skill: null }, PROFILE);

    expect(runtime.capturedSkillIDs).toEqual([null]);
    expect(runtime.capturedSystemPrompts[0]).toContain('You are a GUI agent');
    // base prompt ends with "## User Instruction\n" — no extra addendum after it.
    expect(runtime.capturedSystemPrompts[0].endsWith('## User Instruction\n')).toBe(true);
    // M9 hotfix: ACTION SYNTAX block is part of the base prompt so
    // generic mode (no skill) is also protected against the
    // `start_box=[...]` no-quotes drift that crashed runner pages
    // with "Missing startX(...) or startY..." retry loops.
    expect(runtime.capturedSystemPrompts[0]).toContain('ACTION SYNTAX — STRICT');
    expect(runtime.capturedSystemPrompts[0]).toMatch(/click\(start_box='\[/);
    expect(runtime.capturedSystemPrompts[0]).toMatch(/WRONG/);
    expect(runtime.capturedSystemPrompts[0]).toContain("hotkey(key='escape')");
  });

  it('skips login precheck and starting nav when skill is null', async () => {
    const { sink } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    runtime.finalAnswer = 'ok';

    await runtime.runTask({ taskID: 't1', prompt: 'open example.com', skill: null }, PROFILE);

    expect(runtime.loginPrecheckCalls).toEqual([]);
    expect(runtime.navigatedStartingURLs).toEqual([]);
  });

  it('runs login precheck and navigates startingURL when skill is set and precheck passes', async () => {
    const { sink, envelopes } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    runtime.finalAnswer = 'ok';
    runtime.loginPrecheckResult = { ok: true };

    const skill = makeFakeSkill();
    await runtime.runTask({ taskID: 't1', prompt: 'send feishu', skill }, PROFILE);

    expect(runtime.loginPrecheckCalls).toEqual([{ skillID: 'feishu_im_send', taskID: 't1' }]);
    expect(runtime.navigatedStartingURLs).toEqual(['https://www.feishu.cn/messenger/']);
    // No approval / failed envelope — task completes normally.
    const failed = envelopes.find((e) => e.type === 'event' && e.event.type === 'webAgentTaskFailed');
    expect(failed).toBeUndefined();
  });

  it('emits webAgentTaskFailed{cancelled} when login precheck reports timeout', async () => {
    const { sink, envelopes } = makeSink();
    const runtime = new FakeRuntime({
      sink,
      browser: {} as never,
      logger: { info: () => {}, error: () => {}, warn: () => {}, log: () => {} } as never,
    });
    runtime.loginPrecheckResult = {
      ok: false,
      kind: 'cancelled',
      message: 'login timeout (30min)',
    };

    const skill = makeFakeSkill();
    await runtime.runTask({ taskID: 't1', prompt: 'send feishu', skill }, PROFILE);

    const failed = envelopes.find(
      (e) => e.type === 'event' && e.event.type === 'webAgentTaskFailed',
    );
    expect(failed).toBeDefined();
    if (failed && failed.type === 'event' && failed.event.type === 'webAgentTaskFailed') {
      expect(failed.event.payload.kind).toBe('cancelled');
      expect(failed.event.payload.message).toContain('login timeout');
    }
    // GUIAgent must NOT have been built when precheck fails.
    expect(runtime.capturedSystemPrompts).toEqual([]);
    expect(runtime.navigatedStartingURLs).toEqual([]);
  });
});
