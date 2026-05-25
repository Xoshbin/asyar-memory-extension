import type { MemoryEntry } from '../../stateKeys';

export interface ClearResult {
  cleared: number;
}

export function clear(
  entries: MemoryEntry[],
  _args: Record<string, never>,
): { next: MemoryEntry[]; result: ClearResult } {
  return { next: [], result: { cleared: entries.length } };
}
