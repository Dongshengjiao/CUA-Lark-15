// M5 task 1.5: shared cookie-based login detection helper used as the
// default `detectLoggedIn` for skills that don't override it. Looks
// for any cookie whose domain ends with the skill's cookieDomain and
// whose name contains "session" (case-insensitive). One such cookie
// is enough to consider the user logged in; subsequent skills may
// supply a stricter override.

import type { Page } from 'puppeteer-core';
import type { Skill } from './types.js';

export function defaultDetectLoggedIn(skill: Pick<Skill, 'cookieDomain'>) {
  return async function detect(page: Page): Promise<boolean> {
    const cookies = await page.cookies();
    return cookies.some(
      (c) =>
        c.domain.endsWith(skill.cookieDomain) && c.name.toLowerCase().includes('session'),
    );
  };
}
