// M7 task 2.x: ensureLoggedIn Phase 0 segment-alignment tests.
//
// Verifies the M6 archive §9 bug C fix: when the runner pre-launched a
// chromium against the 'generic' user-data-dir but the incoming task's
// skill needs a different segment ('feishu'), ensureLoggedIn must
// close+relaunch the browser against the skill's segment BEFORE probing
// cookies, otherwise the probe runs against the wrong profile and never
// finds the session.
//
// We mock LocalBrowser entirely (no real chromium spawn) and inject it
// via the browserFactory test hook on PrecheckArgs.

import { describe, expect, it } from 'vitest';
import {
  ensureLoggedIn,
  type BrowserRef,
  type LocalBrowserFactory,
  _qrInternals,
} from '../src/agent/login.js';
import type { Skill } from '../src/skills/registry.js';
import type { EnvelopeSink } from '../src/agent/runtime.js';
import type { BridgeEnvelope } from '../src/bridge/types.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface LaunchCall {
  headless: boolean;
  userDataDir: string;
}

class FakeBrowser {
  public closed = false;
  public launches: LaunchCall[] = [];
  // The detector ignores the page object — we only need an opaque
  // truthy stand-in so calls like `page.goto` resolve without throwing.
  private readonly fakePage = {
    goto: async () => {
      /* noop */
    },
    cookies: async () => [] as Array<{ domain: string; name: string }>,
  };

  async launch(opts: { headless: boolean; userDataDir: string; args: string[] }): Promise<void> {
    this.launches.push({ headless: opts.headless, userDataDir: opts.userDataDir });
  }
  async createPage(): Promise<unknown> {
    return this.fakePage;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

function makeSink(): { sink: EnvelopeSink; envelopes: BridgeEnvelope[] } {
  const envelopes: BridgeEnvelope[] = [];
  return {
    sink: {
      send(env) {
        envelopes.push(env);
      },
    },
    envelopes,
  };
}

function makeSkill(overrides: {
  segment: string;
  loginURL?: string;
  detector: () => Promise<boolean> | boolean;
}): Skill {
  return {
    id: `fake-${overrides.segment}`,
    displayName: `Fake (${overrides.segment})`,
    matchKeywords: ['fake'],
    cookieDomain: '.example.com',
    userDataDirSegment: overrides.segment,
    loginURL: overrides.loginURL ?? 'https://www.example.com/login',
    startingURL: 'https://www.example.com/',
    systemPromptAddendum: 'fake',
    detectLoggedIn: async () => overrides.detector(),
  } as Skill;
}

function makeFactory(): {
  factory: LocalBrowserFactory;
  spawned: FakeBrowser[];
} {
  const spawned: FakeBrowser[] = [];
  return {
    spawned,
    factory: () => {
      const b = new FakeBrowser();
      spawned.push(b);
      return b as unknown as never;
    },
  };
}

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  log: () => {},
} as never;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('M7 ensureLoggedIn Phase 0 — per-skill profile alignment', () => {
  it('case A: currentSegment=generic, skill segment=feishu, cookie alive → swaps browser, no QR flow', async () => {
    const initial = new FakeBrowser();
    const browserRef: BrowserRef = {
      current: initial as unknown as never,
      currentSegment: 'generic',
    };
    const { factory, spawned } = makeFactory();
    const { sink, envelopes } = makeSink();
    const skill = makeSkill({ segment: 'feishu', detector: () => true });

    const outcome = await ensureLoggedIn({
      taskID: 't-case-a',
      skill,
      browserRef,
      sink,
      logger: silentLogger,
      browserFactory: factory,
    });

    expect(outcome).toEqual({ ok: true });
    expect(initial.closed).toBe(true);
    expect(spawned.length).toBe(1);
    expect(spawned[0]?.launches[0]?.headless).toBe(true);
    expect(spawned[0]?.launches[0]?.userDataDir).toMatch(/profiles\/feishu$/);
    expect(browserRef.current).toBe(spawned[0] as unknown as never);
    expect(browserRef.currentSegment).toBe('feishu');
    // No QR-flow envelope: webAgentApprovalRequested must NOT have fired.
    const approval = envelopes.find(
      (e) => e.type === 'event' && e.event.type === 'webAgentApprovalRequested',
    );
    expect(approval).toBeUndefined();
  });

  it('case B: currentSegment=feishu, skill segment=feishu, cookie alive → no relaunch, ref unchanged', async () => {
    const initial = new FakeBrowser();
    const browserRef: BrowserRef = {
      current: initial as unknown as never,
      currentSegment: 'feishu',
    };
    const { factory, spawned } = makeFactory();
    const { sink } = makeSink();
    const skill = makeSkill({ segment: 'feishu', detector: () => true });

    const outcome = await ensureLoggedIn({
      taskID: 't-case-b',
      skill,
      browserRef,
      sink,
      logger: silentLogger,
      browserFactory: factory,
    });

    expect(outcome).toEqual({ ok: true });
    expect(initial.closed).toBe(false);
    expect(spawned.length).toBe(0);
    expect(browserRef.current).toBe(initial as unknown as never);
    expect(browserRef.currentSegment).toBe('feishu');
  });

  it('case C: currentSegment=generic, cookie missing → Phase 0 swap then QR flow then headless relaunch ends with currentSegment=feishu', async () => {
    // Speed up the QR poll so the test doesn't wait 2s between checks.
    const originalPoll = _qrInternals.POLL_INTERVAL_MS;
    (_qrInternals as { POLL_INTERVAL_MS: number }).POLL_INTERVAL_MS = 1;
    try {
      const initial = new FakeBrowser();
      const browserRef: BrowserRef = {
        current: initial as unknown as never,
        currentSegment: 'generic',
      };
      const { factory, spawned } = makeFactory();
      const { sink, envelopes } = makeSink();

      // Detector returns false on the Phase 0 / Phase 1 probe (cookie
      // missing), false again on the first QR poll, then true on the
      // second poll (simulating "user just scanned").
      let calls = 0;
      const skill = makeSkill({
        segment: 'feishu',
        detector: () => {
          calls += 1;
          return calls >= 3; // probe (1), poll-1 (2), poll-2 (3) → true
        },
      });

      const outcome = await ensureLoggedIn({
        taskID: 't-case-c',
        skill,
        browserRef,
        sink,
        logger: silentLogger,
        browserFactory: factory,
      });

      expect(outcome).toEqual({ ok: true });
      // 3 spawn cycles total: Phase 0 headless, Phase 2 visible, Phase 3 headless.
      expect(spawned.length).toBe(3);
      expect(spawned[0]?.launches[0]?.headless).toBe(true);
      expect(spawned[0]?.launches[0]?.userDataDir).toMatch(/profiles\/feishu$/);
      expect(spawned[1]?.launches[0]?.headless).toBe(false);
      expect(spawned[1]?.launches[0]?.userDataDir).toMatch(/profiles\/feishu$/);
      expect(spawned[2]?.launches[0]?.headless).toBe(true);
      expect(spawned[2]?.launches[0]?.userDataDir).toMatch(/profiles\/feishu$/);
      // ref ends pointing at the final headless browser, segment=feishu.
      expect(browserRef.current).toBe(spawned[2] as unknown as never);
      expect(browserRef.currentSegment).toBe('feishu');
      // Visible phase emitted exactly one webAgentApprovalRequested(login_qr).
      const approvals = envelopes.filter(
        (e) => e.type === 'event' && e.event.type === 'webAgentApprovalRequested',
      );
      expect(approvals.length).toBe(1);
    } finally {
      (_qrInternals as { POLL_INTERVAL_MS: number }).POLL_INTERVAL_MS = originalPoll;
    }
  });

  it('case D: skill.loginURL empty → skip precheck entirely, no Phase 0 swap', async () => {
    const initial = new FakeBrowser();
    const browserRef: BrowserRef = {
      current: initial as unknown as never,
      currentSegment: 'generic',
    };
    const { factory, spawned } = makeFactory();
    const { sink } = makeSink();
    const skill = makeSkill({ segment: 'feishu', loginURL: '', detector: () => true });

    const outcome = await ensureLoggedIn({
      taskID: 't-case-d',
      skill,
      browserRef,
      sink,
      logger: silentLogger,
      browserFactory: factory,
    });

    expect(outcome).toEqual({ ok: true });
    expect(initial.closed).toBe(false);
    expect(spawned.length).toBe(0);
    expect(browserRef.current).toBe(initial as unknown as never);
    // currentSegment must NOT be silently changed when loginURL is empty;
    // the contract is that no segment switch happens for skills without
    // login state requirements.
    expect(browserRef.currentSegment).toBe('generic');
  });
});
