import { toCsv, toMarkdownTable, toPrintableHtml, type ExportColumn } from '@/lib/data-export';

interface Row {
  name: string;
  views: number;
  note: string | null;
}

const columns: ExportColumn<Row>[] = [
  { header: 'Name', get: (r) => r.name },
  { header: 'Views', get: (r) => r.views },
  { header: 'Note', get: (r) => r.note },
];

const rows: Row[] = [
  { name: 'Appa Padal', views: 1200, note: 'emotional' },
  { name: 'Comma, quote "x"', views: 0, note: null },
];

describe('toCsv', () => {
  it('emits a header row plus one line per row', () => {
    const csv = toCsv(columns, rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Name,Views,Note');
    expect(lines).toHaveLength(3);
  });

  it('quotes/escapes commas and double-quotes, blanks nulls', () => {
    const csv = toCsv(columns, rows);
    expect(csv).toContain('"Comma, quote ""x""",0,');
  });

  it('returns just the header for an empty dataset', () => {
    expect(toCsv(columns, [])).toBe('Name,Views,Note');
  });
});

describe('toMarkdownTable', () => {
  it('builds a header, separator and body rows', () => {
    const md = toMarkdownTable(columns, rows);
    const lines = md.split('\n');
    expect(lines[0]).toBe('| Name | Views | Note |');
    expect(lines[1]).toBe('| --- | --- | --- |');
    expect(lines[2]).toBe('| Appa Padal | 1200 | emotional |');
    expect(lines[3]).toBe('| Comma, quote "x" | 0 |  |');
  });

  it('escapes pipe characters so the table stays intact', () => {
    const md = toMarkdownTable([{ header: 'X', get: (r: { x: string }) => r.x }], [{ x: 'a|b' }]);
    expect(md).toContain('a\\|b');
  });
});

describe('toPrintableHtml', () => {
  it('renders an escaped HTML table with the title', () => {
    const html = toPrintableHtml('Report <1>', columns, rows);
    expect(html).toContain('<title>Report &lt;1&gt;</title>');
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('<td>Appa Padal</td>');
    expect(html).toContain('<h1>Report &lt;1&gt;</h1>');
  });
});
