// M11 task 3.1: workflow primitives unit tests.
//
// Three pure helpers under coverage: splitWorkflow, renderTemplate,
// callPlanLLM (with a mock fetch). Pure functions, no side effects.
//
// Targets ≥ 19 new cases per tasks.md §3.1; we aim for thoroughness
// over the bare minimum because m11 is the spec touching new failure
// surfaces (LLM JSON drift / fallback paths).

import { describe, expect, it, vi } from 'vitest';
import {
  callPlanLLM,
  parsePlanResponseContent,
  renderTemplate,
  splitWorkflow,
} from '../src/workflow.js';
import type { PlanLLMConfig } from '../src/plan-llm-config.js';

const planCfg: PlanLLMConfig = {
  baseURL: 'https://example.test/v1',
  apiKey: 'sk-test',
  model: 'mock-model',
};

describe('M11 splitWorkflow keyword gate', () => {
  it('returns false for empty / whitespace input', () => {
    expect(splitWorkflow('')).toBe(false);
    expect(splitWorkflow('   ')).toBe(false);
  });

  it('returns false for plain single-action prompts', () => {
    expect(splitWorkflow('在飞书给自己发条消息')).toBe(false);
    expect(splitWorkflow('hello')).toBe(false);
    expect(splitWorkflow('在飞书创建一个日程明天下午3点')).toBe(false);
  });

  it('returns true for "X，并 Y" composition', () => {
    expect(splitWorkflow('创建日程 m11 demo，并通知钟梓文')).toBe(true);
    expect(splitWorkflow('创建日程,并发消息')).toBe(true);
  });

  it('returns true for 然后 / 接着 / 再 / 另外 conjunctions after comma', () => {
    expect(splitWorkflow('做 A，然后做 B')).toBe(true);
    expect(splitWorkflow('做 A，接着做 B')).toBe(true);
    expect(splitWorkflow('做 A，再做 B')).toBe(true);
    expect(splitWorkflow('做 A，另外做 B')).toBe(true);
  });

  it('also triggers when the conjunction follows a Chinese / English semicolon', () => {
    // m11 hotfix: original regex only allowed [，,]; users in practice
    // mix in "；" and ";" especially when the first clause is long.
    // Spec demo prompt itself uses "；" so this case must work.
    expect(splitWorkflow('在飞书创建一个日程，标题是 X，明天下午3点开始；并给自己发消息说日程已建')).toBe(true);
    expect(splitWorkflow('do A; then send B')).toBe(false); // English then still excluded
    expect(splitWorkflow('做 A；然后做 B')).toBe(true);
  });

  it('returns true for 顺便 even without comma', () => {
    expect(splitWorkflow('在飞书创建日程 m11 顺便给我发消息')).toBe(true);
  });

  it('does NOT trigger on bare 并 / 再 without preceding comma', () => {
    // m11 known limitation: we only fire when the conjunction follows
    // a comma (or the strong standalone signals 并通知 / 顺便). This
    // keeps the false-positive rate down.
    expect(splitWorkflow('再来一杯')).toBe(false);
    expect(splitWorkflow('我并不想去')).toBe(false);
  });

  it('English keywords NOT supported in m11 (known limitation)', () => {
    expect(splitWorkflow('Schedule meeting and notify Y')).toBe(false);
    expect(splitWorkflow('do A then do B')).toBe(false);
  });
});

describe('M11 renderTemplate prev_result substitution', () => {
  it('substitutes a single $prev_result occurrence', () => {
    const out = renderTemplate('通知：$prev_result', { prev_result: '已建好日程' });
    expect(out).toBe('通知：已建好日程');
  });

  it('substitutes multiple occurrences', () => {
    const out = renderTemplate('A=$prev_result B=$prev_result', {
      prev_result: 'X',
    });
    expect(out).toBe('A=X B=X');
  });

  it('returns the original prompt when no placeholder is present', () => {
    expect(renderTemplate('只是问候', { prev_result: 'X' })).toBe('只是问候');
  });

  it('replaces with empty string when prev_result missing / empty', () => {
    expect(renderTemplate('A=$prev_result B', {})).toBe('A= B');
    expect(renderTemplate('A=$prev_result B', { prev_result: '' })).toBe('A= B');
  });

  it('does NOT match $prev_results (word-boundary aware)', () => {
    // The token must end at a word boundary; "$prev_results" is a
    // distinct identifier and is left alone.
    expect(renderTemplate('A=$prev_results', { prev_result: 'X' })).toBe('A=$prev_results');
  });
});

describe('M11 parsePlanResponseContent JSON contract', () => {
  it('accepts {"steps": [{description, prompt}]} of size 2', () => {
    const out = parsePlanResponseContent(
      JSON.stringify({
        steps: [
          { description: '创建日程', prompt: '在飞书创建日程 m11 demo' },
          { description: '通知确认', prompt: '在飞书给自己发消息：$prev_result' },
        ],
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.steps).toHaveLength(2);
      expect(out.steps[0].description).toBe('创建日程');
      expect(out.steps[1].prompt).toContain('$prev_result');
    }
  });

  it('accepts size 3 (max)', () => {
    const out = parsePlanResponseContent(
      JSON.stringify({
        steps: [
          { description: 'A', prompt: 'a' },
          { description: 'B', prompt: 'b' },
          { description: 'C', prompt: 'c' },
        ],
      }),
    );
    expect(out.ok).toBe(true);
  });

  it('rejects size 1 (under min)', () => {
    const out = parsePlanResponseContent(
      JSON.stringify({ steps: [{ description: 'A', prompt: 'a' }] }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('under min');
  });

  it('rejects size > 3 (over cap)', () => {
    const out = parsePlanResponseContent(
      JSON.stringify({
        steps: [
          { description: 'A', prompt: 'a' },
          { description: 'B', prompt: 'b' },
          { description: 'C', prompt: 'c' },
          { description: 'D', prompt: 'd' },
        ],
      }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('over cap');
  });

  it('rejects steps == 0 (LLM signalling "cannot split")', () => {
    const out = parsePlanResponseContent(JSON.stringify({ steps: [] }));
    expect(out.ok).toBe(false);
  });

  it('rejects non-JSON content', () => {
    const out = parsePlanResponseContent('not a json blob');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('JSON parse');
  });

  it('rejects step with missing fields', () => {
    const out = parsePlanResponseContent(
      JSON.stringify({
        steps: [
          { description: 'A', prompt: 'a' },
          { description: 'B' /* missing prompt */ },
        ],
      }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('prompt missing');
  });

  it('strips a ```json fence wrapper if the model adds one', () => {
    const fenced = '```json\n' +
      JSON.stringify({
        steps: [
          { description: 'A', prompt: 'a' },
          { description: 'B', prompt: 'b' },
        ],
      }) +
      '\n```';
    const out = parsePlanResponseContent(fenced);
    expect(out.ok).toBe(true);
  });

  it('clamps very long descriptions to 100 chars', () => {
    const longDesc = '描述'.repeat(80); // 160 chars
    const out = parsePlanResponseContent(
      JSON.stringify({
        steps: [
          { description: longDesc, prompt: 'a' },
          { description: 'B', prompt: 'b' },
        ],
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.steps[0].description.length).toBeLessThanOrEqual(100);
    }
  });
});

describe('M11 callPlanLLM mock fetch', () => {
  function makeResp(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('forwards the user text to the chat endpoint and returns parsed steps', async () => {
    const fetchMock = vi.fn(async () =>
      makeResp({
        choices: [
          {
            message: {
              content: JSON.stringify({
                steps: [
                  { description: '创建日程', prompt: 'a' },
                  { description: '通知', prompt: 'b' },
                ],
              }),
            },
          },
        ],
      }),
    );
    const out = await callPlanLLM('创建日程，并通知', planCfg, { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(out.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain('/v1/chat/completions');
    const body = JSON.parse((call[1] as RequestInit).body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('mock-model');
    expect(body.messages.at(-1)?.content).toBe('创建日程，并通知');
  });

  it('returns ok: false on HTTP 500', async () => {
    const fetchMock = vi.fn(async () => makeResp({ error: 'oops' }, 500));
    const out = await callPlanLLM('x', planCfg, { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('http 500');
  });

  it('returns ok: false on empty content', async () => {
    const fetchMock = vi.fn(async () =>
      makeResp({ choices: [{ message: { content: '' } }] }),
    );
    const out = await callPlanLLM('x', planCfg, { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('empty content');
  });

  it('returns ok: false on non-JSON content (and does NOT throw)', async () => {
    const fetchMock = vi.fn(async () =>
      makeResp({ choices: [{ message: { content: 'sure here you go' } }] }),
    );
    const out = await callPlanLLM('x', planCfg, { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('JSON parse');
  });

  it('returns ok: false when the network throws (fetch rejection)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const out = await callPlanLLM('x', planCfg, { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('fetch error');
  });
});
