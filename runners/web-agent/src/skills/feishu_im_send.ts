// M5 task 1.4: Feishu IM message-send skill.
//
// Drives the GUIAgent through the Feishu web messenger to deliver a
// message to a specific contact or group. The system prompt biases the
// VLM towards the conventional UI flow (search contact → input
// message → send) and supplies coordinate hints for the React app.

import type { Skill } from './types.js';

const systemPromptAddendum = `
You are operating inside the Feishu (Lark) web app at https://www.feishu.cn/messenger/.
The app is a React SPA; interactive controls are <div> with custom data-* attrs.
Click target widths are typically 40-400 px and heights 30-80 px.

## IMPORTANT — DO NOT CLICK THE GLOBAL SEARCH BAR

Feishu has TWO search inputs that look similar but behave very differently:

1. **The dark wide bar across the top** of the Chromium tab area (placeholder
   often "搜索全部内容..." / "问你想问的问题..." / contains "⌘+K"). This is
   the global Cmd+K omni-search that returns apps / docs / mail. **NEVER
   click this bar to send a message — it can never lead to a chat composer.**
2. **The lighter conversation search field** sitting in the LEFT panel just
   below the "消息" header (placeholder "搜索 (⌘+K)"). This is the message-
   conversation search and is the correct entry point.

If you see the dark global bar appear, immediately click anywhere outside it
or press Esc to dismiss, then locate the conversation search in the left panel.

## CONVENTIONAL FLOW (self-chat or contact)

  1. In the LEFT panel, click the conversation search field (light, near the
     top of the conversation list, just below "消息" + "+" buttons).
  2. Type the recipient (e.g. their name or "梓文" — your own name fragment
     for self-chat).
  3. Click the FIRST matching contact/conversation result in the dropdown.
  4. The chat opens on the right. Click into the message composer at the
     bottom (typical y ≈ 720-760 on a 1280x800 viewport).
  5. Type the message text verbatim.
  6. Send with Cmd+Enter (preferred) or click the "发送" button.

## COMPLETION SIGNAL — call finished() AS SOON AS THIS HAPPENS

You will see your just-typed message appear as a colored bubble (typically
blue or brand-colored) on the RIGHT side of the conversation window with a
timestamp. The composer empties out. THE INSTANT you see that bubble:

    finished('已通过飞书向 <收件人> 发送：<消息内容>')

Do NOT scroll, do NOT confirm, do NOT take more screenshots "to be sure" —
those extra loops will trigger max_loop and FAIL the task. Send → see bubble
→ finished(). That's it.

## FEW-SHOT (self-chat)

Prompt: "在飞书给自己发条消息：hello demo"

Steps:
  - thought: 在左侧消息列表上方点击会话搜索框（不是顶部那条全局搜索栏）
  - click(start_box='[60,135]')   # 左侧会话搜索
  - thought: 输入自己用户名片段
  - type(content='梓文')
  - thought: 点击第一个搜索结果（自己的自聊条目）
  - click(start_box='[180,265]')
  - thought: 在底部消息输入框点击
  - click(start_box='[700,720]')
  - thought: 输入消息正文
  - type(content='hello demo')
  - thought: 用 Cmd+Enter 发送
  - hotkey(key='cmd enter')
  - thought: 看到右侧出现新蓝色气泡，任务完成
  - finished('已通过飞书发送给自己：hello demo')
`;

export const feishu_im_send: Skill = {
  id: 'feishu_im_send',
  displayName: '飞书 IM',
  matchKeywords: [
    // 中文 — 高信号词（飞书消息场景一般至少含其中一个）
    '消息',
    '聊天',
    'im',
    '发飞书',
    '飞书消息',
    '飞书发',
    'lark消息',
    // 英文
    'feishu message',
    'send message',
    'lark im',
    'send im',
    'im send',
    'chat',
  ],
  cookieDomain: '.feishu.cn',
  userDataDirSegment: 'feishu',
  // M5 实测发现 passport.feishu.cn/ 直接访问 404；飞书的"扫码登录"
  // 是从 messenger / drive / calendar 这种登录态页面被自动 redirect
  // 出来的。所以让 loginURL 直接指向 startingURL，让飞书前端自己接管
  // 跳转到带二维码的登录页（同源 cookie 也直接落对了 user-data-dir）。
  loginURL: 'https://www.feishu.cn/messenger/',
  startingURL: 'https://www.feishu.cn/messenger/',
  systemPromptAddendum,
};
