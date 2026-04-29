// M9 task 2.x: parse `lark-cli event +subscribe` NDJSON stdout.
//
// Schema reference (Feishu official `im.message.receive_v1` schema 2.0):
//
//   {
//     "schema": "2.0",
//     "header": {
//       "event_id": "...",
//       "event_type": "im.message.receive_v1",
//       ...
//     },
//     "event": {
//       "sender": {
//         "sender_id": { "open_id": "ou_xxx", ... },
//         "sender_type": "user",
//         ...
//       },
//       "message": {
//         "message_id": "om_xxx",
//         "chat_id": "oc_xxx",
//         "chat_type": "p2p" | "group",
//         "message_type": "text" | "image" | "post" | ...,
//         "content": "{\"text\":\"...\"}",   // JSON string
//         ...
//       }
//     }
//   }
//
// Parser is intentionally defensive: any missing field, malformed JSON,
// non-text message type, or non-p2p chat is dropped silently (logged at
// warn level by the caller). The bot bridge MUST keep listening for the
// next event regardless.

export interface IncomingTextMessage {
  /** Feishu chat id, used as recipient when replying. */
  chatID: string;
  /** Feishu open_id of the sender, used for allowlist checks. */
  senderOpenID: string;
  /** Plain-text message body, used as the runWebAgentTask prompt. */
  text: string;
  /** Source message id, used to derive the taskID (`feishu-bot-<messageID>`). */
  messageID: string;
}

/**
 * Parse a single NDJSON line as a Feishu im.message.receive_v1 event.
 * Returns null for any reason (wrong event_type, non-text, non-p2p,
 * malformed JSON, missing fields). Caller decides whether to log.
 */
export function parseImMessageReceiveV1(line: string): IncomingTextMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') return null;

  const header = obj.header as Record<string, unknown> | undefined;
  if (!header || header.event_type !== 'im.message.receive_v1') return null;

  const event = obj.event as Record<string, unknown> | undefined;
  if (!event) return null;

  const sender = event.sender as Record<string, unknown> | undefined;
  const senderID = sender?.sender_id as Record<string, unknown> | undefined;
  const senderOpenID = typeof senderID?.open_id === 'string' ? senderID.open_id : '';
  if (!senderOpenID) return null;

  const message = event.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const chatID = typeof message.chat_id === 'string' ? message.chat_id : '';
  const messageID = typeof message.message_id === 'string' ? message.message_id : '';
  const messageType = typeof message.message_type === 'string' ? message.message_type : '';
  const chatType = typeof message.chat_type === 'string' ? message.chat_type : '';
  const contentRaw = typeof message.content === 'string' ? message.content : '';

  if (!chatID || !messageID) return null;
  // M9 stage 1: only accept private text messages. Group `@bot` and
  // non-text payloads are explicitly out of scope.
  if (messageType !== 'text') return null;
  if (chatType !== 'p2p') return null;

  let textPayload: { text?: unknown } | null = null;
  try {
    textPayload = JSON.parse(contentRaw);
  } catch {
    return null;
  }
  const text = typeof textPayload?.text === 'string' ? textPayload.text.trim() : '';
  if (!text) return null;

  return { chatID, senderOpenID, text, messageID };
}

/**
 * Split an unbounded UTF-8 string buffer into NDJSON lines. The final
 * unterminated fragment (if any) is returned as `rest` so the caller
 * can prepend it to the next chunk.
 *
 * lark-cli writes one JSON object per line followed by `\n`. Embedded
 * `\n` in JSON strings is escaped (`\\n`), so a naive split-by-`\n`
 * is correct for this protocol.
 */
export function chunkNdjsonBuffer(buf: string): { lines: string[]; rest: string } {
  if (!buf) return { lines: [], rest: '' };
  const parts = buf.split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts.filter((l) => l.length > 0), rest };
}
