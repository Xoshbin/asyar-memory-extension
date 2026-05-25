import { STATE_KEYS, type MemoryEntry } from '../stateKeys';

/** Minimal interface around the SDK's ExtensionStateProxy used by wrap(). */
export interface StateLike {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
}

/**
 * Read `memory.entries`, run a pure tool fn, write back if and only if
 * the fn returned a different array reference. Returns the result the
 * tool produced — that's what the agent (or view RPC) sees.
 */
export function wrap<A, R>(
  state: StateLike,
  fn: (entries: MemoryEntry[], args: A) => { next: MemoryEntry[]; result: R },
): (args: unknown) => Promise<R> {
  return async (args: unknown): Promise<R> => {
    const raw = (await state.get(STATE_KEYS.entries)) as MemoryEntry[] | null;
    const entries = raw ?? [];
    const { next, result } = fn(entries, args as A);
    if (next !== entries) {
      await state.set(STATE_KEYS.entries, next);
    }
    return result;
  };
}
