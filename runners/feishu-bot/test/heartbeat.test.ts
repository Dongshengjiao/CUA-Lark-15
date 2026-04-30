// M10 task 3.1: heartbeat throttle unit tests.
//
// We test the pure decision/format functions exported from main.ts.
// The actual side-effect (lark-cli reply) is integration territory
// covered by the m10 task 5.x smoke runs. Here we cover:
//
//   case A: 3 step task                      → 0 heartbeat
//   case B: 5 step task, lastHeartbeatAt=0   → 1 heartbeat
//   case C: 10 step in 9s, lastHeartbeatAt=0 → 1 heartbeat (Infinity beats 15s gate)
//   case D: 10 step in 40s, with prev hb     → 1 heartbeat (5-step + 15s both met)
//   case E: thought empty                    → fallback text without colon
//   case F: thought > 60 chars               → truncated + "..."
//
// We simulate the heartbeat loop by calling decideHeartbeatTrigger
// after each "step" and updating the state when it fires.

import { describe, expect, it } from 'vitest';
import {
  HEARTBEAT_MIN_STEP_GAP,
  HEARTBEAT_MIN_MS_GAP,
  HEARTBEAT_THOUGHT_MAXLEN,
  decideHeartbeatTrigger,
  formatHeartbeatText,
  truncateThought,
  type HeartbeatState,
} from '../src/main.js';

interface Step {
  thought?: string;
  /** Milliseconds since the start of the simulated task. */
  atMs: number;
}

interface SimResult {
  heartbeats: Array<{ atMs: number; totalSteps: number; text: string }>;
  finalState: HeartbeatState;
}

function simulate(steps: Step[]): SimResult {
  const state: HeartbeatState = {
    totalSteps: 0,
    lastHeartbeatStep: 0,
    lastHeartbeatAt: 0,
  };
  const heartbeats: SimResult['heartbeats'] = [];
  for (const step of steps) {
    state.totalSteps += 1;
    if (decideHeartbeatTrigger(state, step.atMs)) {
      heartbeats.push({
        atMs: step.atMs,
        totalSteps: state.totalSteps,
        text: formatHeartbeatText(state.totalSteps, step.thought),
      });
      state.lastHeartbeatStep = state.totalSteps;
      state.lastHeartbeatAt = step.atMs;
    }
  }
  return { heartbeats, finalState: state };
}

describe('M10 heartbeat throttle', () => {
  it('exports the documented thresholds', () => {
    expect(HEARTBEAT_MIN_STEP_GAP).toBe(5);
    expect(HEARTBEAT_MIN_MS_GAP).toBe(15_000);
    expect(HEARTBEAT_THOUGHT_MAXLEN).toBe(60);
  });

  it('case A: 3 step task → 0 heartbeats', () => {
    const result = simulate([
      { atMs: 1_000 },
      { atMs: 2_000 },
      { atMs: 3_000 },
    ]);
    expect(result.heartbeats).toHaveLength(0);
    expect(result.finalState.totalSteps).toBe(3);
    expect(result.finalState.lastHeartbeatAt).toBe(0);
  });

  it('case B: 5 step task, lastHeartbeatAt=0 → 1 heartbeat at step 5', () => {
    const result = simulate([
      { atMs: 1_000 },
      { atMs: 2_000 },
      { atMs: 3_000 },
      { atMs: 4_000 },
      { atMs: 5_000, thought: '点击新建日程按钮' },
    ]);
    expect(result.heartbeats).toHaveLength(1);
    expect(result.heartbeats[0]).toMatchObject({
      atMs: 5_000,
      totalSteps: 5,
    });
    expect(result.heartbeats[0].text).toContain('已执行 5 步');
    expect(result.heartbeats[0].text).toContain('点击新建日程按钮');
  });

  it('case C: 10 step in 9 seconds, lastHeartbeatAt=0 → 1 heartbeat (15s gate skipped on first)', () => {
    // Even though wall-clock is < 15s, lastHeartbeatAt=0 means
    // msSinceLast=Infinity per decideHeartbeatTrigger spec, so the
    // first heartbeat fires at step 5. After it fires, the next
    // five steps take only ~5 more seconds, so the 15s gate
    // suppresses any further heartbeat.
    const steps: Step[] = [];
    for (let i = 1; i <= 10; i += 1) {
      steps.push({ atMs: i * 900 });
    }
    const result = simulate(steps);
    expect(result.heartbeats).toHaveLength(1);
    expect(result.heartbeats[0].totalSteps).toBe(5);
    expect(result.finalState.totalSteps).toBe(10);
  });

  it('case D: 10 step in 40 seconds → 2 heartbeats (5/10 step both gate-pass)', () => {
    const steps: Step[] = [];
    for (let i = 1; i <= 10; i += 1) {
      steps.push({ atMs: i * 4_000 });
    }
    const result = simulate(steps);
    expect(result.heartbeats).toHaveLength(2);
    expect(result.heartbeats[0].totalSteps).toBe(5);
    expect(result.heartbeats[1].totalSteps).toBe(10);
    // first heartbeat at 20s mark; second at 40s mark; 20s gap > 15s.
    expect(result.heartbeats[1].atMs - result.heartbeats[0].atMs).toBe(20_000);
  });

  it('case E: thought empty → fallback text without colon', () => {
    expect(formatHeartbeatText(7, undefined)).toBe('⏳ 已执行 7 步…');
    expect(formatHeartbeatText(7, '')).toBe('⏳ 已执行 7 步…');
  });

  it('case F: thought > 60 char → truncated + "..."', () => {
    const longThought = 'a'.repeat(HEARTBEAT_THOUGHT_MAXLEN + 50);
    const out = formatHeartbeatText(8, longThought);
    expect(out).toContain('已执行 8 步');
    // 60 'a' + '...' marker
    expect(out).toContain('a'.repeat(HEARTBEAT_THOUGHT_MAXLEN) + '...');
    expect(out).not.toContain('a'.repeat(HEARTBEAT_THOUGHT_MAXLEN + 1));
  });

  it('truncateThought handles unicode code points (no half emoji)', () => {
    // 60 emojis (each 1 code point) → no truncation
    const sixtyEmojis = '🦀'.repeat(HEARTBEAT_THOUGHT_MAXLEN);
    expect(truncateThought(sixtyEmojis)).toBe(sixtyEmojis);

    // 61 emojis → truncated to 60 + "..."
    const sixtyOneEmojis = '🦀'.repeat(HEARTBEAT_THOUGHT_MAXLEN + 1);
    const truncated = truncateThought(sixtyOneEmojis);
    const expected = '🦀'.repeat(HEARTBEAT_THOUGHT_MAXLEN) + '...';
    expect(truncated).toBe(expected);
  });

  it('truncateThought returns "" for undefined / empty input', () => {
    expect(truncateThought(undefined)).toBe('');
    expect(truncateThought('')).toBe('');
  });
});
