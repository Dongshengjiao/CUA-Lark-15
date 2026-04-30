// M11 task 1.2: plan-LLM config resolver.
//
// The bot bridge needs to call a chat LLM to convert a Chinese composite
// instruction into a {steps:[{description, prompt}]} JSON plan. We
// reuse the runner's DashScope OpenAI-compatible endpoint by default
// so the demo only needs ONE api key (DASHSCOPE_API_KEY) — same as
// runner's qwen-default profile.
//
// We pick a chat-only model (qwen-plus) instead of qwen3-vl-plus
// because:
//   - latency: chat-only ≈ 500ms; vision ≈ 2-3s
//   - cost: chat-only is ~10x cheaper
//   - we don't need vision for plain-text plan output

export interface PlanLLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export type PlanLLMConfigResult =
  | { ok: true; config: PlanLLMConfig }
  | { ok: false; reason: string };

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen-plus';

export function resolvePlanLLMConfig(env: NodeJS.ProcessEnv = process.env): PlanLLMConfigResult {
  const baseURL = env.LARK_BOT_PLAN_LLM_BASE_URL ?? DEFAULT_BASE_URL;
  const model = env.LARK_BOT_PLAN_LLM_MODEL ?? DEFAULT_MODEL;
  // Prefer the workflow-specific key if set, otherwise fall back to
  // DASHSCOPE_API_KEY so single-tenant demos don't need a second key.
  const apiKey = env.LARK_BOT_PLAN_LLM_API_KEY ?? env.DASHSCOPE_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    return {
      ok: false,
      reason: 'neither LARK_BOT_PLAN_LLM_API_KEY nor DASHSCOPE_API_KEY is set',
    };
  }
  return { ok: true, config: { baseURL, apiKey, model } };
}
