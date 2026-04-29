// M5 task 3.1-3.3: login pre-check + QR-scan flow.
// M7 task 1.x: per-skill profile alignment (Phase 0).
//
// The runner spawns a single headless LocalBrowser at startup using the
// 'generic' user-data-dir (so a default starting URL like google.com can
// be pre-loaded for generic tasks). When a task is routed to a skill
// that requires login (skill.loginURL !== ''), the runtime calls into
// here BEFORE handing control to GUIAgent. We:
//
//   0. Phase 0 (M7): if browserRef.currentSegment !== skill.userDataDirSegment,
//      close the current browser and relaunch a fresh headless one against
//      the skill's user-data-dir. This ensures Phase 1's cookie probe
//      runs against the right profile (M6 archive §9 bug C: previously
//      the probe ran against the 'generic' profile and never found feishu
//      cookies even when they were valid, forcing a redundant QR scan
//      every runner restart).
//   1. Probe the (now-aligned) headless browser by navigating to
//      skill.startingURL and asking skill.detectLoggedIn (or the default
//      cookie-based detector) whether the session is alive.
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
//
// All browser lifecycle steps that mutate browserRef.current MUST also
// update browserRef.currentSegment in lockstep so the next ensureLoggedIn
// call can correctly decide whether Phase 0 is needed.

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
  /**
   * The user-data-dir segment that `current` was launched with. Used by
   * ensureLoggedIn Phase 0 to decide whether the browser needs to be
   * recreated against a different segment before probing login state.
   *
   * Initial value is set by the runner at startup ('generic' for the
   * pre-launched chromium). Mutated by every ensureLoggedIn lifecycle
   * step that close-then-relaunches the browser.
   */
  currentSegment: string;
}

/**
 * Test hook: factory for creating a fresh LocalBrowser. Production
 * code uses the default `(logger) => new LocalBrowser({ logger })`;
 * tests inject a mock to avoid spawning real chromium.
 */
export type LocalBrowserFactory = (logger: Logger) => LocalBrowser;

export interface PrecheckArgs {
  taskID: string;
  skill: Skill;
  browserRef: BrowserRef;
  sink: EnvelopeSink;
  logger: Logger;
  /** Optional override for tests; defaults to `(logger) => new LocalBrowser({ logger })`. */
  browserFactory?: LocalBrowserFactory;
}

export type PrecheckOutcome =
  | { ok: true }
  | { ok: false; kind: 'cancelled'; message: string };

/**
 * Runs the login pre-check (and the QR flow if needed) and resolves
 * once the headless browser is back online and ready for the GUIAgent.
 *
 * Mutates `args.browserRef.current` and `args.browserRef.currentSegment`
 * whenever the underlying chromium is recreated (Phase 0 segment
 * alignment, Phase 2 visible→headless QR cycle, Phase 3 timeout
 * recovery). Callers must read browser through the ref everywhere
 * downstream.
 */
export async function ensureLoggedIn(args: PrecheckArgs): Promise<PrecheckOutcome> {
  const { taskID, skill, browserRef, sink, logger } = args;
  const browserFactory: LocalBrowserFactory =
    args.browserFactory ?? ((l) => new LocalBrowser({ logger: l }));

  if (skill.loginURL.trim() === '') {
    logger.info(`[login] skill ${skill.id} has no loginURL; skipping precheck`);
    return { ok: true };
  }

  const userDataDir = userDataDirFor(skill.userDataDirSegment);
  const detector = skill.detectLoggedIn ?? defaultDetectLoggedIn(skill);

  // Phase 0 (M7): align browserRef with the skill's user-data-dir
  // before probing. The runner pre-launches with 'generic', so any
  // skill task that needs a different segment must swap the browser
  // here — otherwise Phase 1's cookie probe runs against the wrong
  // profile and always misses (M6 archive §9 bug C).
  if (browserRef.currentSegment !== skill.userDataDirSegment) {
    logger.info(
      `[login] swapping browser segment ${browserRef.currentSegment} → ${skill.userDataDirSegment} for skill ${skill.id}`,
    );
    await safeClose(browserRef.current, logger);
    const aligned = browserFactory(logger);
    await aligned.launch({
      headless: true,
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    browserRef.current = aligned;
    browserRef.currentSegment = skill.userDataDirSegment;
  }

  // Phase 1: probe the (now-aligned) headless browser.
  if (await isLoggedIn(browserRef.current, skill, detector, logger)) {
    logger.info(`[login] skill ${skill.id} cookie alive; precheck pass`);
    return { ok: true };
  }

  // Phase 2: switch to a visible browser, prompt for QR scan, poll.
  logger.info(`[login] skill ${skill.id} session missing; entering QR flow`);

  await safeClose(browserRef.current, logger);

  const visibleBrowser = browserFactory(logger);
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
  browserRef.currentSegment = skill.userDataDirSegment;

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
      const headless = browserFactory(logger);
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
      browserRef.currentSegment = skill.userDataDirSegment;
      return { ok: true };
    }
    await sleep(POLL_INTERVAL_MS);
  }

  logger.warn(`[login] QR scan timed out for skill ${skill.id}`);
  await safeClose(browserRef.current, logger);
  // Restore a headless browser so the runner stays ready for the next task.
  // Keep currentSegment === skill.userDataDirSegment so a follow-up task on
  // the same skill doesn't redundantly hit Phase 0 (the user-data-dir is
  // already the right one; only the cookie-state probe needs to re-run).
  const headless = browserFactory(logger);
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
  browserRef.currentSegment = skill.userDataDirSegment;

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
