// M11 task 1.1: workflow primitives for the Feishu bot bridge.
//
// Three pure functions + types:
//   1. splitWorkflow(text): cheap regex keyword gate. Only when this
//      returns true do we spend an LLM plan call.
//   2. callPlanLLM(text, cfg): OpenAI-compatible chat call returning a
//      strict JSON {steps: PlannedStep[]}. All failure modes funnel
//      into { ok: false, reason } so the caller can fall back to the
//      m9 single-task path.
//   3. renderTemplate(prompt, ctx): late-bound substitution of
//      $prev_result placeholder used by step i>0.
//
// We keep these pure (no socket / lark-cli side effects) so they're
// trivially unit-testable and easy to reason about.

import type { PlanLLMConfig } from './plan-llm-config.js';

export interface PlannedStep {
  /** Human-readable label, ≤ 30 char Chinese gerund preferred. */
  description: string;
  /** Atomic prompt to send to the runner as one runWebAgentTask. */
  prompt: string;
  /** Optional skill hint. null/undefined → runner auto-routes. */
  skill?: string;
}

export interface WorkflowState {
  steps: PlannedStep[];
  currentIndex: number;
  results: string[];
  startedAt: number;
}

export type WorkflowPlanResult =
  | { ok: true; steps: PlannedStep[] }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// 1. splitWorkflow — keyword gate
// ---------------------------------------------------------------------------

/**
 * Cheap pre-filter for "this prompt looks like a multi-step composite".
 * Only when this returns true do we spend an LLM plan call.
 *
 * Triggers on Chinese composition cues:
 *   - punctuation (Chinese / English comma / semicolon) followed by
 *     并 / 然后 / 接着 / 再 / 另外
 *   - 并通知 / 顺便 (no preceding punctuation needed — strong signals)
 *
 * Known limitation (m11): English keywords ("and", "then") are NOT
 * supported here because that would falsely trigger on ordinary
 * sentences ("send a message and confirm"). m12 may add a separate
 * English regex with stronger anchoring.
 */
export function splitWorkflow(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  // Pattern: (Chinese / English comma / semicolon) + (并|然后|接着|再|另外)
  // OR standalone 并通知 / 顺便. We accept both "，" and ";" / ";"
  // because users mix them in IM input.
  const conjPattern =
    /[，,；;]\s*(?:并|然后|接着|再|另外)|并通知|顺便/u;
  return conjPattern.test(trimmed);
}

// ---------------------------------------------------------------------------
// 2. callPlanLLM — OpenAI-compatible chat call
// ---------------------------------------------------------------------------

const PLAN_SYSTEM_PROMPT = `You are a Feishu workflow planner. Given a Chinese (or mixed Chinese-English) instruction that bundles 2-3 actions, output STRICT JSON of the form:

{
  "steps": [
    {"description": "<≤30 char Chinese gerund>", "prompt": "<atomic action>"},
    ...
  ]
}

Rules:
- Output 2 or 3 steps. If you cannot cleanly split into ≥ 2 steps, output {"steps": []}.
- Each step.prompt must be phrased so the Feishu web-agent can execute it as a single isolated skill task. Choose the surface explicitly (在飞书日历 / 在飞书 IM / 在飞书云文档 / 在飞书多维表格 / 给自己 / 给某人).
- For step i > 0 you MAY use the placeholder $prev_result inside step.prompt to reference the finalAnswer of step i-1 (a Chinese sentence describing what was just done). Insert it in a natural position so the next step can leverage that information (e.g. include the calendar title and time in a notification message).
- DO NOT include any commentary, markdown, or text outside the JSON.
- DO NOT call any tools.
- Output the JSON object verbatim, nothing else.`;

const MAX_STEPS = 3;
const MIN_STEPS = 2;

export async function callPlanLLM(
  userText: string,
  cfg: PlanLLMConfig,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<WorkflowPlanResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(`${cfg.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PLAN_SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      return { ok: false, reason: `plan-llm http ${resp.status}` };
    }
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      return { ok: false, reason: 'plan-llm empty content' };
    }
    return parsePlanResponseContent(content);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    return { ok: false, reason: `plan-llm fetch error: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exposed for unit tests — extracts the JSON contract validation
 * from the network call. Robust against models occasionally wrapping
 * the JSON in ```json ... ``` fences (we strip them defensively even
 * though we asked for response_format=json_object).
 */
export function parsePlanResponseContent(content: string): WorkflowPlanResult {
  const stripped = stripCodeFence(content).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return { ok: false, reason: `plan-llm JSON parse: ${(err as Error).message}` };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'plan-llm response not object' };
  }
  const stepsRaw = (parsed as { steps?: unknown }).steps;
  if (!Array.isArray(stepsRaw)) {
    return { ok: false, reason: 'plan-llm steps not array' };
  }
  if (stepsRaw.length < MIN_STEPS) {
    return { ok: false, reason: `plan-llm steps under min (${stepsRaw.length} < ${MIN_STEPS})` };
  }
  if (stepsRaw.length > MAX_STEPS) {
    return { ok: false, reason: `plan-llm steps over cap (${stepsRaw.length} > ${MAX_STEPS})` };
  }
  const steps: PlannedStep[] = [];
  for (let i = 0; i < stepsRaw.length; i += 1) {
    const s = stepsRaw[i];
    if (typeof s !== 'object' || s === null) {
      return { ok: false, reason: `plan-llm step[${i}] not object` };
    }
    const obj = s as { description?: unknown; prompt?: unknown; skill?: unknown };
    if (typeof obj.description !== 'string' || obj.description.length === 0) {
      return { ok: false, reason: `plan-llm step[${i}].description missing` };
    }
    if (typeof obj.prompt !== 'string' || obj.prompt.length === 0) {
      return { ok: false, reason: `plan-llm step[${i}].prompt missing` };
    }
    const step: PlannedStep = {
      description: obj.description.slice(0, 100),
      prompt: obj.prompt,
    };
    if (typeof obj.skill === 'string' && obj.skill.length > 0) {
      step.skill = obj.skill;
    }
    steps.push(step);
  }
  return { ok: true, steps };
}

function stripCodeFence(s: string): string {
  // Strip a single ```json ... ``` or ``` ... ``` wrapper if present.
  const fence = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;
  const m = fence.exec(s);
  return m ? m[1] : s;
}

// ---------------------------------------------------------------------------
// 3. renderTemplate — $prev_result substitution
// ---------------------------------------------------------------------------

/**
 * Replace every occurrence of `$prev_result` in `prompt` with
 * `ctx.prev_result`. Missing / empty ctx.prev_result yields an empty
 * substitution (the placeholder vanishes). Word-boundary aware so we
 * don't accidentally substitute inside `$prev_results` or similar.
 */
export function renderTemplate(prompt: string, ctx: { prev_result?: string }): string {
  const value = ctx.prev_result ?? '';
  return prompt.replace(/\$prev_result\b/g, value);
}
