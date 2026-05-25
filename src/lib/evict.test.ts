import { describe, it, expect } from 'vitest';
import { capUnpinned } from './evict';
import type { MemoryEntry } from '../stateKeys';

const e = (id: string, at: number, pinned = false): MemoryEntry => ({
  id,
  note: id,
  at,
  tags: [],
  pinned,
});

describe('capUnpinned', () => {
  it('returns the input untouched when below cap', () => {
    const entries = [e('a', 1), e('b', 2)];
    expect(capUnpinned(entries, 5)).toBe(entries);
  });

  it('drops the oldest unpinned entries by `at`', () => {
    const entries = [e('a', 1), e('b', 2), e('c', 3), e('d', 4)];
    const out = capUnpinned(entries, 2);
    expect(out.map((x) => x.id)).toEqual(['c', 'd']);
  });

  it('never evicts pinned entries even if total > cap', () => {
    const entries = [e('p1', 1, true), e('a', 2), e('p2', 3, true), e('b', 4)];
    const out = capUnpinned(entries, 1);
    expect(out.map((x) => x.id).sort()).toEqual(['b', 'p1', 'p2']);
  });

  it('preserves insertion order of survivors', () => {
    const entries = [e('a', 1), e('b', 2), e('c', 3)];
    const out = capUnpinned(entries, 2);
    expect(out.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('returns a new array when eviction happened', () => {
    const entries = [e('a', 1), e('b', 2)];
    const out = capUnpinned(entries, 1);
    expect(out).not.toBe(entries);
  });
});
