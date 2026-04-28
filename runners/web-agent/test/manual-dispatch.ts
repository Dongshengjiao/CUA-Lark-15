// M3 task 5.1: manual end-to-end dispatcher.
//
// Not part of the vitest suite — it's a development helper that
// stands up an in-process BridgeServer-shaped Unix socket and lets
// you fire a real runWebAgentTask command at a real `npm start`
// runner so you can watch the full started → step → completed
// envelope flow.
//
// Usage:
//   1. Terminal A: cd runners/web-agent && npx tsx test/manual-dispatch.ts <taskID> "<prompt>" [profileName]
//      The dispatcher prints `socket ready at <path>; export
//      LARK_ISLAND_SOCKET_PATH=<path> in the runner's env`.
//   2. Terminal B: LARK_ISLAND_SOCKET_PATH=<path> DASHSCOPE_API_KEY=sk-... npm start
//   3. Watch Terminal A — every envelope from the runner is pretty-printed.
//   4. Hit Ctrl+C in Terminal A to teardown the socket; runner sees EOF and exits.

import { createServer, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeEnvelope, encodeEnvelope } from '../src/bridge/codec.js';
import type { BridgeEnvelope } from '../src/bridge/types.js';

function usage(): never {
  // eslint-disable-next-line no-console
  console.error('Usage: npx tsx test/manual-dispatch.ts <taskID> "<prompt>" [profileName]');
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.length < 2) usage();
const [taskID, prompt, profileName] = argv;
if (!taskID || !prompt) usage();

const dir = mkdtempSync(join(tmpdir(), 'lark-island-manual-dispatch-'));
const socketPath = join(dir, 'bridge.sock');

const server = createServer((socket: Socket) => {
  // eslint-disable-next-line no-console
  console.log('[dispatcher] runner connected');

  // Send v2 hello immediately.
  socket.write(
    encodeEnvelope({ type: 'hello', hello: { protocolVersion: 2, serverLabel: 'manual-dispatch' } }),
  );

  let buf = Buffer.alloc(0);
  let dispatched = false;
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const idx = buf.indexOf(0x0a);
      if (idx < 0) break;
      const line = buf.subarray(0, idx).toString('utf8');
      buf = buf.subarray(idx + 1);
      if (line.length === 0) continue;
      try {
        const env = decodeEnvelope(line);
        printEnvelope(env);

        // After the runner registers, fire one task.
        if (
          !dispatched &&
          env.type === 'command' &&
          env.command.type === 'registerClient' &&
          env.command.role === 'webAgentRunner'
        ) {
          dispatched = true;
          const taskEnvelope: BridgeEnvelope = {
            type: 'command',
            command: {
              type: 'runWebAgentTask',
              taskID: taskID!,
              prompt: prompt!,
              skill: null,
              profileName: profileName ?? null,
            },
          };
          // eslint-disable-next-line no-console
          console.log('[dispatcher] dispatching task', JSON.stringify(taskEnvelope.command));
          socket.write(encodeEnvelope(taskEnvelope));
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[dispatcher] decode error:', err);
      }
    }
  });

  socket.on('close', () => {
    // eslint-disable-next-line no-console
    console.log('[dispatcher] runner disconnected');
  });
});

server.listen(socketPath, () => {
  // eslint-disable-next-line no-console
  console.log(`[dispatcher] socket ready at ${socketPath}`);
  // eslint-disable-next-line no-console
  console.log('[dispatcher] start the runner with:');
  // eslint-disable-next-line no-console
  console.log(
    `    LARK_ISLAND_SOCKET_PATH="${socketPath}" DASHSCOPE_API_KEY="\${DASHSCOPE_API_KEY:-...}" npm start`,
  );
});

process.on('SIGINT', () => {
  // eslint-disable-next-line no-console
  console.log('\n[dispatcher] tearing down');
  server.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
});

function printEnvelope(env: BridgeEnvelope): void {
  if (env.type === 'event') {
    const t = env.event.type;
    // Compact one-line summary, keeping screenshot path visible but
    // truncating long thoughts.
    const payload = JSON.parse(JSON.stringify(env.event.payload));
    if (typeof payload.thought === 'string' && payload.thought.length > 120) {
      payload.thought = payload.thought.slice(0, 117) + '...';
    }
    if (typeof payload.actionRaw === 'string' && payload.actionRaw.length > 120) {
      payload.actionRaw = payload.actionRaw.slice(0, 117) + '...';
    }
    // eslint-disable-next-line no-console
    console.log(`<- event.${t}`, payload);
  } else if (env.type === 'command') {
    // eslint-disable-next-line no-console
    console.log(`<- command.${env.command.type}`, env.command);
  } else {
    // eslint-disable-next-line no-console
    console.log(`<- ${env.type}`, env);
  }
}
