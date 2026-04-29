// M8 task 2.x: Feishu Mail send skill — DEFERRED STUB.
//
// Status: implementation complete but NOT registered in
// `./registry.ts`. M8 verify run reproduced ERR_NAME_NOT_RESOLVED on
// `mail.feishu.cn` in the user's actual browser session — the in-use
// 飞书 challenge account has no Feishu Mail product enabled, so the
// startingURL below is unreachable and any task routed here would
// hang the QR-login flow indefinitely.
//
// Why we keep the file:
//   1. The prompt template (m7 hotfix five-section pattern) is solid;
//      tests in skills.test.ts lock the prompt invariants so it does
//      not bit-rot.
//   2. Once a Mail-enabled account is available (or the team confirms
//      the real internal Mail entry URL), unblocking only requires
//      flipping the import + the array entry in registry.ts back on
//      and verifying ≤ 25 step end-to-end.
//
// To unblock:
//   - Confirm the Mail entry URL (likely some variant of
//     mail.feishu.cn / lark.cn/mail / a tenant subdomain), update
//     `loginURL = startingURL` below.
//   - Add `import { feishu_mail_send } from './feishu_mail_send.js'`
//     and the array entry in `./registry.ts`.
//   - Run `npx tsx test/observer-client.ts demo-mail "..."` and capture
//     the result in a follow-up retrospective.
//
// Drives the GUIAgent through Feishu Mail to compose and send an
// email. Stage 1 minimum demo: write to self / type subject / type
// body / send — no attachment / reply support yet (those are stage 2).
// Prompt template follows the m7 hotfix five-section pattern.

import type { Skill } from './types.js';

const systemPromptAddendum = `
You are operating inside the Feishu Mail web app at https://mail.feishu.cn/.
The app is a React SPA with custom interactive <div>s; click targets are
typically 40-400 px wide and 30-80 px tall.

## ACTION SYNTAX — coordinates MUST be inside single-quoted strings

When emitting click / left_double / right_single / drag / scroll, the
coordinate box MUST be a SINGLE-QUOTED STRING in the start_box / end_box
field. The parser only accepts:

    click(start_box='[x1, y1, x2, y2]')         ← CORRECT
    click(start_box='[x, y]')                    ← also CORRECT (single point)

Do NOT emit any of these forms — they are silently dropped or mis-parsed:

    click(start_box=[x1, y1, x2, y2])            ← WRONG, missing quotes
    click(start_box="[x1, y1, x2, y2]")          ← WRONG, double quotes

For hotkey, the key MUST be the full word from the supported set —
spell escape with all five letters (NOT the three-letter shorthand),
'enter', 'tab', 'space', 'cmd', etc.

    hotkey(key='escape')        ← CORRECT
    hotkey(key='cmd enter')     ← CORRECT (typical mail send shortcut)

The three-letter shorthand for escape will throw "Unsupported key" at
runtime — always type the full word.

## IMPORTANT — DO NOT CLICK THE GLOBAL SEARCH BAR

Feishu has TWO search-like inputs at the top:

1. **The dark wide bar at the very top** of the Chromium tab area
   (placeholder "搜索全部内容..." / "问你想问的问题..." / contains "⌘+K").
   This is the global Cmd+K omni-search; it CANNOT compose new emails.
   **NEVER click this bar to start a write-mail flow.**
2. **The "写信" / "Compose" / "新建邮件" button** typically in the
   top-LEFT of the mail content panel — usually a colored (blue or
   brand-colored) button with a pencil/envelope icon and "写信" text.
   This is the ONLY correct entry point for composing a new email.

If you accidentally click into the dark global bar (a centered modal
pops up titled "搜索全部内容..."), recover via:

  - hotkey(key='escape')
  - click(start_box='[400,400]')  ← clicking empty backdrop also dismisses

After recovery, re-locate the "写信" button INSIDE the mail content
panel and resume from step 1.

## OMNI-SEARCH FALLBACK (recovery target only — different from IM!)

For Mail composition, omni-search does NOT directly open a compose
window. So unlike the IM skill, the omni-search modal here is purely a
recovery target: if you trap yourself in it, escape out and retry the
"写信" button. There is no shortcut path through omni-search for
sending mail. If you find yourself in the modal 2+ times, on the 3rd
attempt look for the "写信" button further to the LEFT (typically
x < 150) and a bit LOWER (typically y > 110) than the dark top bar.

## CONVENTIONAL FLOW

  1. Click the "写信" / "Compose" button on the LEFT side of the mail
     content area (NOT the dark top nav).
  2. A compose window opens — could be a right-side drawer, a centered
     modal, or full-page editor depending on layout. Wait for the
     "收件人" / "To" field to render.
  3. Click into the "收件人" / "To" field (top of the compose window)
     and type the recipient's email address. For "send to self" tasks,
     type your own email address (Feishu mail usually exposes "我自己"
     or your name in an autocomplete dropdown — click the first
     matching suggestion, OR just complete the typed address with full
     domain).
  4. Click the "主题" / "Subject" field. Type the subject text.
  5. Click into the body / 正文 area (the largest text region below
     subject). Type the body text.
  6. Click the primary "发送" / "Send" button at the bottom-right of
     the compose window. Alternatively use the hotkey
     hotkey(key='cmd enter') if that shortcut is documented in the
     compose toolbar (Feishu mail typically supports it).

## COMPLETION SIGNAL — call finished() AS SOON AS THIS HAPPENS

You will see ONE of the following signals — any one is sufficient:

  - A "已发送" / "邮件已发送" / "Sent" toast message at the screen
    bottom or top-right.
  - The compose window closes and you land back on the mailbox view.
  - The newly sent email appears in the "已发送" / "Sent" folder
    (visible if you switched to that folder).

THE INSTANT you see any of those:

    finished('已通过飞书邮箱发送：<主题>')

Do NOT click into the sent email to verify, do NOT switch folders just
to check, do NOT take more screenshots — these extras will trigger
max_loop and FAIL the task. Send → toast/window-close → finished().

## FEW-SHOT

Prompt: "在飞书邮箱给自己写一封邮件，标题 'm8 mail 测试'，内容 'hello m8 mail'"

Steps:
  - thought: 点击左上角"写信"按钮（白色内容面板内，不是顶部深色全局栏）
  - click(start_box='[40, 110, 130, 150]')
  - thought: 写信窗口打开，点击收件人输入框
  - click(start_box='[200, 180, 800, 220]')
  - thought: 输入自己的邮箱（用户名片段，飞书会自动建议自己的邮箱）
  - type(content='梓文')
  - thought: 点击下拉建议中"我自己"或自己邮箱条目
  - click(start_box='[200, 240, 600, 280]')
  - thought: 点击主题字段
  - click(start_box='[200, 290, 800, 330]')
  - type(content='m8 mail 测试')
  - thought: 点击正文区
  - click(start_box='[200, 380, 800, 420]')
  - type(content='hello m8 mail')
  - thought: 点击右下角"发送"按钮
  - click(start_box='[900, 660, 980, 700]')
  - thought: 看到"已发送" toast 出现，任务完成
  - finished('已通过飞书邮箱发送：m8 mail 测试')
`;

export const feishu_mail_send: Skill = {
  id: 'feishu_mail_send',
  displayName: '飞书邮箱',
  matchKeywords: [
    // 中文 — 高信号词
    '邮件',
    '邮箱',
    '发邮件',
    '飞书邮件',
    '写邮件',
    // 英文
    'mail',
    'email',
    'feishu mail',
    'lark mail',
    'send mail',
  ],
  cookieDomain: '.feishu.cn',
  userDataDirSegment: 'feishu',
  // M5 convention: loginURL === startingURL — Feishu front-end redirects
  // unauthenticated users to the QR login page automatically. mail.feishu.cn
  // returned 503 to anonymous WebFetch but redirects to the login flow
  // when accessed in a real browser session.
  loginURL: 'https://mail.feishu.cn/',
  startingURL: 'https://mail.feishu.cn/',
  systemPromptAddendum,
};
