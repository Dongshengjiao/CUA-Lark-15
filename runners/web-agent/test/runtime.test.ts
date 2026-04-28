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

  protected async createAgent(args: {
    profile: ResolvedProfile;
    onStep: (data: GUIAgentData) => void;
    onFinalAnswer: (answer: string) => void;
    onError: (error: unknown) => void;
  }): Promise<RunnableAgent> {
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
