// M3 Bridge client. Wraps a Node Unix-domain `net.Socket` connection
// with the BridgeCodec on top, exposing an envelope-level API for the
// runner. Mirrors the LarkIslandCore-side BridgeServer's framing
// rules (newline-delimited JSON, BridgeCodec date encoding).

import { connect as netConnect, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decodeEnvelope, encodeEnvelope, BridgeCodecError } from './codec.js';
import type { BridgeEnvelope } from './types.js';

export class BridgeProtocolMismatchError extends Error {
  constructor(public readonly receivedVersion: number) {
    super(`peer advertised protocolVersion=${receivedVersion}, expected >= 2`);
    this.name = 'BridgeProtocolMismatchError';
  }
}

export class BridgeNotConnectedError extends Error {
  constructor() {
    super('BridgeClient is not connected');
    this.name = 'BridgeNotConnectedError';
  }
}

export type EnvelopeHandler = (env: BridgeEnvelope) => void;
export type CloseHandler = (reason: 'eof' | 'error', err?: Error) => void;

/**
 * Resolve the Bridge socket path the runner should connect to.
 * Honors `LARK_ISLAND_SOCKET_PATH` overrides, falling back to the
 * default location used by LarkIslandCore's BridgeSocketLocation.
 */
export function defaultSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.LARK_ISLAND_SOCKET_PATH;
  if (override && override.length > 0) return override;
  return join(homedir(), 'Library', 'Application Support', 'LarkIsland', 'bridge.sock');
}

/**
 * Newline-delimited envelope client over a Node Duplex stream.
 *
 * Most callers use `BridgeClient.connect(socketPath)` which dials a
 * Unix socket. Tests can construct one with `new BridgeClient(stream)`
 * directly, passing an in-memory Duplex pair to skip the FS.
 */
export class BridgeClient {
  private buffer: Buffer = Buffer.alloc(0);
  private envelopeHandler: EnvelopeHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private closed = false;

  constructor(private readonly stream: Socket) {
    stream.on('data', (chunk: Buffer) => {
      this.handleChunk(chunk);
    });
    stream.on('end', () => this.notifyClose('eof'));
    stream.on('close', () => this.notifyClose('eof'));
    stream.on('error', (err: Error) => this.notifyClose('error', err));
  }

  /**
   * Dial a Unix socket and complete the v2 hello handshake.
   * Resolves once we have a valid `BridgeHello{protocolVersion >= 2}`.
   * Rejects with `BridgeProtocolMismatchError` on v1 peers, or with
   * the underlying socket error if the dial fails.
   */
  static connect(socketPath: string, opts: { timeoutMs?: number } = {}): Promise<BridgeClient> {
    const timeoutMs = opts.timeoutMs ?? 5_000;
    return new Promise<BridgeClient>((resolve, reject) => {
      const socket = netConnect(socketPath);
      const timer = setTimeout(() => {
        socket.destroy(new Error(`bridge socket connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      socket.once('connect', () => {
        clearTimeout(timer);
        const client = new BridgeClient(socket);
        // Wait for the server's BridgeHello envelope.
        const helloTimer = setTimeout(() => {
          client.close();
          reject(new Error(`server did not send BridgeHello within ${timeoutMs}ms`));
        }, timeoutMs);

        client.envelopeHandler = (env) => {
          clearTimeout(helloTimer);
          // First envelope must be a hello.
          if (env.type !== 'hello') {
            client.close();
            reject(new Error(`expected first envelope to be 'hello', got '${env.type}'`));
            return;
          }
          if (env.hello.protocolVersion < 2) {
            client.close();
            reject(new BridgeProtocolMismatchError(env.hello.protocolVersion));
            return;
          }
          // Hello accepted. Detach this bootstrap handler — caller
          // re-arms via `onEnvelope()`.
          client.envelopeHandler = null;
          resolve(client);
        };
      });
    });
  }

  /** Subscribe to subsequent envelopes (post-handshake). */
  onEnvelope(handler: EnvelopeHandler): void {
    this.envelopeHandler = handler;
  }

  /** Subscribe to socket close. Fires at most once. */
  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  /** Send one envelope, terminated with `\n`. Throws if closed. */
  send(envelope: BridgeEnvelope): void {
    if (this.closed) throw new BridgeNotConnectedError();
    const line = encodeEnvelope(envelope);
    this.stream.write(line);
  }

  /** Close the underlying stream gracefully. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.stream.end();
    } catch {
      // ignore
    }
  }

  private handleChunk(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const newlineIdx = this.buffer.indexOf(0x0a);
      if (newlineIdx < 0) break;
      const line = this.buffer.subarray(0, newlineIdx).toString('utf8');
      this.buffer = this.buffer.subarray(newlineIdx + 1);
      if (line.length === 0) continue;
      try {
        const env = decodeEnvelope(line);
        this.envelopeHandler?.(env);
      } catch (err) {
        if (err instanceof BridgeCodecError) {
          // Drop malformed frames — best-effort local IPC, mirrors
          // BridgeServer's silent drop behavior.
          continue;
        }
        throw err;
      }
    }
  }

  private notifyClose(reason: 'eof' | 'error', err?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandler?.(reason, err);
  }
}
