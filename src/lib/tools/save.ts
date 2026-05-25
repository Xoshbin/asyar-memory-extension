import { CAP_UNPINNED, type MemoryEntry } from '../../stateKeys';
import { normalizeTags } from '../normalize';
import { capUnpinned } from '../evict';

export interface SaveArgs {
  note: unknown;
  tags?: unknown;
}

export type SaveResult =
  | { saved: true; id: string; total: number }
  | { saved: false; error: string };

export interface SaveDeps {
  now: () => number;
  uuid: () => string;
}

export function save(
  entries: MemoryEntry[],
  args: SaveArgs,
  deps: SaveDeps,
): { next: MemoryEntry[]; result: SaveResult } {
  const note = typeof args.note === 'string' ? args.note.trim() : '';
  if (!note) {
    return { next: entries, result: { saved: false, error: 'note must be a non-empty string' } };
  }

  const tags = normalizeTags(Array.isArray(args.tags) ? (args.tags as string[]) : undefined);
  const entry: MemoryEntry = {
    id: deps.uuid(),
    note,
    at: deps.now(),
    tags,
    pinned: false,
  };
  const appended = [...entries, entry];
  const next = capUnpinned(appended, CAP_UNPINNED);
  return { next, result: { saved: true, id: entry.id, total: next.length } };
}
