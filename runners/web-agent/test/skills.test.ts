// M5 task 5.1: skill registry + router + cookie detector tests.

import { describe, expect, it } from 'vitest';
import { registry, selectSkill } from '../src/skills/registry.js';
import { defaultDetectLoggedIn } from '../src/skills/cookies.js';
import { feishu_im_send } from '../src/skills/feishu_im_send.js';
import { feishu_calendar_create } from '../src/skills/feishu_calendar_create.js';
import { feishu_doc_create } from '../src/skills/feishu_doc_create.js';

describe('M5 skill registry', () => {
  it('contains the three built-in feishu skills in declared order', () => {
    expect(registry.length).toBeGreaterThanOrEqual(3);
    const ids = registry.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining(['feishu_im_send', 'feishu_calendar_create', 'feishu_doc_create']),
    );
    // declared order = priority
    expect(ids[0]).toBe('feishu_im_send');
    expect(ids[1]).toBe('feishu_calendar_create');
    expect(ids[2]).toBe('feishu_doc_create');
  });

  it('every skill defines all required fields with non-empty values', () => {
    for (const skill of registry) {
      expect(skill.id, `skill.id`).toBeTruthy();
      expect(skill.displayName, `${skill.id}.displayName`).toBeTruthy();
      expect(skill.matchKeywords.length, `${skill.id}.matchKeywords`).toBeGreaterThan(0);
      expect(skill.cookieDomain, `${skill.id}.cookieDomain`).toBeTruthy();
      expect(skill.userDataDirSegment, `${skill.id}.userDataDirSegment`).toBeTruthy();
      expect(skill.startingURL, `${skill.id}.startingURL`).toBeTruthy();
      expect(skill.systemPromptAddendum.trim().length, `${skill.id}.systemPromptAddendum`).toBeGreaterThan(20);
      // loginURL CAN be empty for skills that don't need login, but
      // all three feishu skills should set it.
      expect(skill.loginURL, `${skill.id}.loginURL`).toBeTruthy();
    }
  });

  it('feishu skills share the same userDataDirSegment so login is shared', () => {
    expect(feishu_im_send.userDataDirSegment).toBe('feishu');
    expect(feishu_calendar_create.userDataDirSegment).toBe('feishu');
    expect(feishu_doc_create.userDataDirSegment).toBe('feishu');
    expect(feishu_im_send.cookieDomain).toBe('.feishu.cn');
  });
});

describe('M5 selectSkill (router)', () => {
  it('routes Chinese feishu IM prompt to feishu_im_send', () => {
    const skill = selectSkill('给张三发条飞书消息：明天下午3点开会', registry);
    expect(skill?.id).toBe('feishu_im_send');
  });

  it('routes English feishu IM prompt to feishu_im_send', () => {
    const skill = selectSkill('Send IM to alice via lark', registry);
    expect(skill?.id).toBe('feishu_im_send');
  });

  it('routes Chinese 创建文档 prompt to feishu_doc_create', () => {
    const skill = selectSkill('在飞书新建文档：M5 demo notes', registry);
    expect(skill?.id).toBe('feishu_doc_create');
  });

  it('routes English create doc prompt to feishu_doc_create', () => {
    const skill = selectSkill('Create a feishu doc titled M5 notes', registry);
    expect(skill?.id).toBe('feishu_doc_create');
  });

  it('routes calendar prompts to feishu_calendar_create', () => {
    expect(selectSkill('帮我创建日程明天下午会议', registry)?.id).toBe(
      'feishu_calendar_create',
    );
    expect(selectSkill('Schedule meeting tomorrow at 3pm', registry)?.id).toBe(
      'feishu_calendar_create',
    );
  });

  it('returns null for non-feishu prompts', () => {
    expect(selectSkill('在 google 搜索 UI-TARS 并告诉我前 3 个结果', registry)).toBeNull();
    expect(selectSkill('打开 example.com 读 page title', registry)).toBeNull();
    expect(selectSkill('   ', registry)).toBeNull();
    expect(selectSkill('', registry)).toBeNull();
  });

  it('respects declared priority when keywords overlap', () => {
    // Both im_send and doc_create match the prompt; im_send is first
    // in the registry array so it must win.
    const overlap = selectSkill('飞书发消息也建文档', registry);
    expect(overlap?.id).toBe('feishu_im_send');
  });
});

describe('M6 systemPromptAddendum hardening', () => {
  it('feishu_im_send addendum forbids the global search bar', () => {
    const text = feishu_im_send.systemPromptAddendum;
    expect(text).toMatch(/全局搜索|global search/i);
    // Must explicitly tell the VLM NOT to click it.
    expect(text).toMatch(/(NEVER|DO NOT|不要|禁止)/);
    // Mentions ⌘+K as the conversation-search shortcut explicitly.
    expect(text).toContain('⌘+K');
  });

  it('all three feishu skills include a finished() completion signal', () => {
    for (const skill of [feishu_im_send, feishu_calendar_create, feishu_doc_create]) {
      const text = skill.systemPromptAddendum;
      expect(text).toContain('finished(');
      // Each skill must describe SOME visual completion cue. Match on a
      // vocabulary set so individual skills can describe their own UI signal.
      expect(text).toMatch(/气泡|模态|编辑器|条目|出现|载入|loaded/i);
    }
  });

  it('all three feishu skills retain a few-shot block', () => {
    for (const skill of [feishu_im_send, feishu_calendar_create, feishu_doc_create]) {
      const text = skill.systemPromptAddendum;
      expect(text).toMatch(/FEW-?SHOT|few-shot|示例|例：/i);
      // Real action calls so the VLM sees concrete syntax templates.
      expect(text).toMatch(/click\(start_box=/);
    }
  });
});

describe('M6 loginURL convention (= startingURL)', () => {
  it('every feishu skill uses startingURL as its loginURL', () => {
    for (const skill of [feishu_im_send, feishu_calendar_create, feishu_doc_create]) {
      expect(skill.loginURL).toBe(skill.startingURL);
      expect(skill.loginURL).toMatch(/feishu\.cn/);
    }
  });
});

describe('M5 defaultDetectLoggedIn', () => {
  function makePage(cookies: Array<{ name: string; domain: string; value?: string }>) {
    return {
      cookies: async () => cookies,
    } as unknown as Parameters<ReturnType<typeof defaultDetectLoggedIn>>[0];
  }

  it('returns true when a session cookie exists for the cookieDomain', async () => {
    const detect = defaultDetectLoggedIn({ cookieDomain: '.feishu.cn' });
    const ok = await detect(
      makePage([
        { name: 'session', domain: '.feishu.cn', value: 'abc' },
        { name: 'lang', domain: '.feishu.cn', value: 'zh' },
      ]),
    );
    expect(ok).toBe(true);
  });

  it('returns false when only non-session cookies exist', async () => {
    const detect = defaultDetectLoggedIn({ cookieDomain: '.feishu.cn' });
    const ok = await detect(
      makePage([
        { name: 'lang', domain: '.feishu.cn', value: 'zh' },
        { name: 'theme', domain: '.feishu.cn', value: 'dark' },
      ]),
    );
    expect(ok).toBe(false);
  });

  it('returns false when no cookies match the domain', async () => {
    const detect = defaultDetectLoggedIn({ cookieDomain: '.feishu.cn' });
    const ok = await detect(
      makePage([{ name: 'session', domain: '.example.com', value: 'abc' }]),
    );
    expect(ok).toBe(false);
  });

  it('returns false on empty cookies', async () => {
    const detect = defaultDetectLoggedIn({ cookieDomain: '.feishu.cn' });
    expect(await detect(makePage([]))).toBe(false);
  });

  it('matches "session_list" name (substring search)', async () => {
    const detect = defaultDetectLoggedIn({ cookieDomain: '.feishu.cn' });
    const ok = await detect(
      makePage([{ name: 'session_list', domain: '.feishu.cn', value: '...' }]),
    );
    expect(ok).toBe(true);
  });
});
