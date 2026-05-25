import { describe, it, expect } from 'vitest';
import { substringMatch } from './search';
import type { MemoryEntry } from '../stateKeys';

const entry = (note: string, tags: string[] = []): MemoryEntry => ({
  id: `id-${note}`,
  note,
  at: 0,
  tags,
  pinned: false,
});

describe('substringMatch', () => {
  it('returns input when query is empty', () => {
    const entries = [entry('hello'), entry('world')];
    expect(substringMatch(entries, '')).toEqual(entries);
  });

  it('matches case-insensitively against note text', () => {
    const entries = [entry('Likes Oat Milk'), entry('Drinks tea')];
    expect(substringMatch(entries, 'oat')).toEqual([entries[0]]);
  });

  it('matches case-insensitively against any tag', () => {
    const entries = [entry('plain', ['work']), entry('plain', ['food'])];
    expect(substringMatch(entries, 'WORK')).toEqual([entries[0]]);
  });

  it('treats note and tags as a single haystack', () => {
    const entries = [entry('coffee', ['drink']), entry('tea', ['drink'])];
    expect(substringMatch(entries, 'drink')).toHaveLength(2);
    expect(substringMatch(entries, 'coffee')).toEqual([entries[0]]);
  });
});
