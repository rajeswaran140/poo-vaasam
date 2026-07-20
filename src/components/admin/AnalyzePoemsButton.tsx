'use client';

import { useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import showToast from '@/lib/toast';

interface AnalyzeResult {
  candidates: number;
  analyzed: { id: string; emotion: string }[];
  failed: { id: string }[];
  remaining: number;
}

/**
 * One-click backfill: precompute + store the emotion analysis on published
 * poems that don't have one yet (drives background music / TTS, so the reader
 * never spends a runtime LLM call). The stored analysis is baked into the
 * static poem pages on the NEXT deploy — until then the runtime fallback covers
 * un-baked poems, so this is safe to run anytime.
 */
export function AnalyzePoemsButton() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);

  async function run() {
    setRunning(true);
    try {
      const res = await adminFetch('/api/admin/content/analyze-poems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setResult(data as AnalyzeResult);
        const n = data.analyzed?.length ?? 0;
        const f = data.failed?.length ?? 0;
        if (n === 0 && f === 0) {
          showToast.success('All poems already analyzed — nothing to do.');
        } else {
          showToast.success(
            `Analyzed ${n} poem${n === 1 ? '' : 's'}${f ? `, ${f} failed` : ''}. Redeploy to publish.`
          );
        }
      } else {
        showToast.error(data.error || 'Analysis failed');
      }
    } catch (error) {
      console.error('Analyze poems failed:', error);
      showToast.error('Could not run analysis');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={running}
        title="Precompute emotion analysis for published poems (used by background music / TTS). Redeploy afterwards to bake it into the pages."
        className="px-4 py-3 bg-white dark:bg-gray-800 border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {running ? 'Analyzing…' : '🎭 Analyze poems'}
      </button>
      {result && (
        <p className="text-xs text-gray-500 dark:text-gray-400" role="status">
          {result.analyzed.length} analyzed
          {result.failed.length > 0 && `, ${result.failed.length} failed`}
          {`, ${result.remaining} still missing`} · redeploy to publish
        </p>
      )}
    </div>
  );
}
