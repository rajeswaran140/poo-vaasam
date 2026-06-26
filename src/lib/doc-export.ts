/**
 * Export an admin doc as Markdown or PDF. Markdown is the doc's own source body
 * (a faithful download). PDF is print-rendered: we convert the SAME parsed blocks
 * the on-screen viewer uses (markdown-blocks) into a self-contained HTML document,
 * which the client prints to PDF via a hidden iframe (Tamil renders through the
 * browser's fonts — no PDF library, no font-embedding, no extra dependency).
 *
 * Pure + dependency-free → unit-testable. The DOM/print side lives in DocExport.tsx.
 */

import { parseMarkdown, parseInline, type Block } from './markdown-blocks';
import { exportFilename } from './prompt-export';

export { exportFilename };

export interface ExportableDoc {
  slug: string; // file-safe identifier — used for the download filename
  title: string;
  body: string; // markdown source
  updatedAt: string;
}

/**
 * Allow only safe link schemes in the printable HTML — http(s), mailto, anchors
 * and relative paths. A `javascript:`/`data:`/etc. href is dropped (text kept).
 * Docs are code-authored today, but this keeps the export safe if they ever
 * become user-editable.
 */
function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^(https?:|mailto:)/i.test(h)) return h;
  if (/^[/#]/.test(h)) return h; // relative path or anchor (incl. protocol-relative //host)
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null; // some other scheme → reject
  return h; // no scheme → treat as relative
}

/** HTML-escape text content (also used for attribute values). */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

/** Render inline markdown (**bold**, `code`, [link](url)) to safe HTML. */
function inlineToHtml(text: string): string {
  return parseInline(text)
    .map((t) => {
      switch (t.type) {
        case 'bold':
          return `<strong>${esc(t.text)}</strong>`;
        case 'code':
          return `<code>${esc(t.text)}</code>`;
        case 'link': {
          const href = safeHref(t.href);
          return href ? `<a href="${esc(href)}">${esc(t.text)}</a>` : esc(t.text);
        }
        default:
          return esc(t.text);
      }
    })
    .join('');
}

function blockToHtml(b: Block): string {
  switch (b.type) {
    case 'heading':
      return `<h${b.level}>${inlineToHtml(b.text)}</h${b.level}>`;
    case 'paragraph':
      return `<p>${inlineToHtml(b.text)}</p>`;
    case 'quote':
      return `<blockquote>${inlineToHtml(b.text)}</blockquote>`;
    case 'hr':
      return '<hr/>';
    case 'code':
      return `<pre><code>${esc(b.text)}</code></pre>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${b.items.map((i) => `<li>${inlineToHtml(i)}</li>`).join('')}</${tag}>`;
    }
    case 'table': {
      const head = `<tr>${b.headers.map((h) => `<th>${inlineToHtml(h)}</th>`).join('')}</tr>`;
      const rows = b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineToHtml(c)}</td>`).join('')}</tr>`).join('');
      return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    }
  }
}

/** Convert a markdown string to a block-level HTML fragment (same parser as the viewer). */
export function markdownToHtml(md: string): string {
  return parseMarkdown(md).map(blockToHtml).join('\n');
}

/** The Markdown export is the doc's own source — faithful, copy-paste-able. */
export function docToMarkdown(doc: ExportableDoc): string {
  return doc.body.trimEnd() + '\n';
}

const PRINT_CSS = `
  body{font-family:'Noto Sans Tamil','Latha','Baloo Thambi 2',system-ui,sans-serif;margin:36px;color:#111;line-height:1.6}
  h1{font-size:24px;margin:0 0 4px}
  h2{font-size:18px;margin:22px 0 6px;color:#6d28d9}
  h3{font-size:15px;margin:16px 0 4px;color:#374151}
  p{margin:8px 0}
  a{color:#7c3aed}
  code{background:#f3f4f6;border-radius:4px;padding:1px 4px;font-size:.9em}
  pre{background:#111827;color:#f9fafb;border-radius:8px;padding:12px;overflow:auto}
  pre code{background:none;color:inherit;padding:0}
  blockquote{border-left:4px solid #c4b5fd;background:#f5f3ff;margin:12px 0;padding:8px 14px;color:#374151}
  ul,ol{margin:8px 0;padding-left:22px}
  li{margin:3px 0}
  hr{border:0;border-top:1px solid #e5e7eb;margin:20px 0}
  table{border-collapse:collapse;width:100%;margin:12px 0;font-size:.92em}
  th,td{border:1px solid #e5e7eb;padding:6px 10px;text-align:left;vertical-align:top}
  th{background:#f5f3ff;color:#6d28d9}
  .meta{color:#6b7280;font-size:12px;margin-bottom:14px}
  @media print{body{margin:0}}
`;

/** A self-contained, printable HTML document for one doc. */
export function buildDocPrintHtml(doc: ExportableDoc): string {
  return `<!doctype html><html lang="ta"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>${PRINT_CSS}</style></head><body>
<div class="meta">Tamilagaval admin docs · Updated ${esc(doc.updatedAt)}</div>
${markdownToHtml(doc.body)}
</body></html>`;
}
