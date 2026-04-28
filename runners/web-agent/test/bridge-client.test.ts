// M3 task 1.4: BridgeClient end-to-end tests against a real Unix socket.
// We stand up a tiny in-process net.createServer that speaks the
// BridgeServer wire format (newline-delimited JSON envelopes) just
// well enough to drive the handshake and round-trip a few messages.

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BridgeClient,
  BridgeProtocolMismatchError,
  encodeEnvelope,
  decodeEnvelope,
  type BridgeEnvelope,
} from '../src/bridge/index.js';

interface ServerHandle {
  server: Server;
  socketPath: string;
  cleanup: () => void;
  /** Capture every envelope that arrives from the client. */
  inbox: BridgeEnvelope[];
  /** The currently-connected client socket, set after first connect. */
  current: () => Socket | null;
}

/**
 * Spin up a minimal BridgeServer-style endpoint:
 *   - accepts one client connection
 *   - immediately writes the `helloEnvelope` to the wire
 *   - records every newline-delimited envelope it receives
 */
function startMockServer(helloEnvelope: BridgeEnvelope): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'lark-island-bridge-test-'));
    const socketPath = join(dir, 'bridge.sock');
    const inbox: BridgeEnvelope[] = [];
    let activeSocket: Socket | null = null;

    const server = createServer((socket) => {
      activeSocket = socket;
      // Send the hello envelope right away.
      socket.write(encodeEnvelope(helloEnvelope));

      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (true) {
          const idx = buf.indexOf(0x0a);
          if (idx < 0) break;
          const line = buf.subarray(0, idx).toString('utf8');
          buf = buf.subarray(idx + 1);
          if (line.length === 0) continue;
          try {
            inbox.push(decodeEnvelope(line));
          } catch {
            // ignore malformed
          }
        }
      });
    });

    server.on('error', reject);
    server.listen(socketPath, () => {
      resolve({
        server,
        socketPath,
        inbox,
        current: () => activeSocket,
        cleanup: () => {
          if (activeSocket && !activeSocket.destroyed) activeSocket.destroy();
          server.close();
          rmSync(dir, { recursive: true, force: true });
        },
      });
    });
  });
}

describe('M3 BridgeClient — handshake', () => {
  let handle: ServerHandle | null = null;

  afterEach(() => {
    handle?.cleanup();
    handle = null;
  });

  it('completes the v2 handshake against a real Unix socket', async () => {
    handle = await startMockServer({
      type: 'hello',
      hello: { protocolVersion: 2, serverLabel: 'mock-bridge' },
    });

    const client = await BridgeClient.connect(handle.socketPath, { timeoutMs: 2_000 });
    client.send({
      type: 'command',
      command: { type: 'registerClient', role: 'webAgentRunner' },
    });

    // Wait briefly for the server side to absorb the registerClient frame.
    await new Promise((r) => setTimeout(r, 50));

    expect(handle.inbox).toHaveLength(1);
    expect(handle.inbox[0]).toEqual({
      type: 'command',
      command: { type: 'registerClient', role: 'webAgentRunner' },
    });

    client.close();
  });

  it('rejects with BridgeProtocolMismatchError when peer is v1', async () => {
    handle = await startMockServer({
      type: 'hello',
      hello: { protocolVersion: 1, serverLabel: 'legacy-open-island' },
    });

    await expect(
      BridgeClient.connect(handle.socketPath, { timeoutMs: 2_000 }),
    ).rejects.toBeInstanceOf(BridgeProtocolMismatchError);
  });

  it('rejects when the socket file does not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lark-island-bridge-test-'));
    const socketPath = join(dir, 'nonexistent.sock');
    await expect(BridgeClient.connect(socketPath, { timeoutMs: 1_000 })).rejects.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('M3 BridgeClient — message routing', () => {
  let handle: ServerHandle | null = null;

  afterEach(() => {
    handle?.cleanup();
    handle = null;
  });

  it('delivers post-handshake envelopes to onEnvelope', async () => {
    handle = await startMockServer({
      type: 'hello',
      hello: { protocolVersion: 2, serverLabel: 'mock-bridge' },
    });
    const client = await BridgeClient.connect(handle.socketPath, { timeoutMs: 2_000 });

    const received: BridgeEnvelope[] = [];
    client.onEnvelope((env) => received.push(env));

    // Server-side push: simulate a runWebAgentTask command.
    const taskEnvelope: BridgeEnvelope = {
      type: 'command',
      command: {
        type: 'runWebAgentTask',
        taskID: 't1',
        prompt: 'hello',
        skill: null,
        profileName: 'qwen-default',
      },
    };
    handle.current()!.write(encodeEnvelope(taskEnvelope));

    await new Promise((r) => setTimeout(r, 50));
    expect(received).toEqual([taskEnvelope]);

    client.close();
  });

  it('fires onClose when the server tears down the socket', async () => {
    handle = await startMockServer({
      type: 'hello',
      hello: { protocolVersion: 2, serverLabel: 'mock-bridge' },
    });
    const client = await BridgeClient.connect(handle.socketPath, { timeoutMs: 2_000 });

    const closeEvents: Array<{ reason: 'eof' | 'error'; err?: Error }> = [];
    client.onClose((reason, err) => closeEvents.push({ reason, err }));

    handle.current()!.destroy();

    await new Promise((r) => setTimeout(r, 80));
    expect(closeEvents.length).toBeGreaterThanOrEqual(1);
    expect(closeEvents[0]!.reason).toBeDefined();
  });

  it('drops malformed JSON frames silently and keeps draining', async () => {
    handle = await startMockServer({
      type: 'hello',
      hello: { protocolVersion: 2, serverLabel: 'mock-bridge' },
    });
    const client = await BridgeClient.connect(handle.socketPath, { timeoutMs: 2_000 });

    const received: BridgeEnvelope[] = [];
    client.onEnvelope((env) => received.push(env));

    const sock = handle.current()!;
    sock.write('{not valid json\n');
    const valid: BridgeEnvelope = {
      type: 'event',
      event: {
        type: 'webAgentTaskCompleted',
        payload: {
          taskID: 't1',
          finalAnswer: 'done',
          totalSteps: 1,
          totalTokens: 100,
          totalMs: 1000,
          timestamp: new Date(0),
        },
      },
    };
    sock.write(encodeEnvelope(valid));

    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(valid);

    client.close();
  });
});
