/** @jest-environment node */
/**
 * doc-export — pure transforms behind the Docs MD/PDF export. Renders via the
 * SAME markdown parser the viewer uses, and HTML-escapes all content.
 */
import {
  markdownToHtml,
  docToMarkdown,
  buildDocPrintHtml,
  exportFilename,
} from '@/lib/doc-export';

describe('markdownToHtml', () => {
  it('renders the block + inline grammar the docs use', () => {
    const md = [
      '# Title',
      '## Section',
      'A **bold** word, `code`, and a [link](https://x.com).',
      '- one',
      '- two',
      '> a quote',
      '---',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '```',
      'raw code',
      '```',
    ].join('\n');
    const html = markdownToHtml(md);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<h2>Section</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<a href="https://x.com">link</a>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<blockquote>a quote</blockquote>');
    expect(html).toContain('<hr/>');
    expect(html).toMatch(/<table>.*<th>A<\/th>.*<td>1<\/td>.*<\/table>/s);
    expect(html).toContain('<pre><code>raw code</code></pre>');
  });

  it('HTML-escapes content (no injection from doc text)', () => {
    const html = markdownToHtml('A < B & "C" > D <script>x</script>');
    expect(html).toContain('&lt;');
    expect(html).toContain('&amp;');
    expect(html).not.toContain('<script>');
  });

  it('drops unsafe link schemes (javascript:) but keeps the link text', () => {
    const html = markdownToHtml('[click me](javascript:alert(1))');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toContain('<a ');
    expect(html).toContain('click me');
  });

  it('keeps http(s), relative, and anchor links', () => {
    expect(markdownToHtml('[a](https://x.com)')).toContain('<a href="https://x.com">');
    expect(markdownToHtml('[b](/admin/docs)')).toContain('<a href="/admin/docs">');
    expect(markdownToHtml('[c](#section)')).toContain('<a href="#section">');
  });

  it('renders an ordered list', () => {
    expect(markdownToHtml('1. first\n2. second')).toContain('<ol><li>first</li><li>second</li></ol>');
  });
});

describe('docToMarkdown', () => {
  it('is the faithful source body with a single trailing newline', () => {
    const out = docToMarkdown({ slug: 't', title: 'T', body: '# T\n\nbody  \n\n\n', updatedAt: '2026-06-26' });
    expect(out).toBe('# T\n\nbody\n');
  });
});

describe('buildDocPrintHtml', () => {
  it('is a self-contained HTML doc with the title, meta, styles, and rendered body', () => {
    const html = buildDocPrintHtml({ slug: 'my-doc', title: 'My Doc', body: '# My Doc\n\nhello', updatedAt: '2026-06-26' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>My Doc</title>');
    expect(html).toContain('Updated 2026-06-26');
    expect(html).toContain('<style>');
    expect(html).toContain('<h1>My Doc</h1>');
    expect(html).toContain('<p>hello</p>');
  });

  it('escapes the title in the <title> tag', () => {
    const html = buildDocPrintHtml({ slug: 'x', title: 'A & <B>', body: 'x', updatedAt: '2026-06-26' });
    expect(html).toContain('<title>A &amp; &lt;B&gt;</title>');
  });
});

describe('exportFilename (re-exported)', () => {
  it('produces a safe ascii filename with the given extension', () => {
    expect(exportFilename('Instrument palette for SUNO prompts', 'md')).toBe('instrument-palette-for-suno-prompts.md');
    expect(exportFilename('தமிழ் doc', 'md')).toMatch(/\.md$/);
  });
});
