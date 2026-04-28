// M5 task 2.2: resolve the chromium user-data-dir for a given skill
// segment (or the generic fallback). Lives next to the runtime so the
// runner doesn't need to import skill internals just to compute paths.

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROFILES_BASE_PATH = [
  'Library',
  'Application Support',
  'LarkIsland',
  'web-agent',
  'profiles',
];

const GENERIC_SEGMENT = 'generic';

/** Returns the absolute user-data-dir for the given segment, creating the
 * directory tree if it does not yet exist. Pass null/undefined for the
 * untargeted ("generic") fallback. */
export function userDataDirFor(segment?: string | null): string {
  const safeSegment = (segment && segment.trim() !== '') ? segment : GENERIC_SEGMENT;
  const dir = join(homedir(), ...PROFILES_BASE_PATH, safeSegment);
  mkdirSync(dir, { recursive: true });
  return dir;
}
