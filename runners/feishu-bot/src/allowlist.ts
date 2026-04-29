// M9 task 3.2: minimal sender allowlist for the Feishu bot bridge.
//
// Read from env LARK_BOT_ALLOWLIST (comma-separated open_id values).
// Empty / unset → admit ALL senders (demo-friendly default).
// Set → only senders whose open_id is in the list are admitted.

/**
 * @param senderOpenID  the sender's Feishu open_id (e.g. "ou_xxx").
 * @param allowlistEnv  raw value of the LARK_BOT_ALLOWLIST env var,
 *                      or undefined if not set.
 */
export function isAllowed(senderOpenID: string, allowlistEnv: string | undefined): boolean {
  const list = parseAllowlist(allowlistEnv);
  if (list.length === 0) return true; // open by default
  return list.includes(senderOpenID);
}

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
