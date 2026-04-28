// M5 task 1.3: static skill registry.
//
// The runner imports `registry` and feeds it to `selectSkill`. Order
// matters: skills with more specific keywords go first so the router
// can return on the first match (see m5-feishu-skills/design.md §D2).

import type { Skill } from './types.js';
import { feishu_im_send } from './feishu_im_send.js';
import { feishu_calendar_create } from './feishu_calendar_create.js';
import { feishu_doc_create } from './feishu_doc_create.js';

export const registry: readonly Skill[] = [
  feishu_im_send,
  feishu_calendar_create,
  feishu_doc_create,
];

export type { Skill, LoggedInDetector } from './types.js';
export { selectSkill } from './router.js';
export { defaultDetectLoggedIn } from './cookies.js';
