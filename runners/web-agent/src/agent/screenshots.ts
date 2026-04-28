// M3: screenshot path / fire-and-forget writer.
// Per `web-agent-runner-service` Requirement "截图按规范写盘，事件
// 只携带路径", screenshots live at:
//   ~/Library/Application Support/LarkIsland/web-agent/screenshots/<taskID>/<stepIndex>.jpg
// envelopes carry an absolute path string in `screenshotURL`.

import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const SCREENSHOTS_ROOT_ENV = 'LARK_ISLAND_WEB_AGENT_SCREENSHOTS_DIR';

export function screenshotsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[SCREENSHOTS_ROOT_ENV];
  if (override && override.length > 0) return override;
  return join(
    homedir(),
    'Library',
    'Application Support',
    'LarkIsland',
    'web-agent',
    'screenshots',
  );
}

export function screenshotPathFor(
  taskID: string,
  stepIndex: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(screenshotsRoot(env), taskID, `${stepIndex}.jpg`);
}

/**
 * Fire-and-forget JPEG writer. Returns a promise so callers may
 * await for tests, but production code is expected to attach
 * `.catch(logErr)` and move on — write failures must never block
 * the task loop.
 */
export async function saveScreenshot(base64: string, absolutePath: string): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });
  const buf = Buffer.from(base64, 'base64');
  await writeFile(absolutePath, buf);
}
