// M5 task 1.4: Feishu Doc create skill.
//
// Drives the GUIAgent to create a new Feishu / Lark document, set its
// title, and (optionally) seed it with body content from the prompt.

import type { Skill } from './types.js';

const systemPromptAddendum = `
You are operating inside Feishu Drive / Docs at https://www.feishu.cn/drive/me/.
The app is a React SPA with custom interactive <div>s; click targets are
typically 40-400 px wide and 30-80 px tall.

## IMPORTANT — DO NOT CLICK THE GLOBAL SEARCH BAR

The dark wide bar at the very top (placeholder "搜索全部内容..." / "⌘+K") is
the global omni-search and CANNOT create new documents. Ignore it entirely.
The "create new doc" entry is the prominent "新建" / "+" button in the
top-left of the Drive toolbar (typical position x≈80, y≈100).

## CONVENTIONAL FLOW

  1. Click the "新建" / "+" toolbar button. A dropdown of file types appears
     (Document / Sheet / Slide / Mind Note / Wiki / Folder).
  2. Click "新建文档" / "Document" / "Doc" in the dropdown.
  3. A new document opens (often in a new tab — switch to it). Wait for the
     editor canvas to render (a large mostly-white area below a small title bar).
  4. The cursor lands in the title field. Type the requested title.
  5. If the user prompt provided body content, click into the body region
     (just below the title) and type the content.

## COMPLETION SIGNAL — call finished() AS SOON AS THIS HAPPENS

You will see the document editor fully loaded with the title text rendered
in the top title bar. THE INSTANT you see that:

    finished('已创建飞书文档：<标题>')

Do NOT scroll, do NOT click around the toolbar, do NOT take more screenshots
"to confirm" — these extras will trigger max_loop and FAIL the task. New →
Doc → type title → finished(). That's it.

## FEW-SHOT

Prompt: "在飞书新建一个文档，标题为 M5 demo notes"

Steps:
  - thought: 点击 Drive 左上角的新建按钮
  - click(start_box='[80,100]')
  - thought: 选择"新建文档"
  - click(start_box='[120,160]')
  - thought: 编辑器加载完成，光标在标题，输入标题
  - type(content='M5 demo notes')
  - thought: 标题已写入，任务完成
  - finished('已创建飞书文档：M5 demo notes')
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
