import { describe, it, expect } from 'vitest';
import { pin } from './pin';
import type { MemoryEntry } from '../../stateKeys';

const E: MemoryEntry = { id: 'a', note: 'a', at: 0, tags: [], pinned: false };

describe('pin', () => {
  it('pins an unpinned entry', () => {
    const { next, result } = pin([E], { id: 'a', pinned: true });
    expect(next[0].pinned).toBe(true);
    expect(result).toEqual({ pinned: true, id: 'a' });
  });

  it('unpins a pinned entry', () => {
    const { next, result } = pin([{ ...E, pinned: true }], { id: 'a', pinned: false });
    expect(next[0].pinned).toBe(false);
    expect(result).toEqual({ pinned: false, id: 'a' });
  });

  it('is idempotent (pin already-pinned)', () => {
    const pinned: MemoryEntry = { ...E, pinned: true };
    const { next, result } = pin([pinned], { id: 'a', pinned: true });
    expect(next[0].pinned).toBe(true);
    expect(result).toEqual({ pinned: true, id: 'a' });
  });

  it('errors when id is unknown', () => {
    const input: MemoryEntry[] = [E];
    const { next, result } = pin(input, { id: 'nope', pinned: true });
    expect(next).toBe(input);
    expect(result).toEqual({ error: 'unknown id' });
  });
});
