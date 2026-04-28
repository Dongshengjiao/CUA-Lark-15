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
  let browser: LocalBrowser;
  try {
    logger.info('launching headless Chromium...');
    browser = new LocalBrowser({ logger });
    await browser.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    logger.info('Chromium ready');
  } catch (err) {
    logger.error(`Chromium launch failed: ${err}`);
    client.close();
    process.exit(1);
  }

  // 3) Build runtime over (sink=client, browser=Chromium).
  const runtime = new AgentRuntime({
    sink: client,
    browser,
    logger,
    maxLoopCount: 12,
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
      await browser.close();
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

    currentTaskID = taskID;
    logger.info(`starting task ${taskID} with profile ${profileResult.profile.name}`);

    runtime
      .runTask({ taskID, prompt, skill: skill ?? null }, profileResult.profile as ResolvedProfile)
      .catch((err) => {
        logger.error(`task ${taskID} threw: ${err}`);
      })
      .finally(() => {
        logger.info(`task ${taskID} finished`);
        onTaskFinished();
      });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[runner fatal]', err);
  process.exit(1);
});
