// M5 task 1.3: static skill registry.
//
// The runner imports `registry` and feeds it to `selectSkill`. Order
// matters: skills with more specific keywords go first so the router
// can return on the first match (see m5-feishu-skills/design.md §D2).

import type { Skill } from './types.js';
import { feishu_im_send } from './feishu_im_send.js';
import { feishu_calendar_create } from './feishu_calendar_create.js';
import { feishu_doc_create } from './feishu_doc_create.js';
import { feishu_base_create } from './feishu_base_create.js';
// M8 §D3 / §retrospective: feishu_mail_send is intentionally NOT
// registered. The implementation lives in `./feishu_mail_send.ts`
// (preserved with full prompt + tests) but the M8 verify run
// blocked at the login phase: the in-use 飞书 challenge account has
// no Feishu Mail product enabled (mail.feishu.cn returns
// ERR_NAME_NOT_RESOLVED in the user's browser, screenshot in
// archive/2026-04-29-m8-feishu-base-mail/tasks.md §7). Re-add the
// import + the array entry once a real-account Mail entry URL is
// known and reachable.

// M8 §D3 ordering: narrowest keywords first so router returns on
// first match. base's 表格 token is the broadest (could conflict
// with future feishu_sheets) and is placed last so a more specific
// skill can pre-empt it.
export const registry: readonly Skill[] = [
  feishu_im_send,
  feishu_calendar_create,
  feishu_doc_create,
  feishu_base_create,
];

export type { Skill, LoggedInDetector } from './types.js';
export { selectSkill } from './router.js';
export { defaultDetectLoggedIn } from './cookies.js';
