// M5 task 1.4: Feishu Calendar event-create skill.
//
// Drives the GUIAgent through Feishu Calendar to create a new event
// with title / time / participants. Shares the .feishu.cn cookie jar
// with the IM and Doc skills.

import type { Skill } from './types.js';

const systemPromptAddendum = `
You are operating inside the Feishu Calendar web app at https://calendar.feishu.cn/.
The app is a React SPA with custom interactive <div>s; click targets are typically
40-400 px wide and 30-80 px tall.

## IMPORTANT — DO NOT CLICK THE GLOBAL SEARCH BAR

The dark wide bar at the very top (placeholder "搜索全部内容..." / "⌘+K") is
the global omni-search and CANNOT create calendar events. Ignore it. The
"create event" entry is the prominent blue/colored "新建日程" / "Create"
button on the left side (typical position near x≈70, y≈110).

## CONVENTIONAL FLOW

  1. Click the "新建日程" / "Create" button on the left toolbar.
  2. A modal dialog opens. Fill the fields the user asked for:
     - Title: click the title input at the top of the modal (x≈540, y≈220), type.
     - Start date/time: click the start-date or time field (x≈420, y≈300), pick
       date in the popover, same for time.
     - End date/time: same convention.
     - Participants (optional): click the participant input near the bottom,
       type the name, click the dropdown match.
     - Description / location / repeat: ONLY fill if the prompt explicitly says.
  3. Click the primary "保存" / "Save" / "创建" button at the bottom-right of
     the modal (typical position x≈930, y≈680).

## COMPLETION SIGNAL — call finished() AS SOON AS THIS HAPPENS

You will see the modal dialog close, AND the new event appear as a colored
block on the calendar grid (today/the chosen date) with the title text inside.
THE INSTANT you see that block:

    finished('已创建日程：<标题>（<时间>）')

Do NOT click into the new event again, do NOT verify by hovering, do NOT
re-screenshot. Send → modal closes → block appears → finished(). Extra
operations will trigger max_loop and FAIL the task.

## FEW-SHOT

Prompt: "创建一个明天下午3点开始、1小时的会议，标题是项目同步"

Steps:
  - thought: 点击新建日程按钮
  - click(start_box='[70,110]')
  - thought: 在标题字段输入
  - click(start_box='[540,220]')
  - type(content='项目同步')
  - thought: 调整开始时间为明天 15:00
  - click(start_box='[420,300]')
  - # ...（日期 / 时间选择器若干步）
  - thought: 点击保存
  - click(start_box='[930,680]')
  - thought: 模态关闭、日历上看到"项目同步"新条目，任务完成
  - finished('已创建日程：项目同步（明天 15:00 - 16:00）')
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
