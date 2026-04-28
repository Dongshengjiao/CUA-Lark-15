// M5 task 1.1: Skill interface for the web-agent runner.
//
// A Skill is a static description object that the runner consults
// after routing a task prompt. It tells the runner where to navigate,
// what user-data-dir to load, when to consider the user "logged in",
// and what extra prompt context to inject into the GUIAgent system
// message. We deliberately keep it as a plain object (no class
// inheritance) — see m5-feishu-skills/design.md §D1.

import type { Page } from 'puppeteer-core';

/** Async hook to determine whether the page is in a logged-in state. */
export type LoggedInDetector = (page: Page) => Promise<boolean>;

export interface Skill {
  /** kebab-case unique identifier, e.g. "feishu_im_send". */
  readonly id: string;

  /** Human-readable label used in approval messages, e.g. "飞书". */
  readonly displayName: string;

  /**
   * Lower-cased substrings the router looks for in the user prompt.
   * Order does not matter inside a skill; matching is `some(includes)`.
   */
  readonly matchKeywords: readonly string[];

  /** Cookie domain checked by the default detectLoggedIn (e.g. ".feishu.cn"). */
  readonly cookieDomain: string;

  /**
   * Sub-directory under `~/Library/Application Support/LarkIsland/web-agent/profiles/`
   * that holds this skill's chromium user-data-dir. Multiple skills can
   * share the same segment to share login state (e.g. all feishu skills
   * share "feishu").
   */
  readonly userDataDirSegment: string;

  /** Visible login URL opened during the QR-scan flow. Empty string skips the precheck. */
  readonly loginURL: string;

  /** First URL the runner navigates to when starting the task. */
  readonly startingURL: string;

  /**
   * String appended to the GUIAgent system prompt when this skill is
   * active. Should contain skill-specific guidance, coordinate hints,
   * and 1-2 few-shot examples to bias the VLM towards the skill's
   * expected interaction patterns.
   */
  readonly systemPromptAddendum: string;

  /**
   * Optional override for the default cookie-based login detection.
   * Receives the current page and returns true if the user is already
   * logged in.
   */
  readonly detectLoggedIn?: LoggedInDetector;
}
