// M5 task 1.4: Feishu IM message-send skill.
//
// Drives the GUIAgent through the Feishu web messenger to deliver a
// message to a specific contact or group. The system prompt biases the
// VLM towards the conventional UI flow (search contact → input
// message → send) and supplies coordinate hints for the React app.

import type { Skill } from './types.js';

const systemPromptAddendum = `
You are now operating inside the Feishu (Lark) web app at https://www.feishu.cn/messenger/.
The app is a React SPA; UI elements are rendered as <div> with custom data-* attrs,
not native form controls. Click coordinates for interactive elements typically have
width 40-400 px and height 30-80 px. AVOID clicking near (0,0) — that is the empty
top-left corner.

Conventional flow to send a chat message:
  1. If the conversation list (left rail) is empty or no target conversation is
     visible, open the global search by clicking the magnifier icon at the top-left
     (around x≈80, y≈70).
  2. Type the contact / group name in the search box. Press Enter or click the first
     matching result in the dropdown.
  3. Once the conversation opens, click the message composer at the bottom.
  4. Type the message body verbatim.
  5. Send by pressing Cmd+Enter (preferred) or by clicking the "发送" / "Send" button
     at the bottom-right of the composer.
  6. After the message bubble appears in the conversation, call the final answer
     with a short confirmation including the recipient and the message snippet.

Few-shot example:
  Prompt: "给张三发条飞书消息：明天下午3点开会"
  Steps:
    - thought: 打开飞书 IM 搜索框查找张三
    - click(start_box='[80,70]')
    - thought: 输入张三搜索
    - type(content='张三')
    - thought: 选择搜索结果中的张三
    - click(start_box='[160,140]')
    - thought: 在消息输入框点击
    - click(start_box='[400,720]')
    - thought: 输入消息内容
    - type(content='明天下午3点开会')
    - thought: 通过 Cmd+Enter 发送
    - hotkey(key='cmd enter')
    - finished('已通过飞书发送给张三：明天下午3点开会')
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
