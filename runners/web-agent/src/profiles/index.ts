// M3: profile resolver. Maps a profileName received in
// `runWebAgentTask` commands to concrete LLM credentials.
//
// Per spec `web-agent-runner-service` Requirement 3 ("profile 解析在
// M3 阶段仅支持 qwen-default"), this milestone hard-codes a single
// out-of-the-box profile. M4 (LLM Settings UI + Keychain) will
// extend this resolver to read from a user-managed JSON store.

export type ProfileFamily = 'qwen-vl-prompt' | 'doubao-ui-tars' | 'ui-tars';

export interface ResolvedProfile {
  /** Stable name. Echoed in logs and webAgentTaskStarted events. */
  name: string;
  /** OpenAI-compatible base URL. */
  baseURL: string;
  /** API key. Never travels over the bridge socket. */
  apiKey: string;
  /** Model identifier passed to the OpenAI SDK. */
  model: string;
  /** Family hint for prompt-shaping decisions inside the runtime. */
  family: ProfileFamily;
}

export interface ProfileResolutionError {
  ok: false;
  /** Failure category. Maps directly onto WebAgentFailureKind. */
  kind: 'vlmError';
  message: string;
}

export type ResolveResult = { ok: true; profile: ResolvedProfile } | ProfileResolutionError;

const QWEN_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_DEFAULT_MODEL = 'qwen3-vl-plus';

/**
 * Resolve a profile name to credentials.
 *
 * The accepted names in M3 are:
 *  - "qwen-default" — the default DashScope-backed Qwen3-VL-Plus profile
 *  - null / undefined — same as "qwen-default" (this matches how
 *    `BridgeCommand.runWebAgentTask` carries optional profileName)
 *
 * Any other name returns `{ok: false, kind: 'vlmError'}` so the
 * caller can directly forward the message via `webAgentTaskFailed`.
 */
export function resolveProfile(
  name: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolveResult {
  const effectiveName = name && name.length > 0 ? name : 'qwen-default';

  if (effectiveName !== 'qwen-default') {
    return {
      ok: false,
      kind: 'vlmError',
      message: `unknown profile ${effectiveName}`,
    };
  }

  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    return {
      ok: false,
      kind: 'vlmError',
      message: 'DASHSCOPE_API_KEY not set',
    };
  }

  return {
    ok: true,
    profile: {
      name: 'qwen-default',
      baseURL: QWEN_DEFAULT_BASE_URL,
      apiKey,
      model: QWEN_DEFAULT_MODEL,
      family: 'qwen-vl-prompt',
    },
  };
}
