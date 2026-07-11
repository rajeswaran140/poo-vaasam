/**
 * Pure dataset serializers shared by the admin DataToolbar (Copy / CSV / PDF).
 *
 * A section describes its data as columns (header + a `get` accessor) and its
 * rows; these turn that into:
 *   - CSV        (download)
 *   - a Markdown table (clipboard — pastes cleanly into an AI chat for review)
 *   - printable HTML   (opened in a window → browser "Save as PDF")
 *
 * Framework-free + unit-tested so the toolbar stays a thin shell.
 */

export interface ExportColumn<T> {
  header: string;
  get: (row: T) => string | number | null | undefined;
}

const cell = (v: string | number | null | undefined): string => (v == null ? '' : String(v));

export function toCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = columns.map((c) => esc(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(cell(c.get(r)))).join(',')).join('\n');
  return body ? `${head}\n${body}` : head;
}

/** Markdown table — the "copy for AI review" format. */
export function toMarkdownTable<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = `| ${columns.map((c) => esc(c.header)).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${columns.map((c) => esc(cell(c.get(r)))).join(' | ')} |`).join('\n');
  return body ? `${head}\n${sep}\n${body}` : `${head}\n${sep}`;
}

export function toPrintableHtml<T>(title: string, columns: ExportColumn<T>[], rows: T[]): string {
  const escH = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const th = columns.map((c) => `<th>${escH(c.header)}</th>`).join('');
  const trs = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${escH(cell(c.get(r)))}</td>`).join('')}</tr>`)
    .join('');
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${escH(title)}</title>` +
    `<style>body{font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#111}` +
    `h1{font-size:16px;margin:0 0 12px}table{border-collapse:collapse;width:100%;font-size:12px}` +
    `th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f3f4f6}</style>` +
    `</head><body><h1>${escH(title)}</h1>` +
    `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></body></html>`
  );
}
