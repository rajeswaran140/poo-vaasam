'use client';

/**
 * DataToolbar — Copy (for AI review) · CSV · PDF for any admin dataset.
 *
 * A section passes its columns + rows; this renders three buttons:
 *   - Copy : Markdown table → clipboard (pastes cleanly into an AI chat)
 *   - CSV  : downloads a .csv
 *   - PDF  : opens a printable window → browser "Save as PDF" (no dependency)
 *
 * Renders nothing for an empty dataset.
 */

import { useState } from 'react';
import { toCsv, toMarkdownTable, toPrintableHtml, type ExportColumn } from '@/lib/data-export';

const BTN =
  'rounded-md border border-gray-300 dark:border-gray-700 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800';

export function DataToolbar<T>({
  title,
  filename,
  columns,
  rows,
}: {
  title: string;
  filename: string;
  columns: ExportColumn<T>[];
  rows: T[];
}) {
  const [copied, setCopied] = useState(false);

  async function copyForAI() {
    try {
      await navigator.clipboard.writeText(`### ${title}\n\n${toMarkdownTable(columns, rows)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  function downloadCsv() {
    const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printPdf() {
    const w = window.open('', '_blank');
    if (!w) return; // popup blocked
    w.document.write(toPrintableHtml(title, columns, rows));
    w.document.close();
    w.focus();
    w.print();
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={copyForAI} className={BTN} title="Copy as Markdown (for AI review)">
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
      <button type="button" onClick={downloadCsv} className={BTN} title="Download CSV">
        CSV
      </button>
      <button type="button" onClick={printPdf} className={BTN} title="Print / Save as PDF">
        PDF
      </button>
    </div>
  );
}
