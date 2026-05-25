import type { MemoryEntry } from '../../stateKeys';
import { normalizeTags } from '../normalize';

export interface UpdateArgs {
  id: unknown;
  note: unknown;
  /**
   * Optional tag replacement. Omit (or pass undefined) to leave the
   * entry's existing tags untouched. Pass an array to overwrite them
   * (the array goes through `normalizeTags`, same as on save).
   *
   * Agent-facing `memory_update` tool doesn't expose this field in its
   * JSON Schema — only the view's inline Edit form sends it.
   */
  tags?: unknown;
}

export type UpdateResult =
  | { updated: true; id: string }
  | { updated: false; error: string };

export function update(
  entries: MemoryEntry[],
  args: UpdateArgs,
): { next: MemoryEntry[]; result: UpdateResult } {
  const id = typeof args.id === 'string' ? args.id : '';
  const note = typeof args.note === 'string' ? args.note.trim() : '';
  if (!note) {
    return { next: entries, result: { updated: false, error: 'note must be a non-empty string' } };
  }

  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) {
    return { next: entries, result: { updated: false, error: 'unknown id' } };
  }

  const next = entries.slice();
  const replacement: MemoryEntry = { ...entries[idx], note };
  if (args.tags !== undefined) {
    replacement.tags = normalizeTags(
      Array.isArray(args.tags) ? (args.tags as string[]) : undefined,
    );
  }
  next[idx] = replacement;
  return { next, result: { updated: true, id } };
}
