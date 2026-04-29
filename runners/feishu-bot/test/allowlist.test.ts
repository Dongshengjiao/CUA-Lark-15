// M9 task 3.2 tests.

import { describe, expect, it } from 'vitest';
import { isAllowed, parseAllowlist } from '../src/allowlist.js';

describe('M9 allowlist', () => {
  it('empty / undefined env admits all senders', () => {
    expect(isAllowed('ou_anyone', undefined)).toBe(true);
    expect(isAllowed('ou_anyone', '')).toBe(true);
    expect(isAllowed('ou_anyone', '   ')).toBe(true);
  });

  it('single open_id matches itself', () => {
    expect(isAllowed('ou_alice', 'ou_alice')).toBe(true);
    expect(isAllowed('ou_bob', 'ou_alice')).toBe(false);
  });

  it('multiple open_ids comma-separated, with whitespace tolerance', () => {
    const env = 'ou_alice,  ou_bob , ou_carol';
    expect(isAllowed('ou_alice', env)).toBe(true);
    expect(isAllowed('ou_bob', env)).toBe(true);
    expect(isAllowed('ou_carol', env)).toBe(true);
    expect(isAllowed('ou_dan', env)).toBe(false);
  });

  it('parseAllowlist drops empty entries', () => {
    expect(parseAllowlist('ou_alice,,ou_bob,')).toEqual(['ou_alice', 'ou_bob']);
    expect(parseAllowlist(',,,')).toEqual([]);
  });
});
