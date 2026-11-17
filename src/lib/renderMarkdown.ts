/**
 * A deliberately small Markdown renderer for memory notes.
 *
 * Scope: the block and inline syntax a scratchpad note actually uses —
 * headings, paragraphs with hard line breaks, fenced code, inline code,
 * bullet/numbered lists, blockquotes, rules, links, emphasis, strikethrough,
 * and inline `#tags`.
 *
 * Safety: every character of the source is escaped before any markup is
 * produced, raw HTML is never passed through, and a link survives only when
 * its href is http(s) or mailto. The output is therefore safe to hand to
 * `{@html}` in the view.
 */

const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

/** Lines that begin a block, so a paragraph knows where to stop. */
const BLOCK_START = /^(?:```|#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s|(?:-{3,}|\*{3,}|_{3,})\s*$)/;

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code — taken verbatim (escaped), never formatted.
    if (/^```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // closing fence
      blocks.push(`<pre class="md-code"><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      // `#` is the note's title line; one level down keeps the document
      // hierarchy sane inside a pane that already has its own header.
      const tag = `h${Math.min(heading[1].length + 1, 6)}`;
      blocks.push(`<${tag} class="md-heading">${renderInline(heading[2])}</${tag}>`);
      i++;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push('<hr class="md-rule">');
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        `<blockquote class="md-quote">${quoted.map(renderInline).join('<br>')}</blockquote>`,
      );
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = /^[-*+]\s+(.*)$/.exec(lines[i]);
        if (!item) break;
        items.push(item[1]);
        i++;
      }
      blocks.push(`<ul class="md-list">${items.map(listItem).join('')}</ul>`);
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = /^\d+[.)]\s+(.*)$/.exec(lines[i]);
        if (!item) break;
        items.push(item[1]);
        i++;
      }
      blocks.push(`<ol class="md-list">${items.map(listItem).join('')}</ol>`);
      continue;
    }

    // Paragraph: consecutive plain lines, hard-wrapped lines kept as <br>.
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) {
      paragraph.push(lines[i]);
      i++;
    }
    if (paragraph.length === 0) {
      // Never spin on a line no branch above claimed.
      paragraph.push(line);
      i++;
    }
    blocks.push(`<p class="md-paragraph">${paragraph.map(renderInline).join('<br>')}</p>`);
  }

  return blocks.join('');
}

function listItem(text: string): string {
  return `<li class="md-item">${renderInline(text)}</li>`;
}

function renderInline(raw: string): string {
  // Inline code is lifted out first so its contents never get formatted.
  const codeSpans: string[] = [];
  let text = escapeHtml(raw).replace(/`([^`]+)`/g, (_match, span: string) => {
    codeSpans.push(span);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  text = text.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    if (!SAFE_LINK.test(href)) return label;
    return `<a class="md-link" href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });

  text = text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
  text = text.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?![\w])/g, '$1<em>$2</em>');
  text = text.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  text = text.replace(/(^|[\s(])(#[A-Za-z0-9_-]+)/g, '$1<span class="md-tag">$2</span>');

  return text.replace(
    /\u0000(\d+)\u0000/g,
    (_match, index: string) =>
      `<code class="md-inline-code">${codeSpans[Number(index)] ?? ''}</code>`,
  );
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
