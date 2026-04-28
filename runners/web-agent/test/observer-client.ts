// M5 task 7.x verification helper.
//
// Connects to the running LarkIslandApp's BridgeServer as an `observer`
// client, fires a `runWebAgentTask` command, and pretty-prints every
// event envelope until the task settles (completed / failed) or the
// user hits Ctrl+C.
//
// This bypasses the menu-bar GUI so we can run end-to-end smoke tests
// from the terminal without driving NSPopover / NSStatusItem.
//
// Usage:
//   cd runners/web-agent
//   npx tsx test/observer-client.ts <taskID> "<prompt>"
//
// Requires LarkIslandApp to be running (it owns the BridgeServer on
// ~/Library/Application Support/LarkIsland/bridge.sock).

import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decodeEnvelope, encodeEnvelope } from '../src/bridge/codec.js';
import type { BridgeEnvelope } from '../src/bridge/types.js';

function usage(): never {
  // eslint-disable-next-line no-console
  console.error('Usage: npx tsx test/observer-client.ts <taskID> "<prompt>"');
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.length < 2) usage();
const [taskID, prompt] = argv;
if (!taskID || !prompt) usage();

const socketPath =
  process.env.LARK_ISLAND_SOCKET_PATH ??
  join(homedir(), 'Library', 'Application Support', 'LarkIsland', 'bridge.sock');

// eslint-disable-next-line no-console
console.log(`[observer] connecting to ${socketPath} ...`);
const socket = connect(socketPath, () => {
  // eslint-disable-next-line no-console
  console.log('[observer] connected; waiting for hello...');
});

let helloSeen = false;
let buf = Buffer.alloc(0);
let settled = false;

socket.on('data', (chunk: Buffer) => {
  buf = Buffer.concat([buf, chunk]);
  let nlIdx = buf.indexOf(0x0a);
  while (nlIdx !== -1) {
    const line = buf.subarray(0, nlIdx).toString('utf8').trim();
    buf = buf.subarray(nlIdx + 1);
    nlIdx = buf.indexOf(0x0a);
    if (!line) continue;
    let env: BridgeEnvelope;
    try {
      env = decodeEnvelope(line);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[observer] decode error: ${err}; raw=${line.slice(0, 200)}`);
      continue;
    }
    handleEnvelope(env);
  }
});

socket.on('end', () => {
  // eslint-disable-next-line no-console
  console.log('[observer] socket closed');
  process.exit(settled ? 0 : 1);
});

socket.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error(`[observer] socket error: ${err}`);
  process.exit(1);
});

function handleEnvelope(env: BridgeEnvelope) {
  // eslint-disable-next-line no-console
  console.log('[observer] <<', JSON.stringify(env));

  if (!helloSeen && env.type === 'hello') {
    helloSeen = true;
    socket.write(
      encodeEnvelope({
        type: 'command',
        command: { type: 'registerClient', role: 'observer' },
      }),
    );
    socket.write(
      encodeEnvelope({
        type: 'command',
        command: {
          type: 'runWebAgentTask',
          taskID,
          prompt,
          skill: null,
          profileName: 'qwen-default',
        },
      }),
    );
    // eslint-disable-next-line no-console
    console.log(`[observer] >> dispatched runWebAgentTask{taskID=${taskID}}`);
    return;
  }

  if (env.type === 'event') {
    const ev = env.event;
    if (ev.type === 'webAgentTaskCompleted' && ev.payload.taskID === taskID) {
      // eslint-disable-next-line no-console
      console.log(
        `[observer] task completed in ${ev.payload.totalSteps} step(s): ${ev.payload.finalAnswer}`,
      );
      settled = true;
      socket.end();
    }
    if (ev.type === 'webAgentTaskFailed' && ev.payload.taskID === taskID) {
      // eslint-disable-next-line no-console
      console.log(`[observer] task failed (${ev.payload.kind}): ${ev.payload.message}`);
      settled = true;
      socket.end();
    }
  }
}
