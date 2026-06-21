import { parseMarkdown, parseInline } from '@/lib/markdown-blocks';

describe('parseMarkdown — block types', () => {
  it('parses headings at 3 levels', () => {
    expect(parseMarkdown('# A\n## B\n### C')).toEqual([
      { type: 'heading', level: 1, text: 'A' },
      { type: 'heading', level: 2, text: 'B' },
      { type: 'heading', level: 3, text: 'C' },
    ]);
  });

  it('merges wrapped lines into one paragraph and splits on blank lines', () => {
    const blocks = parseMarkdown('one\ntwo\n\nthree');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'one two' },
      { type: 'paragraph', text: 'three' },
    ]);
  });

  it('parses unordered and ordered lists', () => {
    expect(parseMarkdown('- a\n- b')).toEqual([{ type: 'list', ordered: false, items: ['a', 'b'] }]);
    expect(parseMarkdown('1. a\n2. b')).toEqual([{ type: 'list', ordered: true, items: ['a', 'b'] }]);
  });

  it('parses a blockquote (merging consecutive > lines)', () => {
    expect(parseMarkdown('> line one\n> line two')).toEqual([{ type: 'quote', text: 'line one line two' }]);
  });

  it('parses a horizontal rule', () => {
    expect(parseMarkdown('---')).toEqual([{ type: 'hr' }]);
  });

  it('parses a fenced code block verbatim', () => {
    expect(parseMarkdown('```\nconst x = 1\nx++\n```')).toEqual([{ type: 'code', text: 'const x = 1\nx++' }]);
  });

  it('does not treat ** inside a code fence as markdown', () => {
    const blocks = parseMarkdown('```\n**not bold**\n```');
    expect(blocks).toEqual([{ type: 'code', text: '**not bold**' }]);
  });

  it('parses a pipe table with header + separator + rows', () => {
    const md = '| Col A | Col B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    expect(parseMarkdown(md)).toEqual([
      { type: 'table', headers: ['Col A', 'Col B'], rows: [['1', '2'], ['3', '4']] },
    ]);
  });

  it('treats a pipe row with no separator as a paragraph (not a table)', () => {
    const blocks = parseMarkdown('| just | text |');
    expect(blocks[0].type).toBe('paragraph');
  });

  it('handles a realistic mixed document and resumes paragraphs after a table', () => {
    const md = '# Title\n\nintro line\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter';
    const types = parseMarkdown(md).map((b) => b.type);
    expect(types).toEqual(['heading', 'paragraph', 'table', 'paragraph']);
  });
});

describe('parseInline', () => {
  it('splits bold, code and links from surrounding text', () => {
    expect(parseInline('a **b** c `d` e [f](http://x)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', text: 'b' },
      { type: 'text', text: ' c ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' e ' },
      { type: 'link', text: 'f', href: 'http://x' },
    ]);
  });

  it('returns a single text token when there is no markup', () => {
    expect(parseInline('plain text')).toEqual([{ type: 'text', text: 'plain text' }]);
  });

  it('does not bold ** inside inline code', () => {
    expect(parseInline('`**x**`')).toEqual([{ type: 'code', text: '**x**' }]);
  });
});
