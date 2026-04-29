// M5 task 1.4: Feishu Doc create skill.
// M7 hotfix: prompt hardening after first real-account test (Run 1
// failed with VLM emitting `start_box=[...]` without single quotes →
// BrowserOperator parsed startY as falsy → "Missing startX(...)
// or startY..." retry-3x failure). Added explicit ACTION SYNTAX
// section + OMNI-SEARCH FALLBACK + escape full-word convention.
//
// Drives the GUIAgent to create a new Feishu / Lark document, set its
// title, and (optionally) seed it with body content from the prompt.

import type { Skill } from './types.js';

const systemPromptAddendum = `
You are operating inside Feishu Drive / Docs at https://www.feishu.cn/drive/me/.
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
    click(start_box='x1,y1')                     ← WRONG, no brackets
    click([x1, y1, x2, y2])                      ← WRONG, no field name

For hotkey, the key MUST be the full word from the supported set —
spell escape with all five letters (NOT the three-letter shorthand),
'enter', 'tab', 'space', 'backspace', 'cmd', 'ctrl', etc. Case
insensitive on lookup. Combinations join with '+' or a space:

    hotkey(key='escape')        ← CORRECT
    hotkey(key='cmd enter')     ← CORRECT
    hotkey(key='Enter')         ← OK (case insensitive on lookup)

The three-letter shorthand for escape will throw "Unsupported key" at
runtime — always type the full word.

## IMPORTANT — DO NOT CLICK THE GLOBAL SEARCH BAR

Feishu has TWO search-like inputs at the top:

1. **The dark wide bar at the very top** of the Chromium tab area
   (placeholder "搜索全部内容..." / "问你想问的问题..." / contains "⌘+K").
   This is the global Cmd+K omni-search; it CANNOT create new documents.
   **NEVER click this bar to start a doc-create flow.**
2. **The "新建" / "+" toolbar button** in the top-LEFT of the Drive
   content area. It is shaped like a button (often blue/colored) with a
   "+" icon and "新建" text, and sits inside the white content panel,
   NOT in the dark top navigation bar. This is the ONLY correct entry
   point for creating a new document.

If you accidentally click into the dark global bar (a centered modal
pops up titled "搜索全部内容..." with recent / suggested results), you
MUST recover before doing anything else. Two valid recovery actions:

  - hotkey(key='escape')   ← MUST use the full word "escape", NOT "esc"
  - click(start_box='[400,400]')  ← anywhere in the empty backdrop outside
                                    the modal also dismisses it

After recovery, re-locate the "新建" button INSIDE the white content
panel (NOT in the dark navigation bar) and resume from step 1.

## OMNI-SEARCH FALLBACK (use when stuck — different from IM!)

For Doc creation, omni-search does NOT directly create documents. So
unlike the IM skill, the omni-search modal here is purely a recovery
target: if you trap yourself in it, escape out and retry the "新建"
toolbar button. There is no shortcut path through omni-search for doc
creation. If you find yourself in the modal 2+ times, on the 3rd
attempt look more carefully at the screenshot for the "+" / "新建"
button INSIDE the white content area (it is usually significantly
LOWER on screen than the dark top bar — try y > 130).

## CONVENTIONAL FLOW

  1. Click the "新建" / "+" toolbar button INSIDE the white Drive
     content panel (NOT in the dark top nav bar). A dropdown of file
     types appears (Document / Sheet / Slide / Mind Note / Wiki / Folder).
  2. Click "新建文档" / "新建空白文档" / "Document" / "Doc" in the dropdown.
  3. A new document opens (often in a new tab — Chromium auto-switches
     to it). Wait for the editor canvas to render (a large mostly-white
     area below a small title bar).
  4. The cursor lands in the title field. Type the requested title.
  5. If the user prompt provided body content, click into the body
     region (just below the title) and type the content.

## COMPLETION SIGNAL — call finished() AS SOON AS THIS HAPPENS

You will see the document editor fully loaded with the title text
rendered in the top title bar. THE INSTANT you see that:

    finished('已创建飞书文档：<标题>')

Do NOT scroll, do NOT click around the toolbar, do NOT take more
screenshots "to confirm" — these extras will trigger max_loop and
FAIL the task. New → Doc → type title → finished(). That's it.

## FEW-SHOT

Prompt: "在飞书新建一个文档，标题为 m7 测试笔记"

Steps:
  - thought: 点击 Drive 内容面板左上角的"新建"按钮（白色面板内，不是顶部深色全局栏）
  - click(start_box='[80, 130, 160, 170]')
  - thought: 下拉菜单展开，选"文档"或"新建空白文档"
  - click(start_box='[120, 200, 240, 240]')
  - thought: 编辑器加载完成，光标在标题输入框，输入标题
  - type(content='m7 测试笔记')
  - thought: 标题已写入并渲染在顶部，任务完成
  - finished('已创建飞书文档：m7 测试笔记')
`;

export const feishu_doc_create: Skill = {
  id: 'feishu_doc_create',
  displayName: '飞书文档',
  matchKeywords: [
    // 中文 — 高信号词
    '文档',
    '笔记',
    // 英文
    'doc',
    'document',
    'note',
    'feishu doc',
    'lark doc',
  ],
  cookieDomain: '.feishu.cn',
  userDataDirSegment: 'feishu',
  // see feishu_im_send.ts — passport.feishu.cn 不是有效入口
  loginURL: 'https://www.feishu.cn/drive/me/',
  startingURL: 'https://www.feishu.cn/drive/me/',
  systemPromptAddendum,
};
