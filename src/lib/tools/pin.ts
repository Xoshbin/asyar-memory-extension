import type { MemoryEntry } from '../../stateKeys';

export interface PinArgs {
  id: unknown;
  pinned: unknown;
}

export type PinResult = { pinned: boolean; id: string } | { error: string };

export function pin(
  entries: MemoryEntry[],
  args: PinArgs,
): { next: MemoryEntry[]; result: PinResult } {
  const id = typeof args.id === 'string' ? args.id : '';
  const pinned = args.pinned === true;

  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return { next: entries, result: { error: 'unknown id' } };

  if (entries[idx].pinned === pinned) {
    return { next: entries, result: { pinned, id } };
  }

  const next = entries.slice();
  next[idx] = { ...entries[idx], pinned };
  return { next, result: { pinned, id } };
}
