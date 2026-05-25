import { describe, it, expect } from 'vitest';
import { save } from './save';
import type { MemoryEntry } from '../../stateKeys';

const NOW = () => 1_700_000_000_000;
const UUID = () => 'uuid-fixed';

describe('save', () => {
  it('rejects empty note', () => {
    const { next, result } = save([], { note: '   ' }, { now: NOW, uuid: UUID });
    expect(next).toEqual([]);
    expect(result).toEqual({ saved: false, error: 'note must be a non-empty string' });
  });

  it('appends a new entry with normalized tags', () => {
    const { next, result } = save(
      [],
      { note: 'hi', tags: ['  Work ', 'PREFS'] },
      { now: NOW, uuid: UUID },
    );
    expect(next).toEqual<MemoryEntry[]>([
      { id: 'uuid-fixed', note: 'hi', at: NOW(), tags: ['work', 'prefs'], pinned: false },
    ]);
    expect(result).toEqual({ saved: true, id: 'uuid-fixed', total: 1 });
  });

  it('preserves prior entries and reports running total', () => {
    const prior: MemoryEntry[] = [
      { id: 'old', note: 'older', at: 1, tags: [], pinned: false },
    ];
    const { next, result } = save(prior, { note: 'new' }, { now: NOW, uuid: UUID });
    expect(next).toHaveLength(2);
    expect(result).toEqual({ saved: true, id: 'uuid-fixed', total: 2 });
  });

  it('triggers eviction when unpinned count exceeds cap', () => {
    const prior: MemoryEntry[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `e${i}`,
      note: 'old',
      at: i,
      tags: [],
      pinned: false,
    }));
    const { next } = save(prior, { note: 'fresh' }, { now: NOW, uuid: UUID });
    expect(next).toHaveLength(1000);
    expect(next.find((e) => e.id === 'e0')).toBeUndefined();
    expect(next.find((e) => e.id === 'uuid-fixed')).toBeDefined();
  });
});
