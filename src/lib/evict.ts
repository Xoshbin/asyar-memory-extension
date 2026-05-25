import type { MemoryEntry } from '../stateKeys';

export function capUnpinned(
  entries: MemoryEntry[],
  cap: number,
): MemoryEntry[] {
  const unpinnedCount = entries.reduce((n, e) => (e.pinned ? n : n + 1), 0);
  if (unpinnedCount <= cap) return entries;

  const dropCount = unpinnedCount - cap;
  // Identify the oldest `dropCount` unpinned by `at`.
  const unpinnedSorted = entries
    .filter((e) => !e.pinned)
    .sort((a, b) => a.at - b.at);
  const evictIds = new Set(unpinnedSorted.slice(0, dropCount).map((e) => e.id));

  return entries.filter((e) => !evictIds.has(e.id));
}
