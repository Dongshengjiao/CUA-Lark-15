// M9 task 4.x: Feishu IM bot bridge — main loop.
//
// What this process does:
//   1. Spawn `lark-cli event +subscribe --as bot --event-types
//      im.message.receive_v1` as a child process so we get a long-lived
//      WebSocket subscription to the challenge-account Feishu app's
//      message events. lark-cli writes one JSON object per line to
//      stdout (NDJSON).
//   2. Connect to the LarkIslandApp BridgeServer Unix socket as an
//      `observer` role client. This is the same surface observer-client.ts
//      uses; we are essentially a programmatic observer that turns
//      Feishu messages into runWebAgentTask commands.
//   3. For each new IM private text message:
//      - check the allowlist (if LARK_BOT_ALLOWLIST set);
//      - if a task is in flight, reply "the previous task is still
//        running, please wait"; otherwise generate a taskID and
//        dispatch runWebAgentTask via the bridge.
//   4. For each runner event arriving from the bridge:
//      - on Started / StepUpdate: log only (don't spam the user);
//      - on ApprovalRequested(login_qr): reply with a "please scan QR
//        on the Mac" message;
//      - on Completed: reply with the finalAnswer (truncated);
//      - on Failed: reply with the failure kind + message.
//
// The wire protocol (v2 hello + envelope-per-line) is reused from M3.
// We keep our own minimal type aliases instead of importing from
// runners/web-agent — the protocol surface we touch is tiny (~5 message
// types) and cross-package coupling without a workspace setup is more
// painful than copying ~30 lines of typedefs.

import { spawn, type ChildProcess } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isAllowed } from './allowlist.js';
import {
  chunkNdjsonBuffer,
  parseImMessageReceiveV1,
  type IncomingTextMessage,
} from './lark-event.js';
import { replyText } from './reply.js';

// ---------------------------------------------------------------------------
// Bridge envelope types — minimal subset of what we send/receive.
// ---------------------------------------------------------------------------

interface BridgeHello {
  type: 'hello';
  hello: { protocolVersion: number; serverLabel: string };
}

interface BridgeCommand {
  type: 'command';
  command:
    | { type: 'registerClient'; role: 'observer' }
    | {
        type: 'runWebAgentTask';
        taskID: string;
        prompt: string;
        skill: string | null;
        profileName: string;
      };
}

interface BridgeEvent {
  type: 'event';
  event:
    | {
        type: 'webAgentTaskStarted';
        payload: { taskID: string; prompt: string; skill: string | null };
      }
    | {
        type: 'webAgentStepUpdate';
        payload: {
          taskID: string;
          stepIndex: number;
          thought?: string;
          actionType?: string;
        };
      }
    | {
        type: 'webAgentApprovalRequested';
        payload: { taskID: string; kind: string; message: string };
      }
    | {
        type: 'webAgentTaskCompleted';
        payload: {
          taskID: string;
          finalAnswer: string;
          totalSteps: number;
          totalMs: number;
        };
      }
    | {
        type: 'webAgentTaskFailed';
        payload: { taskID: string; kind: string; message: string };
      };
}

type BridgeEnvelope = BridgeHello | BridgeCommand | BridgeEvent;

function encodeEnvelope(env: BridgeEnvelope): string {
  return JSON.stringify(env) + '\n';
}

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------

interface BotConfig {
  larkProfile: string;
  allowlistEnv: string | undefined;
  socketPath: string;
  llmProfile: string;
}

function readConfig(env: NodeJS.ProcessEnv): BotConfig | { error: string } {
  const larkProfile = env.LARK_BOT_PROFILE;
  if (!larkProfile) {
    return { error: 'LARK_BOT_PROFILE not set; refusing to start' };
  }
  const socketPath =
    env.LARK_ISLAND_SOCKET_PATH ??
    join(homedir(), 'Library', 'Application Support', 'LarkIsland', 'bridge.sock');
  return {
    larkProfile,
    allowlistEnv: env.LARK_BOT_ALLOWLIST,
    socketPath,
    llmProfile: env.LARK_BOT_LLM_PROFILE ?? 'qwen-default',
  };
}

// ---------------------------------------------------------------------------
// In-flight task state (single-task-serial, mirrors runner's own constraint)
// ---------------------------------------------------------------------------

interface InFlightTask {
  taskID: string;
  chatID: string;
  senderOpenID: string;
  prompt: string;
  startedAt: number;
  // M10 task 2.1: heartbeat throttle state
  totalSteps: number;
  lastHeartbeatStep: number;
  lastHeartbeatAt: number;
}

let inFlight: InFlightTask | null = null;

// ---------------------------------------------------------------------------
// M10 task 2: heartbeat throttle (pure helpers — exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Step-based + time-based throttle for the bot's progress reply
 * ("⏳ 已执行 X 步：…"). We emit one heartbeat ONLY when both
 * conditions are satisfied:
 *   - at least 5 webAgentStepUpdate events since the last heartbeat
 *   - at least 15 seconds since the last heartbeat (or last heartbeat
 *     never happened, signalled by lastHeartbeatAt === 0)
 *
 * The dual gate prevents two failure modes:
 *   - rapid step bursts (5 step / 5s) flooding the chat
 *   - long-wait single-step tasks (rare) sending no heartbeat
 *
 * lastHeartbeatAt === 0 represents "never sent a heartbeat for this
 * inFlight"; we still require the 5-step gate so the very first
 * 0-4 steps stay silent — same as the m9 ack/terminal two-message
 * cadence for short tasks.
 */
export const HEARTBEAT_MIN_STEP_GAP = 5;
export const HEARTBEAT_MIN_MS_GAP = 15_000;
export const HEARTBEAT_THOUGHT_MAXLEN = 60;

export interface HeartbeatState {
  totalSteps: number;
  lastHeartbeatStep: number;
  lastHeartbeatAt: number;
}

export function decideHeartbeatTrigger(state: HeartbeatState, now: number): boolean {
  const stepsSinceLast = state.totalSteps - state.lastHeartbeatStep;
  const msSinceLast = state.lastHeartbeatAt === 0 ? Infinity : now - state.lastHeartbeatAt;
  return stepsSinceLast >= HEARTBEAT_MIN_STEP_GAP && msSinceLast >= HEARTBEAT_MIN_MS_GAP;
}

/**
 * Truncate by Unicode code points (so half emojis don't get sliced)
 * to HEARTBEAT_THOUGHT_MAXLEN; append "..." marker if truncated.
 */
export function truncateThought(thought: string | undefined, maxLen = HEARTBEAT_THOUGHT_MAXLEN): string {
  if (!thought) return '';
  const cps = [...thought];
  if (cps.length <= maxLen) return thought;
  return cps.slice(0, maxLen).join('') + '...';
}

export function formatHeartbeatText(totalSteps: number, thought: string | undefined): string {
  const trunc = truncateThought(thought);
  if (!trunc) return `⏳ 已执行 ${totalSteps} 步…`;
  return `⏳ 已执行 ${totalSteps} 步：${trunc}`;
}

// ---------------------------------------------------------------------------
// Logger — one-liner, plain stderr
// ---------------------------------------------------------------------------

function log(level: 'info' | 'warn' | 'error', msg: string): void {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.error(`[${ts}] [${level}] ${msg}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cfg = readConfig(process.env);
  if ('error' in cfg) {
    // eslint-disable-next-line no-console
    console.error(cfg.error);
    process.exit(1);
  }

  log('info', `starting bot bridge (profile=${cfg.larkProfile}, socket=${cfg.socketPath})`);

  // 1) Spawn lark-cli event subscriber.
  const sub = spawn(
    'lark-cli',
    [
      '--profile',
      cfg.larkProfile,
      'event',
      '+subscribe',
      '--as',
      'bot',
      '--event-types',
      'im.message.receive_v1',
      '--quiet',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  log('info', `lark-cli event +subscribe spawned (pid=${sub.pid ?? '?'})`);

  // 2) Connect bridge socket.
  const sock = await connectBridge(cfg.socketPath);

  // 3) Register handlers.
  installSubHandlers(sub, sock, cfg);
  installSockHandlers(sock, cfg, sub);

  // 4) Lifetime: kill children on signal, log on unexpected exit.
  process.on('SIGINT', () => shutdown(sub, sock, 130));
  process.on('SIGTERM', () => shutdown(sub, sock, 143));
}

function connectBridge(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath, () => {
      log('info', 'bridge socket connected, awaiting hello...');
    });
    sock.once('error', (err) => {
      reject(new Error(`bridge connect failed: ${err.message}`));
    });
    sock.once('connect', () => resolve(sock));
  });
}

function installSubHandlers(sub: ChildProcess, sock: Socket, cfg: BotConfig): void {
  let buf = '';
  sub.stdout?.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    const split = chunkNdjsonBuffer(buf);
    buf = split.rest;
    for (const line of split.lines) {
      handleNdjsonLine(line, sock, cfg);
    }
  });
  sub.stderr?.on('data', (chunk: Buffer) => {
    log('warn', `lark-cli stderr: ${chunk.toString('utf8').trim()}`);
  });
  sub.on('exit', (code, signal) => {
    log('error', `lark-cli event +subscribe exited (code=${code}, signal=${signal}); shutting down`);
    process.exit(1);
  });
}

function installSockHandlers(sock: Socket, _cfg: BotConfig, sub: ChildProcess): void {
  let helloSeen = false;
  let buf = '';
  sock.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
      if (!line) continue;
      let env: BridgeEnvelope;
      try {
        env = JSON.parse(line) as BridgeEnvelope;
      } catch {
        log('warn', `bridge: invalid JSON line: ${line.slice(0, 200)}`);
        continue;
      }
      if (!helloSeen && env.type === 'hello') {
        helloSeen = true;
        const ver = env.hello.protocolVersion;
        if (ver !== 2) {
          log('error', `bridge protocol version mismatch (got ${ver}, want 2); exit`);
          process.exit(1);
        }
        log('info', `bridge hello v2 from ${env.hello.serverLabel}; registering as observer`);
        sock.write(
          encodeEnvelope({
            type: 'command',
            command: { type: 'registerClient', role: 'observer' },
          }),
        );
        continue;
      }
      if (env.type === 'event') {
        // M9 fix: Wire schema for AgentEvent on the BridgeServer side
        // nests the payload under a key MATCHING the event's `type`
        // (e.g. `{type: "webAgentTaskCompleted", webAgentTaskCompleted: {taskID:...}}`),
        // not under a generic `payload` key. The TS BridgeCodec
        // (runners/web-agent/src/bridge/codec.ts) renames this to
        // `payload` for observer-client.ts callers. Bot bridge uses
        // raw JSON.parse, so we do the rename here.
        const evRaw = env.event as unknown as Record<string, unknown>;
        const wireType = evRaw.type;
        if (typeof wireType === 'string' && evRaw[wireType] && !('payload' in evRaw)) {
          evRaw.payload = evRaw[wireType];
        }
        const ev = env.event;
        const taskID =
          'payload' in ev && typeof (ev.payload as { taskID?: unknown }).taskID === 'string'
            ? ((ev.payload as { taskID: string }).taskID)
            : '<no-taskID>';
        log('info', `bridge event: type=${ev.type} taskID=${taskID}`);
        handleBridgeEvent(env, _cfg);
      } else if (env.type === 'command') {
        // BridgeServer never sends commands TO observers, so this is
        // unexpected — log it.
        log('warn', `bridge: unexpected command envelope on observer socket`);
      }
    }
  });
  sock.on('error', (err) => {
    log('error', `bridge socket error: ${err.message}`);
  });
  sock.on('close', () => {
    log('error', 'bridge socket closed; shutting down');
    sub.kill('SIGTERM');
    process.exit(1);
  });
}

function handleNdjsonLine(line: string, sock: Socket, cfg: BotConfig): void {
  const msg = parseImMessageReceiveV1(line);
  if (!msg) {
    return; // event type mismatch / non-text / malformed — silent drop
  }
  log(
    'info',
    `incoming message from ${msg.senderOpenID} chat=${msg.chatID} text=${JSON.stringify(msg.text.slice(0, 60))}`,
  );
  if (!isAllowed(msg.senderOpenID, cfg.allowlistEnv)) {
    log('warn', `sender ${msg.senderOpenID} not in allowlist; dropped`);
    return;
  }
  if (inFlight !== null) {
    const stale = inFlight;
    void replyText({
      profile: cfg.larkProfile,
      chatID: msg.chatID,
      text: `上一条任务（${stale.prompt.slice(0, 30)}…）还在跑（已 ${Math.round(
        (Date.now() - stale.startedAt) / 1000,
      )} 秒），请稍候再发新指令。`,
      nonce: `busy-${msg.messageID}`,
    }).then((r) => {
      if (!r.ok) log('warn', `busy-reply failed: ${r.error}`);
    });
    return;
  }
  dispatch(msg, sock, cfg);
}

function dispatch(msg: IncomingTextMessage, sock: Socket, cfg: BotConfig): void {
  const taskID = `feishu-bot-${msg.messageID}`;
  inFlight = {
    taskID,
    chatID: msg.chatID,
    senderOpenID: msg.senderOpenID,
    prompt: msg.text,
    startedAt: Date.now(),
    totalSteps: 0,
    lastHeartbeatStep: 0,
    lastHeartbeatAt: 0,
  };
  void replyText({
    profile: cfg.larkProfile,
    chatID: msg.chatID,
    text: `已收到：${msg.text}\n正在执行…`,
    nonce: `ack-${msg.messageID}`,
  }).then((r) => {
    if (!r.ok) log('warn', `ack-reply failed: ${r.error}`);
  });
  sock.write(
    encodeEnvelope({
      type: 'command',
      command: {
        type: 'runWebAgentTask',
        taskID,
        prompt: msg.text,
        skill: null,
        profileName: cfg.llmProfile,
      },
    }),
  );
  log('info', `dispatched runWebAgentTask{taskID=${taskID}}`);
}

function handleBridgeEvent(env: Extract<BridgeEnvelope, { type: 'event' }>, cfg: BotConfig): void {
  const ev = env.event;
  if (!inFlight) {
    log('warn', `bridge event ${ev.type} dropped: no inFlight task tracked`);
    return;
  }
  const evTaskID =
    'payload' in ev && typeof (ev.payload as { taskID?: unknown }).taskID === 'string'
      ? ((ev.payload as { taskID: string }).taskID)
      : '';
  if (!evTaskID || evTaskID !== inFlight.taskID) {
    log(
      'info',
      `bridge event ${ev.type} skipped: taskID=${evTaskID || '<missing>'} != inFlight.taskID=${inFlight.taskID}`,
    );
    return;
  }
  switch (ev.type) {
    case 'webAgentTaskStarted':
      return;
    case 'webAgentStepUpdate': {
      // M10: throttled progress heartbeat. Decision gate is pure
      // (decideHeartbeatTrigger), the side-effect is one lark-cli
      // im+messages-send call. inFlight is non-null here (guarded
      // above).
      inFlight.totalSteps += 1;
      const now = Date.now();
      if (!decideHeartbeatTrigger(inFlight, now)) {
        return;
      }
      const text = formatHeartbeatText(inFlight.totalSteps, ev.payload.thought);
      const stepIndex = ev.payload.stepIndex;
      const captured = inFlight; // keep ref in case inFlight changes mid-await
      log('info', `heartbeat step=${captured.totalSteps} stepIndex=${stepIndex}`);
      void replyText({
        profile: cfg.larkProfile,
        chatID: captured.chatID,
        text,
        nonce: `heartbeat-${captured.taskID}-${stepIndex}`,
      }).then((r) => {
        if (!r.ok) log('warn', `heartbeat-reply failed: ${r.error}`);
      });
      inFlight.lastHeartbeatStep = inFlight.totalSteps;
      inFlight.lastHeartbeatAt = now;
      return;
    }
    case 'webAgentApprovalRequested': {
      const text = ev.payload.message
        ? `${ev.payload.message}（请前往 Mac 桌面上的灵动岛 / 浏览器扫码）`
        : `任务等待登录授权（${ev.payload.kind}），请前往 Mac 桌面扫码。`;
      void replyText({
        profile: cfg.larkProfile,
        chatID: inFlight.chatID,
        text,
        nonce: `approval-${inFlight.taskID}`,
      }).then((r) => {
        if (!r.ok) log('warn', `approval-reply failed: ${r.error}`);
      });
      return;
    }
    case 'webAgentTaskCompleted': {
      const ms = ev.payload.totalMs;
      const steps = ev.payload.totalSteps;
      const finalAnswer = ev.payload.finalAnswer || '(任务完成，但未生成最终回复)';
      const summary =
        finalAnswer.length > 200
          ? `✅ 任务完成（${steps} 步 / ${(ms / 1000).toFixed(1)}s）\n\n${finalAnswer}`
          : `✅ 任务完成（${steps} 步 / ${(ms / 1000).toFixed(1)}s）：${finalAnswer}`;
      log('info', `task ${inFlight.taskID} completed; sending finalAnswer reply`);
      void replyText({
        profile: cfg.larkProfile,
        chatID: inFlight.chatID,
        text: summary,
        nonce: `completed-${inFlight.taskID}`,
      }).then((r) => {
        if (!r.ok) log('warn', `completed-reply failed: ${r.error}`);
      });
      inFlight = null;
      return;
    }
    case 'webAgentTaskFailed': {
      const text = `❌ 任务失败（${ev.payload.kind}）：${ev.payload.message}`;
      log('info', `task ${inFlight.taskID} failed (${ev.payload.kind}); sending fail reply`);
      void replyText({
        profile: cfg.larkProfile,
        chatID: inFlight.chatID,
        text,
        nonce: `failed-${inFlight.taskID}`,
      }).then((r) => {
        if (!r.ok) log('warn', `failed-reply failed: ${r.error}`);
      });
      inFlight = null;
      return;
    }
  }
}

function shutdown(sub: ChildProcess, sock: Socket, code: number): void {
  log('info', `shutting down (code=${code})`);
  try {
    sub.kill('SIGTERM');
  } catch {
    // ignore
  }
  try {
    sock.end();
  } catch {
    // ignore
  }
  setTimeout(() => process.exit(code), 200);
}

// Only run main() when this module is invoked as the process entry point.
// Importing it for unit tests (e.g. test/heartbeat.test.ts pulling in
// the heartbeat helpers) must NOT trigger the spawn / connect / exit
// side effects.
const isEntry =
  process.argv[1] !== undefined &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(process.argv[1]));

if (isEntry) {
  main().catch((err: unknown) => {
    log('error', `fatal: ${(err as Error).stack ?? String(err)}`);
    process.exit(1);
  });
}
