'use client';

/**
 * DocExport — export one admin doc as Markdown (.md download) or PDF (browser
 * print → "Save as PDF"). PDF is rendered into a hidden iframe so Tamil prints
 * correctly via the browser's fonts — no PDF library, no extra dependency.
 * All transform logic is pure in @/lib/doc-export.
 */

import { FileDown, Printer } from 'lucide-react';
import {
  docToMarkdown,
  buildDocPrintHtml,
  exportFilename,
  type ExportableDoc,
} from '@/lib/doc-export';

function downloadMarkdown(doc: ExportableDoc): void {
  const blob = new Blob([docToMarkdown(doc)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Use the slug (always file-safe) rather than the title, which may be all-Tamil.
  a.download = exportFilename(doc.slug, 'md');
  a.click();
  URL.revokeObjectURL(url);
}

function printPdf(doc: ExportableDoc): void {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 1000);
    }, 150);
  };
  iframe.srcdoc = buildDocPrintHtml(doc);
  document.body.appendChild(iframe);
}

const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700';

export function DocExport({ doc }: { doc: ExportableDoc }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => downloadMarkdown(doc)} className={btn} title="Download as Markdown">
        <FileDown className="h-3.5 w-3.5" aria-hidden /> .md
      </button>
      <button type="button" onClick={() => printPdf(doc)} className={btn} title="Export as PDF (Save as PDF in the print dialog)">
        <Printer className="h-3.5 w-3.5" aria-hidden /> PDF
      </button>
    </div>
  );
}
