/**
 * Minimal, dependency-free Markdown → block parser for the in-app admin Docs
 * viewer. Supports the subset our docs use: #/##/### headings, paragraphs,
 * ordered/unordered lists, > blockquotes, --- rules, fenced ``` code, and
 * | pipe | tables. Inline formatting (**bold**, `code`, [text](url)) is parsed
 * separately at render time by `parseInline`. Pure + line-based → unit-testable.
 */

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'hr' }
  | { type: 'code'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes('-');
const splitCells = (l: string) =>
  l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function parseMarkdown(md: string): Block[] {
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'paragraph', text: para.join(' ') });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushPara();
      continue;
    }

    // Fenced code block.
    if (trimmed.startsWith('```')) {
      flushPara();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
      blocks.push({ type: 'code', text: buf.join('\n') });
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      blocks.push({ type: 'hr' });
      continue;
    }

    // Heading.
    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (h) {
      flushPara();
      blocks.push({ type: 'heading', level: h[1].length as 1 | 2 | 3, text: h[2].trim() });
      continue;
    }

    // Table: a pipe row followed by a separator row.
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      const headers = splitCells(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitCells(lines[i++]));
      i--; // step back: the for-loop will advance
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Blockquote (merge consecutive > lines).
    if (/^>\s?/.test(trimmed)) {
      flushPara();
      const buf: string[] = [trimmed.replace(/^>\s?/, '')];
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1].trim())) {
        buf.push(lines[++i].trim().replace(/^>\s?/, ''));
      }
      blocks.push({ type: 'quote', text: buf.join(' ') });
      continue;
    }

    // Lists (merge consecutive items of the same kind).
    const ul = /^[-*]\s+(.*)$/.exec(trimmed);
    const ol = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      const items: string[] = [(ul ? ul[1] : ol![1]).trim()];
      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        const nUl = /^[-*]\s+(.*)$/.exec(next);
        const nOl = /^\d+\.\s+(.*)$/.exec(next);
        if (ordered && nOl) items.push(nOl[1].trim());
        else if (!ordered && nUl) items.push(nUl[1].trim());
        else break;
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph text (accumulate until blank).
    para.push(trimmed);
  }

  flushPara();
  return blocks;
}

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string };

/** Tokenise inline **bold**, `code`, and [text](href) within a single string. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // Order matters: code first (so ** inside code isn't bolded), then bold, then links.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('`')) {
      tokens.push({ type: 'code', text: tok.slice(1, -1) });
    } else if (tok.startsWith('**')) {
      tokens.push({ type: 'bold', text: tok.slice(2, -2) });
    } else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      tokens.push({ type: 'link', text: lm[1], href: lm[2] });
    }
    last = re.lastIndex;
  }
  if (last < text.length) tokens.push({ type: 'text', text: text.slice(last) });
  return tokens.length ? tokens : [{ type: 'text', text }];
}
