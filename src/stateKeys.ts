/**
 * Single source of truth for the worker→view state contract.
 *
 * Worker writes at this key; view subscribes. Changing a string here
 * changes the wire-level key — both tiers must continue to agree.
 */

export const STATE_KEYS = {
  entries: 'memory.entries',
} as const;

export type StateKey = (typeof STATE_KEYS)[keyof typeof STATE_KEYS];

export interface MemoryEntry {
  /** crypto.randomUUID() */
  id: string;
  /** Raw text — whatever the agent or user passed. */
  note: string;
  /** ms epoch at creation; immutable; drives ordering. */
  at: number;
  /** Normalized tags: trim + toLowerCase, ≤5 items, ≤32 chars each. */
  tags: string[];
  /** Default false. Pinned entries are never auto-evicted. */
  pinned: boolean;
  /** Optional caller hint (reserved for future). */
  source?: string;
}

export const CAP_UNPINNED = 1000;

/** memory_list limits. */
export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 200;

/** memory_search limits. */
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 100;

/** Tag normalization caps. */
export const MAX_TAGS_PER_ENTRY = 5;
export const MAX_TAG_LEN = 32;
