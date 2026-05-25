import { MAX_TAG_LEN, MAX_TAGS_PER_ENTRY } from '../stateKeys';

export function normalizeTags(input: string[] | undefined): string[] {
  if (!input) return [];
  const cleaned = input
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length <= MAX_TAG_LEN);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of cleaned) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.slice(0, MAX_TAGS_PER_ENTRY);
}
