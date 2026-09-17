'use client';

/**
 * What the two parts measured, and what to set.
 *
 * Long lyrics force a song into two separate Suno generations, and nothing
 * makes those share a key, a tempo or a tonal balance. Before this, the only
 * adjustable thing in the join panel was the crossfade — which is the one part
 * that was already correct — so a mismatch in any of the other three sent the
 * operator tuning the wrong control.
 *
 * ⚠️ IT ADVISES. Beat detection on melodic material is genuinely uncertain, and
 * a suggestion presented as an answer gets believed. Low-confidence tempo is
 * marked as such, and the copy says "starting point" rather than stating it as
 * fact.
 */

import { Check, AlertTriangle, Scissors } from 'lucide-react';
import type { PartComparison } from '@/lib/part-analysis';

const hz = (v: number) => (v > 0 ? `${Math.round(v)} Hz` : '—');
const bpm = (t: PartComparison['a']['tempo']) =>
  t ? `${t.bpm.toFixed(1)} BPM${t.confidence < 0.4 ? '?' : ''}` : '—';

export function PartComparisonPanel({
  comparison,
  onApply,
}: {
  comparison: PartComparison;
  /** Put the suggested numbers into the join fields. */
  onApply?: (s: { partBStartSec: number; overlapSec: number }) => void;
}) {
  const { a, b, findings, suggestion } = comparison;
  const uncertain = (a.tempo && a.tempo.confidence < 0.4) || (b.tempo && b.tempo.confidence < 0.4);

  return (
    <div className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left text-gray-500 dark:text-gray-400">
            <th className="font-medium">part</th>
            <th className="font-medium">at the join</th>
            <th className="font-medium">tempo</th>
            <th className="font-medium">brightness</th>
          </tr>
        </thead>
        <tbody className="text-gray-800 dark:text-gray-100">
          <tr>
            <td className="pr-3 font-medium">A</td>
            <td className="pr-3">{a.edgeLufs === null ? '—' : `${a.edgeLufs.toFixed(1)} LUFS`}</td>
            <td className="pr-3">{bpm(a.tempo)}</td>
            <td>{hz(a.centroidHz)}</td>
          </tr>
          <tr>
            <td className="pr-3 font-medium">B</td>
            <td className="pr-3">{b.edgeLufs === null ? '—' : `${b.edgeLufs.toFixed(1)} LUFS`}</td>
            <td className="pr-3">{bpm(b.tempo)}</td>
            <td>{hz(b.centroidHz)}</td>
          </tr>
        </tbody>
      </table>

      <ul className="mt-3 space-y-1">
        {findings.map((f) => (
          <li
            key={f.id}
            className={
              f.level === 'warn'
                ? 'flex items-start gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300'
                : 'flex items-start gap-1.5 text-xs text-gray-600 dark:text-gray-300'
            }
          >
            {f.level === 'warn'
              ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              : <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />}
            {f.text}
          </li>
        ))}
      </ul>

      {suggestion && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
          <Scissors className="h-3 w-3 text-gray-500" aria-hidden="true" />
          <span className="text-xs text-gray-700 dark:text-gray-200">
            Try <strong>Part B starts at {suggestion.partBStartSec}</strong> and{' '}
            <strong>crossfade {suggestion.overlapSec}</strong> — {suggestion.reason}.
          </span>
          {onApply && (
            <button
              type="button"
              onClick={() => onApply({ partBStartSec: suggestion.partBStartSec, overlapSec: suggestion.overlapSec })}
              className="rounded border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
            >
              Use these
            </button>
          )}
        </div>
      )}

      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        A starting point for your ears, not an answer
        {uncertain && ' — and the tempo reading here is uncertain, so treat it lightly'}. Press{' '}
        <strong>Hear the seam</strong> after changing anything.
      </p>
    </div>
  );
}
