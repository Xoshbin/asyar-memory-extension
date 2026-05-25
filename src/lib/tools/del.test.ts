import { describe, it, expect } from 'vitest';
import { del } from './del';
import type { MemoryEntry } from '../../stateKeys';

const E = (id: string): MemoryEntry => ({ id, note: id, at: 0, tags: [], pinned: false });

describe('del', () => {
  it('removes the matching entry', () => {
    const entries = [E('a'), E('b'), E('c')];
    const { next, result } = del(entries, { id: 'b' });
    expect(next.map((e) => e.id)).toEqual(['a', 'c']);
    expect(result).toEqual({ deleted: true, id: 'b' });
  });

  it('is idempotent when id is unknown', () => {
    const entries = [E('a')];
    const { next, result } = del(entries, { id: 'nope' });
    expect(next).toBe(entries);
    expect(result).toEqual({ deleted: false, id: 'nope' });
  });

  it('returns deleted=false when id arg is not a string', () => {
    const { result } = del([], { id: 42 as unknown as string });
    expect(result).toEqual({ deleted: false, id: '' });
  });
});
