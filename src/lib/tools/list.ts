import {
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  type MemoryEntry,
} from '../../stateKeys';

export interface ListArgs {
  tag?: unknown;
  limit?: unknown;
}

export interface ListResult {
  count: number;
  entries: MemoryEntry[];
}

export function list(
  entries: MemoryEntry[],
  args: ListArgs,
): { next: MemoryEntry[]; result: ListResult } {
  const tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : undefined;
  const limit = clampLimit(args.limit);

  const filtered = tag ? entries.filter((e) => e.tags.includes(tag)) : entries;

  const sorted = [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.at - a.at;
  });

  const top = sorted.slice(0, limit);
  return { next: entries, result: { count: top.length, entries: top } };
}

function clampLimit(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : LIST_DEFAULT_LIMIT;
  if (n < 1) return LIST_DEFAULT_LIMIT;
  return Math.min(n, LIST_MAX_LIMIT);
}
