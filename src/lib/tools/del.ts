import type { MemoryEntry } from '../../stateKeys';

export interface DelArgs {
  id: unknown;
}

export interface DelResult {
  deleted: boolean;
  id: string;
}

export function del(
  entries: MemoryEntry[],
  args: DelArgs,
): { next: MemoryEntry[]; result: DelResult } {
  const id = typeof args.id === 'string' ? args.id : '';
  if (!id) return { next: entries, result: { deleted: false, id: '' } };

  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return { next: entries, result: { deleted: false, id } };

  const next = entries.slice(0, idx).concat(entries.slice(idx + 1));
  return { next, result: { deleted: true, id } };
}
