import { describe, it, expect } from 'vitest';
import { update } from './update';
import type { MemoryEntry } from '../../stateKeys';

const ENTRY: MemoryEntry = {
  id: 'id-1',
  note: 'old text',
  at: 12345,
  tags: ['work'],
  pinned: false,
};

describe('update', () => {
  it('replaces note text and preserves at / tags / pinned', () => {
    const { next, result } = update([ENTRY], { id: 'id-1', note: 'new text' });
    expect(next[0]).toEqual({ ...ENTRY, note: 'new text' });
    expect(result).toEqual({ updated: true, id: 'id-1' });
  });

  it('trims the new note', () => {
    const { next } = update([ENTRY], { id: 'id-1', note: '  spaced  ' });
    expect(next[0].note).toBe('spaced');
  });

  it('errors when id is unknown', () => {
    const { next, result } = update([ENTRY], { id: 'nope', note: 'x' });
    expect(next).toEqual([ENTRY]);
    expect(result).toEqual({ updated: false, error: 'unknown id' });
  });

  it('errors when note is empty after trim', () => {
    const { next, result } = update([ENTRY], { id: 'id-1', note: '   ' });
    expect(next).toEqual([ENTRY]);
    expect(result).toEqual({ updated: false, error: 'note must be a non-empty string' });
  });
});
