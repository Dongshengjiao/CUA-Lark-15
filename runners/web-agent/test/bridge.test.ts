// Cross-language round-trip tests for the M2 web-agent bridge protocol.
//
// Reads the SAME JSON fixtures the Swift test suite uses
// (lark-island/Tests/LarkIslandCoreTests/Fixtures/web-agent-bridge/).
// If either side's codec drifts from the canonical encoding, the
// matching fixture fails on at least one side.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEnvelope, encodeEnvelope, BridgeCodecError } from '../src/bridge/codec.js';
import type { BridgeEnvelope } from '../src/bridge/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(
  here,
  '..',
  '..',
  '..',
  'lark-island',
  'Tests',
  'LarkIslandCoreTests',
  'Fixtures',
  'web-agent-bridge',
);

function loadFixture(name: string): string {
  const path = join(FIXTURES_DIR, `${name}.json`);
  return readFileSync(path, 'utf8');
}

/**
 * Decode the fixture string, re-encode the result, decode that again,
 * and assert the two decoded BridgeEnvelopes are deeply equal.
 *
 * We do NOT compare bytes (Swift and TS may pick different key orders);
 * we compare the *decoded shape*. That's enough to catch field
 * drops, type mismatches, and discriminant mismatches.
 */
function assertRoundTrip(name: string): BridgeEnvelope {
  const original = loadFixture(name);
  const decoded = decodeEnvelope(original);
  const reEncoded = encodeEnvelope(decoded);
  const reDecoded = decodeEnvelope(reEncoded);
  expect(reDecoded).toEqual(decoded);
  return decoded;
}

describe('M2 web-agent bridge — schema fixtures', () => {
  it('every fixture round-trips through TS codec', () => {
    const fixtures = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      const name = fixture.replace(/\.json$/, '');
      assertRoundTrip(name);
    }
  });

  it('hello-v2 advertises protocolVersion=2', () => {
    const env = assertRoundTrip('hello-v2');
    expect(env.type).toBe('hello');
    if (env.type === 'hello') {
      expect(env.hello.protocolVersion).toBe(2);
      expect(env.hello.serverLabel).toBe('lark-island-bridge');
    }
  });

  it('register-web-agent-runner uses the new role', () => {
    const env = assertRoundTrip('register-web-agent-runner');
    expect(env.type).toBe('command');
    if (env.type === 'command' && env.command.type === 'registerClient') {
      expect(env.command.role).toBe('webAgentRunner');
    } else {
      throw new Error('unexpected command shape');
    }
  });

  it('run-web-agent-task carries no apiKey field', () => {
    const env = assertRoundTrip('run-web-agent-task');
    expect(env.type).toBe('command');
    if (env.type === 'command' && env.command.type === 'runWebAgentTask') {
      expect(env.command.taskID).toBe('task-001');
      expect(env.command.skill).toBe('feishu_im_send');
      expect(env.command.profileName).toBe('qwen-default');
      // Spec invariant: no secret material on the wire.
      expect((env.command as Record<string, unknown>)['apiKey']).toBeUndefined();
      expect((env.command as Record<string, unknown>)['token']).toBeUndefined();
    } else {
      throw new Error('unexpected command shape');
    }
  });

  it('run-web-agent-task-minimal accepts null skill / profileName', () => {
    const env = assertRoundTrip('run-web-agent-task-minimal');
    expect(env.type).toBe('command');
    if (env.type === 'command' && env.command.type === 'runWebAgentTask') {
      expect(env.command.skill ?? null).toBeNull();
      expect(env.command.profileName ?? null).toBeNull();
    }
  });

  it('webAgentTaskStarted decodes timestamp as Date', () => {
    const env = assertRoundTrip('web-agent-task-started');
    expect(env.type).toBe('event');
    if (env.type === 'event' && env.event.type === 'webAgentTaskStarted') {
      expect(env.event.payload.taskID).toBe('task-001');
      expect(env.event.payload.skill).toBe('feishu_im_send');
      expect(env.event.payload.profileName).toBe('qwen-default');
      expect(env.event.payload.timestamp).toBeInstanceOf(Date);
      // Canonical fixture timestamp = 1730000000000 ms.
      expect(env.event.payload.timestamp.getTime()).toBe(1_730_000_000_000);
    }
  });

  it('webAgentStepUpdate carries thought + actionRaw + actionType', () => {
    const env = assertRoundTrip('web-agent-step-update');
    expect(env.type).toBe('event');
    if (env.type === 'event' && env.event.type === 'webAgentStepUpdate') {
      expect(env.event.payload.stepIndex).toBe(3);
      expect(env.event.payload.actionType).toBe('click');
      expect(env.event.payload.actionRaw).toContain("click(start_box='[420, 80, 600, 120]')");
      expect(env.event.payload.thought).toContain('Feishu home page');
      expect(env.event.payload.costMs).toBe(6_955);
      expect(env.event.payload.costTokens).toBe(1_424);
    }
  });

  it('webAgentApprovalRequested supports Chinese kind/message', () => {
    const env = assertRoundTrip('web-agent-approval-requested');
    expect(env.type).toBe('event');
    if (env.type === 'event' && env.event.type === 'webAgentApprovalRequested') {
      expect(env.event.payload.kind).toBe('login_qr');
      expect(env.event.payload.message).toBe('请扫描浏览器中的二维码登录飞书');
    }
  });

  it('webAgentTaskCompleted carries final answer + cost stats', () => {
    const env = assertRoundTrip('web-agent-task-completed');
    expect(env.type).toBe('event');
    if (env.type === 'event' && env.event.type === 'webAgentTaskCompleted') {
      expect(env.event.payload.totalSteps).toBe(8);
      expect(env.event.payload.totalTokens).toBe(12_345);
      expect(env.event.payload.totalMs).toBe(51_836);
      expect(env.event.payload.finalAnswer).toContain('hello');
    }
  });

  it('webAgentTaskFailed kind="vlmTimeout" decodes to the typed enum value', () => {
    const env = assertRoundTrip('web-agent-task-failed-vlm-timeout');
    expect(env.type).toBe('event');
    if (env.type === 'event' && env.event.type === 'webAgentTaskFailed') {
      expect(env.event.payload.kind).toBe('vlmTimeout');
      expect(env.event.payload.message).toContain('timed out');
    }
  });
});

describe('M2 web-agent bridge — codec error paths', () => {
  it('rejects malformed JSON', () => {
    expect(() => decodeEnvelope('{not valid json')).toThrow(BridgeCodecError);
  });

  it('rejects unknown envelope type', () => {
    expect(() => decodeEnvelope(JSON.stringify({ type: 'mystery' }))).toThrow(BridgeCodecError);
  });

  it('rejects unknown event type', () => {
    expect(() =>
      decodeEnvelope(
        JSON.stringify({ type: 'event', event: { type: 'unknownEvent', unknownEvent: {} } }),
      ),
    ).toThrow(BridgeCodecError);
  });

  it('rejects unknown failure kind', () => {
    expect(() =>
      decodeEnvelope(
        JSON.stringify({
          type: 'event',
          event: {
            type: 'webAgentTaskFailed',
            webAgentTaskFailed: {
              taskID: 't',
              kind: 'meteorite',
              message: 'oops',
              timestamp: 0,
            },
          },
        }),
      ),
    ).toThrow(BridgeCodecError);
  });
});

describe('M2 web-agent bridge — encode wire format', () => {
  it('encodeEnvelope outputs a single newline-terminated line', () => {
    const env: BridgeEnvelope = {
      type: 'command',
      command: { type: 'registerClient', role: 'webAgentRunner' },
    };
    const out = encodeEnvelope(env);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.split('\n').filter(Boolean).length).toBe(1);
  });

  it('AgentEvent payload is nested under same-typed key (matches Swift fixture shape)', () => {
    const env: BridgeEnvelope = {
      type: 'event',
      event: {
        type: 'webAgentTaskStarted',
        payload: {
          taskID: 't',
          prompt: 'p',
          skill: null,
          profileName: 'qwen-default',
          timestamp: new Date(0),
        },
      },
    };
    const json = JSON.parse(encodeEnvelope(env));
    expect(json.event.type).toBe('webAgentTaskStarted');
    expect(json.event.webAgentTaskStarted).toBeDefined();
    expect(json.event.webAgentTaskStarted.taskID).toBe('t');
    expect(json.event.webAgentTaskStarted.timestamp).toBe(0);
  });
});
