import { describe, it, expect } from 'vitest';
import { toMarkdown } from './markdown';
import type { MemoryEntry } from '../stateKeys';

const ENTRIES: MemoryEntry[] = [
  {
    id: 'id-1',
    note: 'Likes oat milk in coffee',
    at: Date.UTC(2026, 4, 22),
    tags: ['preferences', 'food'],
    pinned: true,
  },
  {
    id: 'id-2',
    note: "Brother's birthday is March 5",
    at: Date.UTC(2026, 4, 19),
    tags: ['facts', 'family'],
    pinned: false,
  },
];

describe('toMarkdown', () => {
  it('includes a frontmatter header with exported_at and count', () => {
    const out = toMarkdown(ENTRIES, new Date(Date.UTC(2026, 4, 24, 14, 32)));
    expect(out).toMatch(/^---\nexported_at: 2026-05-24T14:32:00\.000Z\ncount: 2\n---\n/);
  });

  it('renders a pin marker on pinned entries', () => {
    const out = toMarkdown(ENTRIES, new Date());
    expect(out).toContain('# 📌 Likes oat milk in coffee');
    expect(out).toContain("# Brother's birthday is March 5");
  });

  it('renders id, saved date (YYYY-MM-DD), and tags inline', () => {
    const out = toMarkdown(ENTRIES, new Date());
    expect(out).toContain('**id:** id-1');
    expect(out).toContain('**saved:** 2026-05-22');
    expect(out).toContain('#preferences #food');
  });

  it('handles entries with no tags', () => {
    const out = toMarkdown(
      [{ id: 'z', note: 'plain', at: Date.UTC(2026, 0, 1), tags: [], pinned: false }],
      new Date(),
    );
    expect(out).toContain('# plain');
    expect(out).not.toMatch(/\*\*tags:\*\*/);
  });
});
