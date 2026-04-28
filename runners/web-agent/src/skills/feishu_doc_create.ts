// M5 task 1.4: Feishu Doc create skill.
//
// Drives the GUIAgent to create a new Feishu / Lark document, set its
// title, and (optionally) seed it with body content from the prompt.

import type { Skill } from './types.js';

const systemPromptAddendum = `
You are now operating inside Feishu Drive / Docs at https://www.feishu.cn/drive/me/.

Conventional flow to create a new document:
  1. Click the "新建" / "+" button in the toolbar, typically near the top-left
     (around x≈80, y≈100). A dropdown of file types appears.
  2. Click "新建文档" / "Document" / "Doc" in the dropdown.
  3. The new document opens in a new tab/page. Wait for the editor canvas to render
     (large white area in the middle of the viewport).
  4. The cursor lands in the title field at the top — type the requested title and
     press Enter or Tab to commit.
  5. If the user prompt provides body content, click into the body region (just below
     the title) and type the content.
  6. Once the title (and optional body) appear in the document, call the final answer
     summarising the created document title + the URL shown in the address bar.

Few-shot example:
  Prompt: "在飞书新建一个文档，标题为 M5 demo notes"
  Steps:
    - thought: 点击新建按钮
    - click(start_box='[80,100]')
    - thought: 选择新建文档
    - click(start_box='[120,160]')
    - thought: 在标题输入
    - type(content='M5 demo notes')
    - hotkey(key='enter')
    - finished('已创建标题为 "M5 demo notes" 的飞书文档')
`;

export const feishu_doc_create: Skill = {
  id: 'feishu_doc_create',
  displayName: '飞书文档',
  matchKeywords: [
    // 中文
    '创建文档',
    '新建文档',
    '建文档',
    '飞书文档',
    '建个文档',
    // 英文
    'create doc',
    'create document',
    'new doc',
    'new document',
    'feishu doc',
    'lark doc',
  ],
  cookieDomain: '.feishu.cn',
  userDataDirSegment: 'feishu',
  loginURL: 'https://passport.feishu.cn/',
  startingURL: 'https://www.feishu.cn/drive/me/',
  systemPromptAddendum,
};
