import { describe, it, expect } from 'vitest';
import { list } from './list';
import type { MemoryEntry } from '../../stateKeys';

const e = (id: string, at: number, opts: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id,
  note: id,
  at,
  tags: [],
  pinned: false,
  ...opts,
});

describe('list', () => {
  it('sorts pinned-first then newest-first', () => {
    const entries = [
      e('a', 1),
      e('b', 3, { pinned: true }),
      e('c', 2),
      e('d', 4, { pinned: true }),
    ];
    const { result } = list(entries, {});
    expect(result.entries.map((x) => x.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('filters by tag exact match', () => {
    const entries = [
      e('a', 1, { tags: ['work'] }),
      e('b', 2, { tags: ['food'] }),
      e('c', 3, { tags: ['work', 'urgent'] }),
    ];
    const { result } = list(entries, { tag: 'work' });
    expect(result.entries.map((x) => x.id).sort()).toEqual(['a', 'c']);
  });

  it('clamps limit to default 50 / max 200', () => {
    const entries = Array.from({ length: 250 }, (_, i) => e(`e${i}`, i));
    expect(list(entries, {}).result.entries).toHaveLength(50);
    expect(list(entries, { limit: 1000 }).result.entries).toHaveLength(200);
    expect(list(entries, { limit: 5 }).result.entries).toHaveLength(5);
  });

  it('does not mutate the input array', () => {
    const entries = [e('a', 1), e('b', 2, { pinned: true })];
    const snapshot = [...entries];
    list(entries, {});
    expect(entries).toEqual(snapshot);
  });
});
