// M3 task 2.4: profile resolver tests.

import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../src/profiles/index.js';

describe('M3 profile resolver', () => {
  it('resolves qwen-default with a present DASHSCOPE_API_KEY', () => {
    const result = resolveProfile('qwen-default', { DASHSCOPE_API_KEY: 'sk-test-12345' });
    expect(result).toEqual({
      ok: true,
      profile: {
        name: 'qwen-default',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: 'sk-test-12345',
        model: 'qwen3-vl-plus',
        family: 'qwen-vl-prompt',
      },
    });
  });

  it('treats null profile name as qwen-default', () => {
    const result = resolveProfile(null, { DASHSCOPE_API_KEY: 'sk-test-12345' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.name).toBe('qwen-default');
    }
  });

  it('treats undefined profile name as qwen-default', () => {
    const result = resolveProfile(undefined, { DASHSCOPE_API_KEY: 'sk-test-12345' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.name).toBe('qwen-default');
    }
  });

  it('rejects an unknown profile name with kind=vlmError', () => {
    const result = resolveProfile('claude-opus', { DASHSCOPE_API_KEY: 'sk-test-12345' });
    expect(result).toEqual({
      ok: false,
      kind: 'vlmError',
      message: 'unknown profile claude-opus',
    });
  });

  it('rejects qwen-default when DASHSCOPE_API_KEY is missing', () => {
    const result = resolveProfile('qwen-default', {});
    expect(result).toEqual({
      ok: false,
      kind: 'vlmError',
      message: 'DASHSCOPE_API_KEY not set',
    });
  });

  it('rejects qwen-default when DASHSCOPE_API_KEY is empty string', () => {
    const result = resolveProfile('qwen-default', { DASHSCOPE_API_KEY: '' });
    expect(result).toEqual({
      ok: false,
      kind: 'vlmError',
      message: 'DASHSCOPE_API_KEY not set',
    });
  });
});
