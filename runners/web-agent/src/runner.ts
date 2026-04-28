// M3 web-agent runner main entry.
//
// Lifecycle:
//   1. Parse env, build a logger.
//   2. Dial bridge.sock with v2 handshake (BridgeClient.connect).
//   3. Send registerClient(.webAgentRunner).
//   4. Launch headless Chromium (single LocalBrowser for the whole
//      runner lifetime — see m3 design.md §D1).
//   5. Loop on onEnvelope: handle `runWebAgentTask`, ignore everything
//      else. Single task at a time per §D4.
//   6. On socket close: cancel in-flight task, close browser, exit 1.

import 'dotenv/config';
import { LocalBrowser } from '@agent-infra/browser';
import { ConsoleLogger } from '@agent-infra/logger';
import { BridgeClient, BridgeProtocolMismatchError, defaultSocketPath } from './bridge/client.js';
import type { BridgeEnvelope, BridgeCommand } from './bridge/types.js';
import { resolveProfile, type ResolvedProfile } from './profiles/index.js';
import { AgentRuntime } from './agent/runtime.js';
import { userDataDirFor } from './agent/profiles_dir.js';
import { registry, selectSkill } from './skills/registry.js';

// M6 task 2.x: navigate to a populated default page on startup so the
// VLM never sees about:blank when running a generic task. M5 task 7.5
// regression showed that on a blank screen the VLM's first move is
// "Cmd+Space → Spotlight" because it doesn't realise it's inside a
// browser. Putting *something* on screen — a search bar, in this case —
// gives it a workable starting context.
//
// For mainland-China demos where google.com is slow/unreliable, change
// this constant to `https://www.bing.com` (or set the LARK_ISLAND_RUNNER_DEFAULT_URL
// env var, honored below).
const DEFAULT_STARTING_URL =
  process.env.LARK_ISLAND_RUNNER_DEFAULT_URL ?? 'https://www.google.com';

async function main() {
  const logger = new ConsoleLogger('[lark-island/runner]');
  const socketPath = defaultSocketPath();

  // 1) Connect socket FIRST — fail fast before paying Chromium cost.
  let client: BridgeClient;
  try {
    logger.info(`connecting to ${socketPath}...`);
    client = await BridgeClient.connect(socketPath, { timeoutMs: 5_000 });
    logger.info('handshake v2 ok');
  } catch (err) {
    if (err instanceof BridgeProtocolMismatchError) {
      logger.error(
        `peer advertised protocolVersion=${err.receivedVersion}, refusing to send web-agent envelopes`,
      );
    } else {
      logger.error(`bridge connect failed: ${err}`);
    }
    process.exit(1);
  }

  // 2) Launch Chromium ONCE before exposing ourselves to the dispatcher.
  // Order matters: if we registered first, the peer would immediately
  // start sending runWebAgentTask commands while Chromium was still
  // launching — the runner.runTask path needs a live LocalBrowser.
  //
  // Default user-data-dir is the "generic" segment; M5 skill resolution
  // may swap to a skill-specific browser via runtime.browserRef.
  let browserRef: { current: LocalBrowser };
  try {
    logger.info('launching headless Chromium...');
    const browser = new LocalBrowser({ logger });
    await browser.launch({
      headless: true,
      userDataDir: userDataDirFor('generic'),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    browserRef = { current: browser };
    logger.info('Chromium ready');
  } catch (err) {
    logger.error(`Chromium launch failed: ${err}`);
    client.close();
    process.exit(1);
  }

  // M6 task 2.1-2.3: pre-warm the page with a default URL so the VLM
  // doesn't land on about:blank when generic tasks come in. Failure
  // here (network down, DNS broken, captive portal) does NOT abort the
  // runner — we keep going so skill-driven tasks (which navigate to
  // their own startingURL) still work.
  try {
    const page = await browserRef.current.createPage();
    await page.goto(DEFAULT_STARTING_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });
    logger.info(`navigated to default starting URL: ${DEFAULT_STARTING_URL}`);
  } catch (err) {
    logger.warn(
      `default starting URL navigation failed (${DEFAULT_STARTING_URL}): ${err}; continuing on about:blank`,
    );
  }

  // 3) Build runtime over (sink=client, browserRef=swappable Chromium).
  // M6 task 1.1: maxLoopCount lifted from 12 → 30 after M5 task 7.3
  // smoke test showed feishu IM tasks needed ~25 steps just to land
  // on the right contact, leaving zero budget for type+send+verify.
  // 30 gives the agent a real completion budget; if a task still
  // hits the cap it's almost certainly the VLM looping rather than
  // running out of legitimate steps (in which case the prompt addendum
  // — see m6 task 1.2-1.4 — is what needs sharpening, not the cap).
  const runtime = new AgentRuntime({
    sink: client,
    browserRef,
    logger,
    maxLoopCount: 30,
    vlmTimeoutMs: 180_000,
  });

  // 4) Single-task-serial guard.
  let currentTaskID: string | null = null;
  const onTaskFinished = () => {
    currentTaskID = null;
  };

  // 5) Register envelope handler BEFORE announcing ourselves. Otherwise
  // the dispatcher can race past registerClient and emit
  // runWebAgentTask before BridgeClient knows where to deliver it
  // (envelopeHandler? would be null and the frame silently dropped
  // by the post-handshake reader).
  client.onEnvelope((env) => {
    if (env.type !== 'command') return;
    handleCommand(env.command);
  });

  client.onClose(async (reason, err) => {
    logger.warn(`bridge socket closed (${reason}${err ? `: ${err.message}` : ''}); shutting down`);
    try {
      await browserRef.current.close();
    } catch {
      // ignore
    }
    process.exit(1);
  });

  // 6) Now safe to advertise ourselves — handler armed, browser ready.
  client.send({
    type: 'command',
    command: { type: 'registerClient', role: 'webAgentRunner' },
  });
  logger.info('registered as webAgentRunner; ready for tasks');

  function handleCommand(command: BridgeCommand): void {
    if (command.type !== 'runWebAgentTask') {
      // Other commands (registerClient ack, requestQuestion, etc.) are
      // not addressed to the runner. Best-effort drop.
      return;
    }
    const { taskID, prompt, skill, profileName } = command;

    if (currentTaskID != null) {
      logger.warn(`runner busy with ${currentTaskID}, rejecting ${taskID}`);
      client.send({
        type: 'event',
        event: {
          type: 'webAgentTaskFailed',
          payload: {
            taskID,
            kind: 'pageError',
            message: `runner busy with ${currentTaskID}`,
            timestamp: new Date(),
          },
        },
      });
      return;
    }

    const profileResult = resolveProfile(profileName ?? null);
    if (!profileResult.ok) {
      logger.error(`profile resolution failed for task ${taskID}: ${profileResult.message}`);
      client.send({
        type: 'event',
        event: {
          type: 'webAgentTaskFailed',
          payload: {
            taskID,
            kind: profileResult.kind,
            message: profileResult.message,
            timestamp: new Date(),
          },
        },
      });
      return;
    }

    // M5 task 4.1: route the prompt through the skill registry first.
    // Generic mode (skill === null) keeps the M3 behavior verbatim.
    const resolvedSkill = selectSkill(prompt, registry);
    logger.info(
      `dispatching ${taskID} via skill=${resolvedSkill?.id ?? 'generic'}`,
    );

    currentTaskID = taskID;
    logger.info(`starting task ${taskID} with profile ${profileResult.profile.name}`);

    runtime
      .runTask(
        { taskID, prompt, skill: resolvedSkill },
        profileResult.profile as ResolvedProfile,
      )
      .catch((err) => {
        logger.error(`task ${taskID} threw: ${err}`);
      })
      .finally(() => {
        logger.info(`task ${taskID} finished`);
        onTaskFinished();
      });

    // M5: command.skill (the original cmd-passed string id) is no longer
    // honoured here — the router is the source of truth. We still
    // accept the field on the wire for future use.
    void skill;
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[runner fatal]', err);
  process.exit(1);
});
