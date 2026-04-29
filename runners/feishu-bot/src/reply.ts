// M9 task 3.1: reply to a Feishu IM chat via lark-cli.
//
// Spawns `lark-cli --profile <profile> im +messages-send --as bot ...`
// as a child process. We use --as bot so the message appears as a bot
// message in the user's IM (not as a personal message from the user
// who authorized the app).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const REPLY_MAX_LEN = 3500;

export interface ReplyArgs {
  profile: string;
  chatID: string;
  text: string;
  /** When true, allow text > REPLY_MAX_LEN (used for tests / debugging). */
  allowOverlongForTest?: boolean;
}

export interface ReplyResult {
  ok: boolean;
  messageID?: string;
  error?: string;
}

export async function replyText(args: ReplyArgs): Promise<ReplyResult> {
  const truncated = truncateForFeishu(args.text, args.allowOverlongForTest);
  const idempotencyKey = createHash('md5')
    .update(`${args.chatID}|${truncated}`)
    .digest('hex')
    .slice(0, 32);

  return new Promise((resolve) => {
    const proc = spawn('lark-cli', [
      '--profile',
      args.profile,
      'im',
      '+messages-send',
      '--as',
      'bot',
      '--chat-id',
      args.chatID,
      '--text',
      truncated,
      '--idempotency-key',
      idempotencyKey,
    ]);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    proc.on('error', (err) => {
      resolve({ ok: false, error: `lark-cli spawn failed: ${err.message}` });
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: `lark-cli exit ${code}: ${stderr.trim() || stdout.trim() || 'no output'}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          ok?: boolean;
          data?: { message_id?: string };
          error?: { message?: string };
        };
        if (parsed.ok && parsed.data?.message_id) {
          resolve({ ok: true, messageID: parsed.data.message_id });
        } else {
          resolve({ ok: false, error: parsed.error?.message ?? 'unknown lark-cli error' });
        }
      } catch (err) {
        resolve({
          ok: false,
          error: `lark-cli output parse failed: ${(err as Error).message}; stdout=${stdout.slice(0, 200)}`,
        });
      }
    });
  });
}

export function truncateForFeishu(text: string, allowOverlong = false): string {
  if (allowOverlong) return text;
  if (text.length <= REPLY_MAX_LEN) return text;
  return text.slice(0, REPLY_MAX_LEN - 4) + ' ...';
}
