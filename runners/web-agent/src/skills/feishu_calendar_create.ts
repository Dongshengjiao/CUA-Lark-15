// M5 task 1.4: Feishu Calendar event-create skill.
// M7 hotfix: prompt hardening (parallel with feishu_doc_create) — added
// ACTION SYNTAX + OMNI-SEARCH FALLBACK + escape full-word convention.
// This skill has NOT been end-to-end tested against a real Feishu
// account yet; the hardening is preventative based on the patterns
// learned from IM (M6 archive §9) and Doc (M7 hotfix Run 1).
//
// Drives the GUIAgent through Feishu Calendar to create a new event
// with title / time / participants. Shares the .feishu.cn cookie jar
// with the IM and Doc skills.

import type { Skill } from './types.js';

const systemPromptAddendum = `
You are operating inside the Feishu Calendar web app at https://calendar.feishu.cn/.
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

The three-letter shorthand for escape will throw "Unsupported key" at
runtime — always type the full word.

## IMPORTANT — DO NOT CLICK THE GLOBAL SEARCH BAR

Feishu Calendar has two search-like UI affordances at the top:

1. **The dark wide bar at the very top** of the Chromium tab area
   (placeholder "搜索全部内容..." / "问你想问的问题..." / contains "⌘+K").
   This is the global Cmd+K omni-search; it CANNOT create calendar
   events. **NEVER click this bar.**
2. **The "新建日程" / "Create" button** on the LEFT side of the
   calendar content area, typically a colored (blue) button positioned
   below the date navigator. This is the ONLY correct entry point.

If you accidentally click into the dark global bar (a centered modal
pops up titled "搜索全部内容..."), recover via:

  - hotkey(key='escape')
  - click(start_box='[400,400]')  ← click empty backdrop also dismisses

After recovery, re-locate the "新建日程" button on the LEFT side
(NOT in the dark top nav) and resume.

## OMNI-SEARCH FALLBACK (use when stuck — different from IM!)

Calendar's omni-search does NOT create events. So unlike the IM skill,
the omni-search modal here is purely a recovery target. If you trap
yourself in it, escape out and retry "新建日程". On the 3rd attempt,
look for the create button further to the LEFT (typically x < 100)
and a bit LOWER (typically y > 130) than the dark top bar.

## CONVENTIONAL FLOW

  1. Click the "新建日程" / "Create" button on the LEFT toolbar (NOT
     the dark top nav). A modal dialog opens.
  2. Fill the fields the user asked for:
     - Title: click the title input at the top of the modal, type the
       title text.
     - Start date/time: click the start-date or start-time field, pick
       date in the popover, pick time same way.
     - End date/time: same convention.
     - Participants (optional): click the participant input near the
       bottom, type the name, click the dropdown match.
     - Description / location / repeat: ONLY fill if the prompt
       explicitly says.
  3. Click the primary "保存" / "Save" / "创建" button at the bottom-
     right of the modal.

## COMPLETION SIGNAL — call finished() AS SOON AS THIS HAPPENS

You will see the modal dialog close, AND the new event appear as a
colored block on the calendar grid (today/the chosen date) with the
title text inside. THE INSTANT you see that block:

    finished('已创建日程：<标题>（<时间>）')

Do NOT click into the new event again, do NOT verify by hovering,
do NOT re-screenshot. Modal closes → block appears → finished().

## FEW-SHOT

Prompt: "创建一个明天下午3点开始、1小时的会议，标题是项目同步"

Steps:
  - thought: 点击左侧"新建日程"按钮（不是顶部深色全局栏）
  - click(start_box='[40, 130, 130, 170]')
  - thought: 模态打开，点击标题输入框
  - click(start_box='[480, 200, 880, 240]')
  - type(content='项目同步')
  - thought: 调整开始时间为明天 15:00
  - click(start_box='[400, 280, 540, 320]')
  - # ...（日期 / 时间选择器若干步，依据弹窗实际坐标）
  - thought: 点击保存按钮
  - click(start_box='[900, 660, 980, 700]')
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
