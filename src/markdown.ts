// Minimal, dependency-free Markdown → HTML for the artifact editor's preview.
// The whole document is HTML-escaped *before* any markup is added, so rendering
// user-authored content is safe — no raw HTML ever passes through — and link /
// image URLs are scheme-checked to block javascript: and friends. Covers the
// common subset: headings, bold/italic/strike, inline + fenced code, links,
// images, ordered/unordered lists, blockquotes and rules.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Only let through schemes that can't run script. Everything else → '#'.
function safeUrl(url: string): string {
  const u = url.trim();
  return /^(https?:|mailto:|#|\/|data:image\/)/i.test(u) ? u : '#';
}

// Inline spans. Code spans are split out first so their contents aren't touched
// by the emphasis/link passes.
function inline(text: string): string {
  return text
    .split(/(`[^`]+`)/g)
    .map((part) => {
      if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
        return `<code>${part.slice(1, -1)}</code>`;
      }
      return part
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => `<img src="${safeUrl(url)}" alt="${alt}" />`)
        .replace(
          /\[([^\]]+)\]\(([^)\s]+)\)/g,
          (_m, label, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
        )
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');
    })
    .join('');
}

export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md.replace(/\r\n/g, '\n')).split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block — content is left as-is (already escaped).
    if (/^```/.test(line)) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++; // skip the closing fence
      out.push(`<pre><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule (3+ of the same marker) — checked before lists.
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushPara();
      out.push('<hr />');
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]))
        items.push(`<li>${inline(lines[i++].replace(/^\s*[-*+]\s+/, ''))}</li>`);
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]))
        items.push(`<li>${inline(lines[i++].replace(/^\s*\d+\.\s+/, ''))}</li>`);
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  return out.join('\n');
}
