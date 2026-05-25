import { describe, it, expect } from 'vitest';
import { query } from './query';
import type { MemoryEntry } from '../../stateKeys';

const e = (id: string, note: string, tags: string[] = []): MemoryEntry => ({
  id,
  note,
  at: parseInt(id, 36),
  tags,
  pinned: false,
});

describe('query', () => {
  it('returns substring matches against note', () => {
    const entries = [e('1', 'oat milk'), e('2', 'tea')];
    const { result } = query(entries, { query: 'OAT' });
    expect(result.entries.map((x) => x.id)).toEqual(['1']);
    expect(result.count).toBe(1);
  });

  it('returns substring matches against tags', () => {
    const entries = [e('1', 'plain', ['work']), e('2', 'plain', ['food'])];
    const { result } = query(entries, { query: 'work' });
    expect(result.entries.map((x) => x.id)).toEqual(['1']);
  });

  it('clamps limit to default 20 / max 100', () => {
    const entries = Array.from({ length: 150 }, (_, i) => e(`${i}`, 'match'));
    expect(query(entries, { query: 'match' }).result.entries).toHaveLength(20);
    expect(query(entries, { query: 'match', limit: 500 }).result.entries).toHaveLength(100);
    expect(query(entries, { query: 'match', limit: 3 }).result.entries).toHaveLength(3);
  });

  it('returns empty result for non-string query', () => {
    const entries = [e('1', 'oat')];
    expect(query(entries, { query: 42 as unknown as string }).result.entries).toEqual([]);
  });
});
