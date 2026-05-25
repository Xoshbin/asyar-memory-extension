import type { MemoryEntry } from '../stateKeys';

export function substringMatch(
  entries: MemoryEntry[],
  query: string,
): MemoryEntry[] {
  if (!query) return entries;
  const needle = query.toLowerCase();
  return entries.filter((e) => {
    if (e.note.toLowerCase().includes(needle)) return true;
    return e.tags.some((t) => t.includes(needle));
  });
}
