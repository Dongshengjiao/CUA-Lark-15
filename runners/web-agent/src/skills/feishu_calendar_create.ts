// M5 task 1.4: Feishu Calendar event-create skill.
// M7 hotfix: prompt hardening (parallel with feishu_doc_create) — added
// ACTION SYNTAX + OMNI-SEARCH FALLBACK + escape full-word convention.
// M9 hotfix (2026-04-30): had switched startingURL to messenger entry
// because calendar.feishu.cn has no A record. But puppeteer chromium
// loading messenger ended up redirected to docs main page in the user's
// session, sidebar didn't show the Calendar icon at the expected
// position, the VLM eventually called call_user() and gave up.
// M10 hotfix (2026-04-30): the actual reachable Feishu Calendar URL is
// tenant-routed, e.g. `https://jcneyh7qlo8i.feishu.cn/calendar/week`
// for the challenge account. We resolve it from
// `LARK_FEISHU_TENANT_DOMAIN` env at module-load time with a hardcoded
// challenge-account default. Override by setting the env when running
// dev.sh against a different tenant. The skill drops m9's "messenger
// sidebar nav" entry section because we now land directly on the
// calendar grid.
//
// Drives the GUIAgent through Feishu Calendar to create a new event
// with title / time / participants. Shares the .feishu.cn cookie jar
// with the IM and Doc skills.

const FEISHU_TENANT_DOMAIN =
  process.env.LARK_FEISHU_TENANT_DOMAIN ?? 'jcneyh7qlo8i.feishu.cn';
const CALENDAR_URL = `https://${FEISHU_TENANT_DOMAIN}/calendar/week`;

import type { Skill } from './types.js';

const systemPromptAddendum = `
You are operating inside the Feishu Calendar web app at the tenant-routed
URL https://<tenant>.feishu.cn/calendar/week (e.g. for the challenge
account: https://jcneyh7qlo8i.feishu.cn/calendar/week). The app is a
React SPA with custom interactive <div>s; click targets are typically
40-400 px wide and 30-80 px tall. The runner already lands you on the
week-view calendar grid — you do NOT need to navigate from messenger or
click any sidebar icon to switch surfaces.

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

## COMPLETION SIGNAL — STRICT — both conditions are required

You may ONLY call finished() after BOTH of the following are true on
the latest screenshot:

  1. The modal dialog has closed (not just minimized — the calendar
     grid is fully visible behind), AND
  2. A colored event block with your typed title text inside has
     appeared on the calendar grid at the date / time you intended.
     You must be able to read at least the first 3-4 characters of
     the title inside the block.

A "保存成功" / "saved" toast or banner is NOT enough on its own.
M9 verify-run #9 surfaced a false-positive completion: the VLM saw
the toast but the event block was nowhere visible, and it called
finished() while the actual event was created on the wrong date.

If after the save click you do NOT see the event block on the grid:
  - First check whether the calendar view is showing the wrong week.
    Use the date navigator (top of grid) to switch to the week
    containing your intended date, then re-screenshot.
  - If the block is still missing, scroll the time grid vertically
    so the requested hour (e.g. 15:00) is on screen.
  - If after scrolling there is STILL no block, the save likely
    failed (or saved to a different date due to picker mis-click).
    Re-open the create flow and try again with explicit date /
    time entry. Do NOT call finished() until you have visual
    confirmation of the event block.

Once the block is visible:

    finished('已创建日程：<标题>（YYYY-MM-DD HH:MM - HH:MM）')

Use the explicit YYYY-MM-DD format from the CURRENT DATE section at
the top of this prompt — do NOT hand-write "明天" or "tomorrow" in
the finished() string, because that loses what was actually saved.

## FEW-SHOT

Prompt: "创建一个明天下午3点开始、1小时的会议，标题是项目同步"

Steps:
  - thought: 已直接落在日历周视图，点击左上角"创建日程"按钮
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
  // M10 hotfix: tenant-routed URL resolved from LARK_FEISHU_TENANT_DOMAIN
  // env (defaults to challenge-account tenant for demo). m9 had used
  // messenger entry but puppeteer chromium ended up on docs main page
  // and the sidebar nav failed.
  loginURL: CALENDAR_URL,
  startingURL: CALENDAR_URL,
  systemPromptAddendum,
};
