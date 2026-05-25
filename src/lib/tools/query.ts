import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  type MemoryEntry,
} from '../../stateKeys';
import { substringMatch } from '../search';

export interface QueryArgs {
  query?: unknown;
  limit?: unknown;
}

export interface QueryResult {
  count: number;
  entries: MemoryEntry[];
}

export function query(
  entries: MemoryEntry[],
  args: QueryArgs,
): { next: MemoryEntry[]; result: QueryResult } {
  if (typeof args.query !== 'string') {
    return { next: entries, result: { count: 0, entries: [] } };
  }
  const limit = clampLimit(args.limit);
  const matched = substringMatch(entries, args.query);
  const top = matched.slice(0, limit);
  return { next: entries, result: { count: top.length, entries: top } };
}

function clampLimit(raw: unknown): number {
  const n =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.floor(raw)
      : SEARCH_DEFAULT_LIMIT;
  if (n < 1) return SEARCH_DEFAULT_LIMIT;
  return Math.min(n, SEARCH_MAX_LIMIT);
}
