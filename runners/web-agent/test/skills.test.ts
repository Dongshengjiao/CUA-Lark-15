// M5 task 5.1: skill registry + router + cookie detector tests.

import { describe, expect, it } from 'vitest';
import { registry, selectSkill } from '../src/skills/registry.js';
import { defaultDetectLoggedIn } from '../src/skills/cookies.js';
import { feishu_im_send } from '../src/skills/feishu_im_send.js';
import { feishu_mail_send } from '../src/skills/feishu_mail_send.js';
import { feishu_calendar_create } from '../src/skills/feishu_calendar_create.js';
import { feishu_doc_create } from '../src/skills/feishu_doc_create.js';
import { feishu_base_create } from '../src/skills/feishu_base_create.js';

describe('M5/M8 skill registry', () => {
  it('contains four built-in feishu skills in declared order (M8: mail deferred)', () => {
    // M8 originally registered 5 skills. After verify run, mail was
    // pulled out of the registry because the in-use 飞书 challenge
    // account has no Mail product enabled (DNS error on
    // mail.feishu.cn). The skill file + prompt-template tests stay
    // so unblocking is a single-line registry edit.
    expect(registry.length).toBeGreaterThanOrEqual(4);
    const ids = registry.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'feishu_im_send',
        'feishu_calendar_create',
        'feishu_doc_create',
        'feishu_base_create',
      ]),
    );
    // declared order = priority. base is last because '表格' is the
    // broadest token (could conflict with future feishu_sheets).
    expect(ids[0]).toBe('feishu_im_send');
    expect(ids[1]).toBe('feishu_calendar_create');
    expect(ids[2]).toBe('feishu_doc_create');
    expect(ids[3]).toBe('feishu_base_create');
    // mail must NOT appear in the active registry.
    expect(ids).not.toContain('feishu_mail_send');
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
    // All five feishu skills (including the deferred-stub mail one)
    // share the 'feishu' segment so cookies cross-pollinate the moment
    // mail gets re-registered.
    expect(feishu_im_send.userDataDirSegment).toBe('feishu');
    expect(feishu_mail_send.userDataDirSegment).toBe('feishu');
    expect(feishu_calendar_create.userDataDirSegment).toBe('feishu');
    expect(feishu_doc_create.userDataDirSegment).toBe('feishu');
    expect(feishu_base_create.userDataDirSegment).toBe('feishu');
    expect(feishu_im_send.cookieDomain).toBe('.feishu.cn');
    expect(feishu_mail_send.cookieDomain).toBe('.feishu.cn');
    expect(feishu_base_create.cookieDomain).toBe('.feishu.cn');
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

  it('M8: routes Chinese 多维表格 prompt to feishu_base_create', () => {
    const skill = selectSkill('在飞书新建一个多维表格，标题为 m8 base 测试', registry);
    expect(skill?.id).toBe('feishu_base_create');
  });

  it('M8: routes English bitable / lark base prompt to feishu_base_create', () => {
    expect(selectSkill('Create a new feishu bitable for tracking issues', registry)?.id).toBe(
      'feishu_base_create',
    );
    expect(selectSkill('build a lark base table', registry)?.id).toBe('feishu_base_create');
  });

  it('M8: 邮件 prompts return null while feishu_mail_send is deferred', () => {
    // mail skill is intentionally not in the registry (verify run
    // blocked: account has no Feishu Mail). Routing must therefore
    // fall through to generic mode, NOT mis-route to im / doc / etc.
    expect(
      selectSkill(
        "在飞书邮箱给自己写一封邮件，标题 'm8 mail 测试'，内容 'hello m8 mail'",
        registry,
      ),
    ).toBeNull();
    expect(selectSkill('Send an email to myself with subject hello', registry)).toBeNull();
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

  it('all five feishu skills include a finished() completion signal', () => {
    for (const skill of [
      feishu_im_send,
      feishu_mail_send,
      feishu_calendar_create,
      feishu_doc_create,
      feishu_base_create,
    ]) {
      const text = skill.systemPromptAddendum;
      expect(text).toContain('finished(');
      // Each skill must describe SOME visual completion cue. Match on a
      // vocabulary set so individual skills can describe their own UI signal.
      expect(text).toMatch(/气泡|模态|编辑器|条目|出现|载入|loaded|toast|已发送|列表/i);
    }
  });

  it('all five feishu skills retain a few-shot block', () => {
    for (const skill of [
      feishu_im_send,
      feishu_mail_send,
      feishu_calendar_create,
      feishu_doc_create,
      feishu_base_create,
    ]) {
      const text = skill.systemPromptAddendum;
      expect(text).toMatch(/FEW-?SHOT|few-shot|示例|例：/i);
      // Real action calls so the VLM sees concrete syntax templates.
      expect(text).toMatch(/click\(start_box=/);
    }
  });
});

describe('M7 feishu_im_send omni-search fallback + escape key correctness', () => {
  it('feishu_im_send addendum spells out the OMNI-SEARCH FALLBACK section', () => {
    const text = feishu_im_send.systemPromptAddendum;
    // Section header is the canary: if this gets renamed/dropped, the
    // VLM loses the explicit fallback path that M6 retrospective showed
    // was needed (M6 archive §9 bug A).
    expect(text).toContain('OMNI-SEARCH FALLBACK');
    // Must mark the fallback path as legal (not a hack), so the VLM
    // doesn't refuse to take it.
    expect(text).toMatch(/LEGAL|legal Feishu flow|合法/);
    // Must mark the conventional conversation search as preferred to
    // avoid the VLM defaulting to omni-search and burning extra steps.
    expect(text).toMatch(/PREFER|preferred|首选/i);
    // Must include the trigger condition (multiple mis-clicks) — the
    // fallback should be conditional, not unconditional.
    expect(text).toMatch(/(2\+|twice|2 次|两次|stuck|after.*attempt)/i);
  });

  it('feishu_im_send addendum uses the full word "escape" for hotkey, not "esc"', () => {
    const text = feishu_im_send.systemPromptAddendum;
    // Must mention the literal hotkey call form so VLM mirrors the
    // exact action syntax that BrowserOperator's KEY_MAPPINGS accepts
    // (M6 archive §9 bug B: 'esc' alias is not in KEY_MAPPINGS).
    expect(text).toContain("hotkey(key='escape')");
    // Must NOT instruct the VLM to use the 'esc' shorthand anywhere.
    // Look for telltale dangerous forms: hotkey(key='esc') or "press Esc".
    expect(text).not.toMatch(/hotkey\(key='esc'\)/);
    expect(text).not.toMatch(/press\s+Esc\b/);
  });
});

describe('M8 feishu_base_create + feishu_mail_send prompt hardening', () => {
  // M8 ships two new skills built from the m7 hotfix five-section
  // template. Each must satisfy the same prompt-hardening invariants
  // as doc/calendar (M7 hotfix block below).

  for (const skill of [feishu_base_create, feishu_mail_send]) {
    describe(`${skill.id}`, () => {
      it('addendum spells out ACTION SYNTAX requiring single-quoted start_box', () => {
        const text = skill.systemPromptAddendum;
        expect(text).toContain('ACTION SYNTAX');
        expect(text).toMatch(/click\(start_box='\[/);
        expect(text).toMatch(/start_box=\[/);
        expect(text).toMatch(/WRONG/i);
      });

      it('addendum mandates the full word "escape" (not "esc")', () => {
        const text = skill.systemPromptAddendum;
        expect(text).toContain("hotkey(key='escape')");
        expect(text).not.toMatch(/hotkey\(key='esc'\)/);
        expect(text).not.toMatch(/press\s+Esc\b/);
      });

      it('addendum has an OMNI-SEARCH FALLBACK section as recovery target', () => {
        const text = skill.systemPromptAddendum;
        expect(text).toContain('OMNI-SEARCH FALLBACK');
        expect(text).toMatch(/(does NOT|不会|recovery target|recover|escape out)/i);
      });

      it('addendum includes finished() with a visual completion cue', () => {
        const text = skill.systemPromptAddendum;
        expect(text).toContain('finished(');
        expect(text).toMatch(/(toast|已发送|编辑器|列表|已创建|渲染|出现|loaded)/i);
      });

      it('matchKeywords contain at least one Chinese token and one English token', () => {
        const kws = skill.matchKeywords.map((k) => k.toLowerCase());
        const hasChinese = kws.some((k) => /[\u4e00-\u9fff]/.test(k));
        const hasEnglish = kws.some((k) => /^[a-z][a-z\s]*$/.test(k));
        expect(hasChinese, `${skill.id}.matchKeywords needs a Chinese token`).toBe(true);
        expect(hasEnglish, `${skill.id}.matchKeywords needs an English token`).toBe(true);
      });
    });
  }

  it('feishu_base_create startingURL points at the Drive entry (M8 first-try fixed)', () => {
    // First m8 attempt used https://base.feishu.cn/, which is the
    // marketing landing page, not the authenticated app. Switched to
    // the Drive entry (same as feishu_doc_create) and the prompt now
    // tells the VLM to pick "多维表格" instead of "文档" from the
    // new-file dropdown.
    expect(feishu_base_create.startingURL).toBe('https://www.feishu.cn/drive/me/');
    expect(feishu_base_create.loginURL).toBe(feishu_base_create.startingURL);
  });

  it('feishu_mail_send startingURL points at mail.feishu.cn', () => {
    expect(feishu_mail_send.startingURL).toBe('https://mail.feishu.cn/');
    expect(feishu_mail_send.loginURL).toBe(feishu_mail_send.startingURL);
  });
});

describe('M7 hotfix feishu_doc_create + feishu_calendar_create prompt hardening', () => {
  // After M7 archive, Run 1 of feishu_doc_create failed with the VLM
  // emitting `click(start_box=[265, 100, 370, 160])` (no quotes) → the
  // BrowserOperator parser saw startY as falsy → "Missing startX(...)
  // or startY..." retry-3x failure. This hotfix added an ACTION SYNTAX
  // section + OMNI-SEARCH FALLBACK + escape full-word convention to
  // both doc and calendar skills (calendar shares the same risk class
  // and is preventatively hardened even though it has not been
  // end-to-end tested yet).

  for (const skill of [feishu_doc_create, feishu_calendar_create]) {
    describe(`${skill.id}`, () => {
      it('addendum spells out ACTION SYNTAX requiring single-quoted start_box', () => {
        const text = skill.systemPromptAddendum;
        expect(text).toContain('ACTION SYNTAX');
        // Must show the CORRECT form with single quotes.
        expect(text).toMatch(/click\(start_box='\[/);
        // Must explicitly call out the WRONG no-quote form so the VLM
        // doesn't drift to it (the actual M7-Run-1 failure mode).
        expect(text).toMatch(/start_box=\[/);
        expect(text).toMatch(/WRONG/i);
      });

      it('addendum mandates the full word "escape" (not "esc")', () => {
        const text = skill.systemPromptAddendum;
        expect(text).toContain("hotkey(key='escape')");
        expect(text).not.toMatch(/hotkey\(key='esc'\)/);
        expect(text).not.toMatch(/press\s+Esc\b/);
      });

      it('addendum has an OMNI-SEARCH FALLBACK section (recovery target)', () => {
        const text = skill.systemPromptAddendum;
        expect(text).toContain('OMNI-SEARCH FALLBACK');
        // Doc/calendar omni-search does NOT shortcut the create flow
        // (unlike IM). The section MUST acknowledge this so VLM treats
        // the modal as recovery-only, not as an alternative path.
        expect(text).toMatch(/(does NOT|不会|recovery target|recover|escape out)/i);
      });
    });
  }
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
