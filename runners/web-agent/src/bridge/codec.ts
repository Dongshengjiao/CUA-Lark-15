// Newline-delimited JSON codec for BridgeEnvelope. Mirrors
// LarkIslandCore's `BridgeCodec` (Sources/LarkIslandCore/BridgeTransport.swift).
//
// Wire format conventions:
// - One envelope per line, terminated by `\n`.
// - Date fields are integer milliseconds since the Unix epoch.
// - AgentEvent payloads are nested under a key matching their `type`
//   (e.g. `{type: 'webAgentTaskStarted', webAgentTaskStarted: {...}}`).
// - BridgeCommand fields are flat siblings of the `type` key inside
//   the `command` object.

import type {
  AgentEvent,
  BridgeCommand,
  BridgeEnvelope,
  BridgeHello,
  BridgeResponse,
  WebAgentFailureKind,
} from './types';

export class BridgeCodecError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'BridgeCodecError';
  }
}

// ===== AgentEvent =====

const KNOWN_EVENT_TYPES = new Set<AgentEvent['type']>([
  'sessionStarted',
  'activityUpdated',
  'permissionRequested',
  'questionAsked',
  'sessionCompleted',
  'jumpTargetUpdated',
  'actionableStateResolved',
  'webAgentTaskStarted',
  'webAgentStepUpdate',
  'webAgentApprovalRequested',
  'webAgentTaskCompleted',
  'webAgentTaskFailed',
]);

const KNOWN_FAILURE_KINDS = new Set<WebAgentFailureKind>([
  'vlmTimeout',
  'vlmError',
  'pageError',
  'cancelled',
]);

const TIMESTAMP_FIELDS = new Set(['timestamp']);

function reviveDates<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(reviveDates) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (TIMESTAMP_FIELDS.has(k) && typeof v === 'number') {
      out[k] = new Date(v);
    } else {
      out[k] = reviveDates(v);
    }
  }
  return out as unknown as T;
}

function freezeDates(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(freezeDates);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = freezeDates(v);
    }
    return out;
  }
  return value;
}

function decodeAgentEvent(raw: unknown): AgentEvent {
  if (!raw || typeof raw !== 'object') {
    throw new BridgeCodecError('AgentEvent must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const t = obj.type;
  if (typeof t !== 'string' || !KNOWN_EVENT_TYPES.has(t as AgentEvent['type'])) {
    throw new BridgeCodecError(`Unknown AgentEvent type: ${String(t)}`);
  }
  const payload = obj[t];
  if (!payload || typeof payload !== 'object') {
    throw new BridgeCodecError(`AgentEvent.${t} payload missing or not an object`);
  }
  const revived = reviveDates(payload);

  if (t === 'webAgentTaskFailed') {
    const kind = (revived as { kind?: string }).kind;
    if (typeof kind !== 'string' || !KNOWN_FAILURE_KINDS.has(kind as WebAgentFailureKind)) {
      throw new BridgeCodecError(`Unknown WebAgentFailureKind: ${String(kind)}`);
    }
  }

  return { type: t as AgentEvent['type'], payload: revived } as AgentEvent;
}

function encodeAgentEvent(event: AgentEvent): Record<string, unknown> {
  return {
    type: event.type,
    [event.type]: freezeDates(event.payload),
  };
}

// ===== BridgeCommand =====

const KNOWN_COMMAND_TYPES = new Set<BridgeCommand['type']>([
  'registerClient',
  'requestQuestion',
  'resolvePermission',
  'answerQuestion',
  'runWebAgentTask',
]);

function decodeCommand(raw: unknown): BridgeCommand {
  if (!raw || typeof raw !== 'object') {
    throw new BridgeCodecError('BridgeCommand must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const t = obj.type;
  if (typeof t !== 'string' || !KNOWN_COMMAND_TYPES.has(t as BridgeCommand['type'])) {
    throw new BridgeCodecError(`Unknown BridgeCommand type: ${String(t)}`);
  }
  const { type: _type, ...rest } = obj;
  // Fields are flat siblings of `type`. Revive any timestamp.
  const revived = reviveDates(rest);
  return { type: t, ...revived } as BridgeCommand;
}

function encodeCommand(command: BridgeCommand): Record<string, unknown> {
  return freezeDates(command) as Record<string, unknown>;
}

// ===== BridgeHello =====

function decodeHello(raw: unknown): BridgeHello {
  if (!raw || typeof raw !== 'object') {
    throw new BridgeCodecError('BridgeHello must be an object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.protocolVersion !== 'number' || typeof obj.serverLabel !== 'string') {
    throw new BridgeCodecError('BridgeHello missing protocolVersion or serverLabel');
  }
  return {
    protocolVersion: obj.protocolVersion,
    serverLabel: obj.serverLabel,
  };
}

// ===== BridgeResponse =====

function decodeResponse(raw: unknown): BridgeResponse {
  if (!raw || typeof raw !== 'object') {
    throw new BridgeCodecError('BridgeResponse must be an object');
  }
  if ((raw as { type?: string }).type !== 'acknowledged') {
    throw new BridgeCodecError(
      `Unknown BridgeResponse type: ${String((raw as { type?: string }).type)}`,
    );
  }
  return { type: 'acknowledged' };
}

// ===== BridgeEnvelope =====

export function decodeEnvelope(line: string): BridgeEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    throw new BridgeCodecError(`malformed JSON: ${(err as Error).message}`, err);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new BridgeCodecError('Envelope must be a JSON object');
  }
  const env = parsed as Record<string, unknown>;
  switch (env.type) {
    case 'hello':
      return { type: 'hello', hello: decodeHello(env.hello) };
    case 'event':
      return { type: 'event', event: decodeAgentEvent(env.event) };
    case 'command':
      return { type: 'command', command: decodeCommand(env.command) };
    case 'response':
      return { type: 'response', response: decodeResponse(env.response) };
    default:
      throw new BridgeCodecError(`Unknown BridgeEnvelope type: ${String(env.type)}`);
  }
}

export function encodeEnvelope(envelope: BridgeEnvelope): string {
  let body: Record<string, unknown>;
  switch (envelope.type) {
    case 'hello':
      body = { type: 'hello', hello: envelope.hello };
      break;
    case 'event':
      body = { type: 'event', event: encodeAgentEvent(envelope.event) };
      break;
    case 'command':
      body = { type: 'command', command: encodeCommand(envelope.command) };
      break;
    case 'response':
      body = { type: 'response', response: envelope.response };
      break;
  }
  return JSON.stringify(body) + '\n';
}
