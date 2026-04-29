// M9 task 2.2: parser unit tests.

import { describe, expect, it } from 'vitest';
import { chunkNdjsonBuffer, parseImMessageReceiveV1 } from '../src/lark-event.js';

function makeEvent(overrides: {
  eventType?: string;
  senderOpenID?: string | null;
  chatID?: string | null;
  messageID?: string | null;
  messageType?: string;
  chatType?: string;
  content?: string;
}): string {
  const base = {
    schema: '2.0',
    header: {
      event_id: 'evt_test_001',
      event_type: overrides.eventType ?? 'im.message.receive_v1',
      create_time: '1714400000000',
      tenant_key: 'tenant_xxx',
      app_id: 'cli_a978b87cf6b9dbd8',
    },
    event: {
      sender: {
        sender_id: {
          open_id: overrides.senderOpenID === null ? undefined : overrides.senderOpenID ?? 'ou_test_sender',
          user_id: 'user_xxx',
          union_id: 'on_xxx',
        },
        sender_type: 'user',
        tenant_key: 'tenant_xxx',
      },
      message: {
        message_id: overrides.messageID === null ? undefined : overrides.messageID ?? 'om_test_msg_001',
        chat_id: overrides.chatID === null ? undefined : overrides.chatID ?? 'oc_test_chat_001',
        chat_type: overrides.chatType ?? 'p2p',
        message_type: overrides.messageType ?? 'text',
        create_time: '1714400000000',
        content: overrides.content ?? '{"text":"hello m9"}',
        mentions: [],
      },
    },
  };
  return JSON.stringify(base);
}

describe('M9 parseImMessageReceiveV1', () => {
  it('case A: standard p2p text message extracts all four fields', () => {
    const line = makeEvent({});
    const out = parseImMessageReceiveV1(line);
    expect(out).not.toBeNull();
    expect(out!.chatID).toBe('oc_test_chat_001');
    expect(out!.senderOpenID).toBe('ou_test_sender');
    expect(out!.text).toBe('hello m9');
    expect(out!.messageID).toBe('om_test_msg_001');
  });

  it('case B: image message_type is dropped', () => {
    const line = makeEvent({ messageType: 'image' });
    expect(parseImMessageReceiveV1(line)).toBeNull();
  });

  it('case B2: post message_type is dropped (M9 stage 1 only handles text)', () => {
    const line = makeEvent({ messageType: 'post' });
    expect(parseImMessageReceiveV1(line)).toBeNull();
  });

  it('case C: missing content field returns null', () => {
    // Construct a payload without `content`. We can't go through
    // makeEvent because it always sets content; build inline.
    const obj = JSON.parse(makeEvent({})) as { event: { message: Record<string, unknown> } };
    delete obj.event.message.content;
    const out = parseImMessageReceiveV1(JSON.stringify(obj));
    expect(out).toBeNull();
  });

  it('case D: content that is not valid JSON returns null', () => {
    const line = makeEvent({ content: 'not-a-json-object' });
    expect(parseImMessageReceiveV1(line)).toBeNull();
  });

  it('case E: wrong event_type (e.g. contact.user.created_v3) returns null', () => {
    const line = makeEvent({ eventType: 'contact.user.created_v3' });
    expect(parseImMessageReceiveV1(line)).toBeNull();
  });

  it('case F: group chat (chat_type=group) is dropped — m9 only handles p2p', () => {
    const line = makeEvent({ chatType: 'group' });
    expect(parseImMessageReceiveV1(line)).toBeNull();
  });

  it('case G: missing sender open_id returns null', () => {
    const line = makeEvent({ senderOpenID: null });
    expect(parseImMessageReceiveV1(line)).toBeNull();
  });

  it('case H: empty / whitespace text content returns null', () => {
    const line = makeEvent({ content: '{"text":"   "}' });
    expect(parseImMessageReceiveV1(line)).toBeNull();
  });

  it('case I: malformed top-level JSON returns null', () => {
    expect(parseImMessageReceiveV1('not json at all')).toBeNull();
    expect(parseImMessageReceiveV1('')).toBeNull();
    expect(parseImMessageReceiveV1('   ')).toBeNull();
  });
});

describe('M9 chunkNdjsonBuffer', () => {
  it('splits two complete lines and leaves an empty rest', () => {
    const buf = '{"a":1}\n{"b":2}\n';
    const out = chunkNdjsonBuffer(buf);
    expect(out.lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(out.rest).toBe('');
  });

  it('keeps the trailing partial fragment as rest', () => {
    const buf = '{"a":1}\n{"b":';
    const out = chunkNdjsonBuffer(buf);
    expect(out.lines).toEqual(['{"a":1}']);
    expect(out.rest).toBe('{"b":');
  });

  it('returns empty arrays for empty input', () => {
    expect(chunkNdjsonBuffer('')).toEqual({ lines: [], rest: '' });
  });

  it('drops empty lines (multiple consecutive newlines)', () => {
    const buf = '{"a":1}\n\n{"b":2}\n';
    const out = chunkNdjsonBuffer(buf);
    expect(out.lines).toEqual(['{"a":1}', '{"b":2}']);
  });
});
