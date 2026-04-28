// M5 task 1.4: Feishu Calendar event-create skill.
//
// Drives the GUIAgent through Feishu Calendar to create a new event
// with title / time / participants. Shares the .feishu.cn cookie jar
// with the IM and Doc skills.

import type { Skill } from './types.js';

const systemPromptAddendum = `
You are now operating inside the Feishu Calendar web app at https://calendar.feishu.cn/.
Like other Feishu apps this is a React SPA with custom interactive divs.

Conventional flow to create a calendar event:
  1. Click the prominent "新建日程" / "Create" button — typically a blue capsule near
     the top-left corner (x≈70, y≈110).
  2. A modal dialog opens. Fill in:
     - Title: click the title input at the top of the modal (x≈540, y≈220), then type.
     - Start time: click the start-date field (x≈420, y≈300), pick the date in the
       popover. Same for the time picker beside it.
     - End time: same convention.
     - Participants (optional): click the participant input near the bottom of the
       modal, type the name, select the dropdown match.
     - Description / location / repeat: only fill if the prompt explicitly says so.
  3. Click the primary "保存" / "Save" / "创建" button at the bottom-right of the modal
     (typically x≈930, y≈680).
  4. After the modal closes, call the final answer summarising what was created.

Few-shot example:
  Prompt: "创建一个明天下午3点开始、1小时的会议，标题是项目同步"
  Steps:
    - thought: 点击新建日程
    - click(start_box='[70,110]')
    - thought: 在标题字段输入
    - click(start_box='[540,220]')
    - type(content='项目同步')
    - thought: 调整开始时间
    - click(start_box='[420,300]')
    - ... (date / time pickers)
    - thought: 保存
    - click(start_box='[930,680]')
    - finished('已创建明日 15:00 的项目同步会议（持续 1 小时）')
`;

export const feishu_calendar_create: Skill = {
  id: 'feishu_calendar_create',
  displayName: '飞书日历',
  matchKeywords: [
    // 中文 — 高信号词
    '日程',
    '日历',
    '会议',
    '排会',
    // 英文
    'calendar',
    'schedule',
    'meeting',
    'feishu calendar',
    'lark calendar',
  ],
  cookieDomain: '.feishu.cn',
  userDataDirSegment: 'feishu',
  // see feishu_im_send.ts — passport.feishu.cn 不是有效入口
  loginURL: 'https://calendar.feishu.cn/',
  startingURL: 'https://calendar.feishu.cn/',
  systemPromptAddendum,
};
