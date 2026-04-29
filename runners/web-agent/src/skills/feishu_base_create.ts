// M8 task 1.x: Feishu Base (multidimensional table / bitable) create skill.
//
// Drives the GUIAgent to create a new Feishu Base file via the Drive
// entry point (https://www.feishu.cn/drive/me/), pick "多维表格" from
// the new-file dropdown (instead of "文档" which the doc skill picks),
// set its title, and reach the editor canvas. The "stage 1" minimum
// demo only covers create-with-title; field/row/view operations are
// stage 2 (post-m8).
//
// startingURL choice: M8 first try used `https://base.feishu.cn/` and
// failed end-to-end — that domain serves the marketing landing page,
// NOT the user's authenticated Base dashboard, so the VLM saw a hero
// section with no "+ 新建" button and burned 22 steps trying to find
// the dashboard before quitting. Switching to Drive (same as doc
// skill) gives the VLM an authenticated file list right away; it just
// has to pick "多维表格" instead of "文档" in the new-file dropdown.
//
// Prompt template follows the m7 hotfix five-section pattern
// (ACTION SYNTAX / IMPORTANT / OMNI-SEARCH FALLBACK / CONVENTIONAL
// FLOW / COMPLETION SIGNAL / FEW-SHOT).

import type { Skill } from './types.js';

const systemPromptAddendum = `
You are operating inside Feishu Drive at https://www.feishu.cn/drive/me/.
The user wants to CREATE A NEW MULTIDIMENSIONAL TABLE (Base / bitable),
which lives in the same Drive workspace as regular documents but is a
different file type (selected via the 新建 dropdown). The app is a
React SPA with custom interactive <div>s; click targets are typically
40-400 px wide and 30-80 px tall.

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
    hotkey(key='cmd enter')     ← CORRECT

The three-letter shorthand for escape will throw "Unsupported key" at
runtime — always type the full word.

## IMPORTANT — DO NOT CLICK THE GLOBAL SEARCH BAR

Feishu has TWO search-like inputs at the top:

1. **The dark wide bar at the very top** (placeholder "搜索全部内容..." /
   "问你想问的问题..." / contains "⌘+K"). This is the global Cmd+K
   omni-search; it CANNOT create new bases. **NEVER click this bar to
   start a base-create flow.**
2. **The "+ 新建" / "新建" toolbar button** in the top-LEFT of the
   white Drive content area. It is shaped like a button (often
   blue/colored) with a "+" icon and "新建" text, and sits inside the
   white content panel (NOT in the dark top navigation bar). This is
   the ONLY correct entry point. Note: this button opens a dropdown
   from which you must pick **"多维表格"** (NOT "文档", which is what
   the document-creation flow picks).

If you accidentally click into the dark global bar (a centered modal
pops up titled "搜索全部内容..."), you MUST recover before doing
anything else. Two valid recovery actions:

  - hotkey(key='escape')
  - click(start_box='[400,400]')  ← clicking empty backdrop also dismisses

After recovery, re-locate the "新建" button INSIDE the white content
panel and resume from step 1.

## OMNI-SEARCH FALLBACK (recovery target only — different from IM!)

For Base creation, omni-search does NOT directly create new tables. So
unlike the IM skill, the omni-search modal here is purely a recovery
target: if you trap yourself in it, escape out and retry the "新建"
button. There is no shortcut path through omni-search for creating a
base. If you find yourself in the modal 2+ times, on the 3rd attempt
look more carefully at the screenshot for the "+" / "新建" button
INSIDE the white content area (it is usually significantly LOWER on
screen than the dark top bar — try y > 130).

## CONVENTIONAL FLOW

  1. Click the "+ 新建" / "新建" toolbar button INSIDE the white Drive
     content panel (NOT in the dark top nav bar). A dropdown of file
     types appears (Document / Sheet / Slide / Mind Note / Multi-
     dimensional Table / Wiki / Folder).
  2. Click **"多维表格"** in the dropdown (NOT "文档" — that creates a
     regular document, which is the wrong type for this task). The
     "多维表格" entry typically has a colorful grid icon. If a template
     selection panel pops up after clicking, choose "+ 新建空白表" or
     the equivalent blank-table option (typically the first / left-
     most card).
  3. A new base opens (often in a new tab — Chromium auto-switches to
     it). Wait for the table grid to render (columns + a few empty
     rows in a spreadsheet-like layout).
  4. The default title is "未命名表" / "Untitled" shown at the top.
     Click into the title bar at the top of the editor to make it
     editable.
  5. Type the requested title to overwrite "未命名表".
  6. Click anywhere outside the title or press Tab to commit the new
     title — the title bar should now show the typed text.

## COMPLETION SIGNAL — call finished() AS SOON AS THIS HAPPENS

You will see the base editor fully loaded, with:
  - the table grid (columns + a few empty rows) rendered, AND
  - the requested title text displayed in the top title bar (replacing
    the default "未命名表").

THE INSTANT you see both:

    finished('已创建飞书多维表格：<标题>')

Do NOT scroll the grid, do NOT add fields, do NOT take more screenshots
"to confirm" — these extras will trigger max_loop and FAIL the task.
新建 → 多维表格 → editor loads → title typed → finished(). That's it.

## FEW-SHOT

Prompt: "在飞书新建一个多维表格，标题为 m8 base 测试"

Steps:
  - thought: 点击 Drive 内容面板左上角的"新建"按钮（白色面板内，不是顶部深色全局栏）
  - click(start_box='[80, 130, 160, 170]')
  - thought: 下拉菜单展开，选"多维表格"（不是"文档"！注意 icon 是彩色 grid 图标）
  - click(start_box='[120, 240, 240, 280]')
  - thought: 模板面板可能出现，选"+ 新建空白表"
  - click(start_box='[100, 220, 280, 280]')
  - thought: 表格编辑器加载，点击顶部标题栏（默认"未命名表"）让其可编辑
  - click(start_box='[180, 90, 380, 130]')
  - thought: 输入新标题
  - type(content='m8 base 测试')
  - thought: 按 tab 提交标题，避免回车在表格内创建新行
  - hotkey(key='tab')
  - thought: 标题已渲染、表格 grid 已加载，任务完成
  - finished('已创建飞书多维表格：m8 base 测试')
`;

export const feishu_base_create: Skill = {
  id: 'feishu_base_create',
  displayName: '飞书多维表格',
  matchKeywords: [
    // 中文 — 高信号词
    '多维表格',
    '飞书表格',
    '表格',
    // 英文
    'bitable',
    'feishu base',
    'lark base',
    'base',
  ],
  cookieDomain: '.feishu.cn',
  userDataDirSegment: 'feishu',
  // M5 convention: loginURL === startingURL — Feishu front-end redirects
  // unauthenticated users to the QR login page automatically.
  // M8 first-try note: `https://base.feishu.cn/` is the marketing
  // landing page, NOT the authenticated app. Use the Drive entry
  // (same as feishu_doc_create) and pick "多维表格" from the new-file
  // dropdown instead.
  loginURL: 'https://www.feishu.cn/drive/me/',
  startingURL: 'https://www.feishu.cn/drive/me/',
  systemPromptAddendum,
};
