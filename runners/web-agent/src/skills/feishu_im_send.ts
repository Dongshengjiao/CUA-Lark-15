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

If you accidentally click into the dark global bar (a centered modal pops up
with title "搜索全部内容..." and a list of recent / suggested results), you
MUST recover before doing anything else. Two valid recovery actions:

  - hotkey(key='escape')   ← MUST use the full word "escape", NOT "esc"
  - click(start_box='[400,400]')  ← anywhere in the empty backdrop outside
                                    the modal also dismisses it

After recovery, re-locate the LIGHT conversation search in the left panel
(below "消息" header) and resume from step 1.

## OMNI-SEARCH FALLBACK (use when stuck)

If you have already attempted to click the LIGHT conversation search 2+
times and each time the centered "搜索全部内容..." modal pops up (i.e.
your visual grounding keeps landing on the dark top bar despite trying
to avoid it), STOP retrying the conversation search. Use this fallback
path — it is a LEGAL Feishu flow, not a workaround that bypasses any
check:

  1. The omni-search modal is already open. Its text field has focus.
     Just type the recipient name directly:
        type(content='梓文')
  2. Wait one screenshot for results to render. The modal shows a list
     of matches; the FIRST row is usually the contact/self-chat you want.
     Click that first result row:
        click(start_box='[<center of first result>]')
  3. Feishu navigates into that contact's chat window. The omni-search
     modal closes automatically. From here the normal flow resumes:
     click the bottom message composer, type the message text, send
     with Cmd+Enter, watch for the colored bubble, finished().

PREFER the LIGHT conversation search when it is clearly clickable (1
click + 1 type vs 2 clicks + 1 type via omni-search). Use the OMNI-
SEARCH FALLBACK only after the conversation search has trapped you in
the modal twice. Do NOT default to the fallback on step 1 — the model
that ships with this prompt sometimes mis-grounds the conversation
search field, but on a clean page the conversation search is still
the faster path.

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

## FEW-SHOT (omni-search fallback after 2 mis-clicks)

Prompt: "在飞书给自己发条消息：hello demo"
(scenario: the conversation search field looks like the top global bar
to the model, so the first 2 clicks both opened the omni-search modal)

Steps:
  - thought: 第一次点击会话搜索框，但弹出了顶部 omni-search 模态
  - click(start_box='[60,135]')
  - thought: 模态遮挡，按 escape 关闭
  - hotkey(key='escape')
  - thought: 第二次点击仍然弹出 omni-search 模态 —— 视觉 grounding 反复
    误判，切换到 omni-search fallback 路径，直接在模态里搜联系人
  - click(start_box='[60,135]')
  - thought: 模态打开且输入框聚焦，直接 type 联系人名
  - type(content='梓文')
  - thought: 点击搜索结果第一行（"钟梓文-北邮"自聊条目）
  - click(start_box='[400,265]')
  - thought: 进入聊天窗口，点击底部消息输入框
  - click(start_box='[700,720]')
  - thought: 输入消息正文
  - type(content='hello demo')
  - thought: 用 Cmd+Enter 发送
  - hotkey(key='cmd enter')
  - thought: 看到右侧出现蓝色气泡，任务完成
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
