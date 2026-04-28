// M5 task 3.1-3.3: login pre-check + QR-scan flow.
//
// The runner spawns a single headless LocalBrowser at startup. When a
// task is routed to a skill that requires login (skill.loginURL !== ''),
// the runtime calls into here BEFORE handing control to GUIAgent. We:
//
//   1. Probe the headless browser by navigating to skill.startingURL
//      and asking skill.detectLoggedIn (or the default cookie-based
//      detector) whether the session is alive.
//   2. If logged in: return — caller proceeds to run GUIAgent normally.
//   3. If not logged in:
//      a. close() the headless browser so its lock on the
//         user-data-dir is released
//      b. launch a fresh visible Chromium against the SAME user-data-dir
//      c. navigate to skill.loginURL
//      d. emit `webAgentApprovalRequested(kind: "login_qr")` so the
//         island UI can prompt the user to scan
//      e. poll detectLoggedIn every 2s until it returns true OR 30
//         minutes elapse
//      f. close the visible browser and ask the caller to re-launch
//         a new headless browser against the same user-data-dir; the
//         new browser inherits the cookies that were just persisted

import { LocalBrowser } from '@agent-infra/browser';
import type { Logger } from '@agent-infra/logger';
import type { EnvelopeSink } from './runtime.js';
import type { Skill, LoggedInDetector } from '../skills/registry.js';
import { defaultDetectLoggedIn } from '../skills/registry.js';
import { userDataDirFor } from './profiles_dir.js';

const POLL_INTERVAL_MS = 2_000;
const QR_TIMEOUT_MS = 30 * 60 * 1_000;

export interface BrowserRef {
  current: LocalBrowser;
}

export interface PrecheckArgs {
  taskID: string;
  skill: Skill;
  browserRef: BrowserRef;
  sink: EnvelopeSink;
  logger: Logger;
}

export type PrecheckOutcome =
  | { ok: true }
  | { ok: false; kind: 'cancelled'; message: string };

/**
 * Runs the login pre-check (and the QR flow if needed) and resolves
 * once the headless browser is back online and ready for the GUIAgent.
 *
 * Mutates `args.browserRef.current` when the visible→headless cycle
 * happens; callers must read browser through the ref everywhere
 * downstream.
 */
export async function ensureLoggedIn(args: PrecheckArgs): Promise<PrecheckOutcome> {
  const { taskID, skill, browserRef, sink, logger } = args;

  if (skill.loginURL.trim() === '') {
    logger.info(`[login] skill ${skill.id} has no loginURL; skipping precheck`);
    return { ok: true };
  }

  const detector = skill.detectLoggedIn ?? defaultDetectLoggedIn(skill);

  // Phase 1: probe the headless browser.
  if (await isLoggedIn(browserRef.current, skill, detector, logger)) {
    logger.info(`[login] skill ${skill.id} cookie alive; precheck pass`);
    return { ok: true };
  }

  // Phase 2: switch to a visible browser, prompt for QR scan, poll.
  logger.info(`[login] skill ${skill.id} session missing; entering QR flow`);

  await safeClose(browserRef.current, logger);

  const userDataDir = userDataDirFor(skill.userDataDirSegment);
  const visibleBrowser = new LocalBrowser({ logger });
  await visibleBrowser.launch({
    headless: false,
    userDataDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  browserRef.current = visibleBrowser;

  const visiblePage = await visibleBrowser.createPage();
  try {
    await visiblePage.goto(skill.loginURL, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    logger.warn(`[login] visible navigation to ${skill.loginURL} failed: ${err}`);
  }

  sink.send({
    type: 'event',
    event: {
      type: 'webAgentApprovalRequested',
      payload: {
        taskID,
        kind: 'login_qr',
        message: `请扫码登录${skill.displayName}`,
        timestamp: new Date(),
      },
    },
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < QR_TIMEOUT_MS) {
    if (await detect(visiblePage, detector, logger)) {
      logger.info(`[login] QR scan succeeded for skill ${skill.id}`);
      await safeClose(browserRef.current, logger);

      // Phase 3: re-launch headless against the same user-data-dir.
      const headless = new LocalBrowser({ logger });
      await headless.launch({
        headless: true,
        userDataDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      });
      browserRef.current = headless;
      return { ok: true };
    }
    await sleep(POLL_INTERVAL_MS);
  }

  logger.warn(`[login] QR scan timed out for skill ${skill.id}`);
  await safeClose(browserRef.current, logger);
  // Restore a headless browser so the runner stays ready for the next task.
  const headless = new LocalBrowser({ logger });
  await headless.launch({
    headless: true,
    userDataDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  browserRef.current = headless;

  return {
    ok: false,
    kind: 'cancelled',
    message: 'login timeout (30min)',
  };
}

async function isLoggedIn(
  browser: LocalBrowser,
  skill: Skill,
  detector: LoggedInDetector,
  logger: Logger,
): Promise<boolean> {
  const page = await browser.createPage();
  try {
    await page.goto(skill.startingURL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  } catch (err) {
    logger.warn(`[login] startingURL nav failed: ${err}`);
  }
  return detect(page, detector, logger);
}

async function detect(page: unknown, detector: LoggedInDetector, logger: Logger): Promise<boolean> {
  try {
    return await detector(page as never);
  } catch (err) {
    logger.warn(`[login] detectLoggedIn threw: ${err}`);
    return false;
  }
}

async function safeClose(browser: LocalBrowser, logger: Logger): Promise<void> {
  try {
    await browser.close();
  } catch (err) {
    logger.warn(`[login] browser.close() failed: ${err}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exposed for tests to override the QR poll timeout. */
export const _qrInternals = {
  POLL_INTERVAL_MS,
  QR_TIMEOUT_MS,
};
