'use client';

/**
 * PromptExport — export a chosen brief variant as a generator-ready pack (organised by
 * the generator's custom-mode fields) in Markdown or PDF. Markdown is a direct download;
 * PDF is print-rendered in a hidden iframe so Tamil renders correctly via the
 * browser's fonts (no heavy font-embed, no extra dependency).
 */

import { useMemo, useState } from 'react';
import { Copy, Check, FileDown, Printer } from 'lucide-react';
import { buildExportPack, exportPackToMarkdown, exportFilename, type ExportPack } from '@/lib/prompt-export';
import type { ComposerAnalysis } from '@/services/ai/composer';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function printPack(pack: ExportPack): void {
  const section = (title: string, body: string) =>
    `<h2>${escapeHtml(title)}</h2><pre>${escapeHtml(body || '—')}</pre>`;
  const html = `<!doctype html><html lang="ta"><head><meta charset="utf-8"><title>${escapeHtml(pack.title)}</title>
<style>
  body{font-family:'Noto Sans Tamil','Latha','Baloo Thambi 2',system-ui,sans-serif;margin:32px;color:#111;line-height:1.6}
  h1{font-size:22px;margin:0 0 2px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#7c3aed;margin:20px 0 6px;border-bottom:1px solid #eee;padding-bottom:4px}
  pre{white-space:pre-wrap;font-family:inherit;margin:0}
  .meta{color:#666;font-size:12px;margin-bottom:12px}
</style></head><body>
<h1>${escapeHtml(pack.title)}</h1>
<div class="meta">Tamilagaval pack — style: ${escapeHtml(pack.styleName || '—')}</div>
${section('🎤 Lyrics', pack.lyrics)}
${section('🎚️ Style of Music', pack.style)}
${section('🚫 Exclude Styles', pack.excludeStyles)}
${section('🎛️ Weirdness', `${pack.weirdnessPct}%  (recommended — adjust to taste)`)}
${section('🌟 Style Influence', `${pack.styleInfluencePct}%  (recommended — adjust to taste)`)}
</body></html>`;

  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 1000);
    }, 150);
  };
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}

export function PromptExport({
  result,
  lyrics,
  selectedIdx,
  onSelectIdx,
}: {
  result: ComposerAnalysis;
  lyrics: string;
  selectedIdx: number;
  onSelectIdx: (i: number) => void;
}) {
  const variants = useMemo(() => result.suno_prompts ?? [], [result.suno_prompts]);
  const [copied, setCopied] = useState(false);

  const pack = useMemo(() => {
    const v = variants[selectedIdx];
    if (!v) return null;
    return buildExportPack({
      title: result.song_titles?.[0] ?? 'Untitled',
      lyrics,
      styleName: v.style,
      stylePrompt: v.prompt,
      mood: result.mood,
      theme: result.theme,
      // Structured direction the brief already computed — without these the
      // style box got only the model's prose paragraph, and the recommended
      // VOICE never reached the generator at all.
      bpm: result.suggested_bpm,
      key: result.suggested_key,
      instruments: result.suggested_instruments,
      ragas: result.suggested_ragas,
      voice: result.recommended_voice,
    });
  }, [
    variants, selectedIdx, lyrics, result.song_titles, result.mood, result.theme,
    // The structured direction feeds the style anchor — omitting these would
    // serve a stale pack (old BPM/voice) after switching to another brief.
    result.suggested_bpm, result.suggested_key, result.suggested_instruments,
    result.suggested_ragas, result.recommended_voice,
  ]);

  if (!pack) return null;

  const markdown = exportPackToMarkdown(pack);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the download buttons still work */
    }
  };

  const downloadMd = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename(pack.title, 'md');
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">Export for Tamilagaval</span>
        <select
          value={selectedIdx}
          onChange={(e) => onSelectIdx(Number(e.target.value))}
          className="rounded-lg border border-purple-300 bg-white px-2 py-1 text-xs dark:border-purple-700 dark:bg-gray-800 dark:text-gray-100"
          aria-label="Style variant to export"
        >
          {variants.map((v, i) => (
            <option key={i} value={i}>{v.style}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-purple-300 bg-white px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-gray-800 dark:text-purple-300">
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy .md'}
          </button>
          <button type="button" onClick={downloadMd} className="inline-flex items-center gap-1.5 rounded-lg border border-purple-300 bg-white px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-gray-800 dark:text-purple-300">
            <FileDown className="h-3.5 w-3.5" /> .md
          </button>
          <button type="button" onClick={() => printPack(pack)} className="inline-flex items-center gap-1.5 rounded-lg border border-purple-300 bg-white px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-gray-800 dark:text-purple-300">
            <Printer className="h-3.5 w-3.5" /> PDF
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-purple-700/80 dark:text-purple-300/70">
        Packs Lyrics · Style · Exclude Styles · Weirdness · Style Influence into one file. PDF opens your print dialog → choose “Save as PDF”.
      </p>
    </div>
  );
}
