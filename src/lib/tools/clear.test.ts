import { describe, it, expect } from 'vitest';
import { clear } from './clear';
import type { MemoryEntry } from '../../stateKeys';

const E = (id: string, pinned = false): MemoryEntry => ({
  id,
  note: id,
  at: 0,
  tags: [],
  pinned,
});

describe('clear', () => {
  it('wipes everything including pinned entries', () => {
    const { next, result } = clear([E('a'), E('b', true), E('c')], {});
    expect(next).toEqual([]);
    expect(result).toEqual({ cleared: 3 });
  });

  it('returns cleared=0 when already empty', () => {
    const { next, result } = clear([], {});
    expect(next).toEqual([]);
    expect(result).toEqual({ cleared: 0 });
  });
});
