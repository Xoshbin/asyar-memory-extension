import type { MemoryEntry } from '../stateKeys';

export function toMarkdown(entries: MemoryEntry[], now: Date): string {
  const header =
    `---\n` +
    `exported_at: ${now.toISOString()}\n` +
    `count: ${entries.length}\n` +
    `---\n\n`;

  const body = entries.map(renderEntry).join('\n\n');
  return header + body + (body ? '\n' : '');
}

function renderEntry(e: MemoryEntry): string {
  const title = `# ${e.pinned ? '📌 ' : ''}${e.note}`;
  const saved = formatDate(e.at);
  const tags = e.tags.length ? `  · **tags:** ${e.tags.map((t) => `#${t}`).join(' ')}` : '';
  const meta = `- **id:** ${e.id}  · **saved:** ${saved}${tags}`;
  return `${title}\n${meta}`;
}

function formatDate(at: number): string {
  const d = new Date(at);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
