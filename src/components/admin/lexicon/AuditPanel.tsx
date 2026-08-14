'use client';

/**
 * AUDIT LEXICON — shows what is wrong with the data and proposes fixes.
 *
 * ⚠️ NOTHING HERE IS AUTOMATIC. There is no "fix all" and no delete: each
 * finding offers, at most, a one-click application of ONE proposed patch to ONE
 * entry, and the destructive-looking findings (duplicates) offer nothing but a
 * link to look at them. Raj's instruction was explicit — *"Never automatically
 * delete entries. Show proposed corrections for review."*
 *
 * The expected first run on the live lexicon is ~1,046 `suspicious-sangam`
 * findings, so the UI leads with the counts and keeps the list collapsed by
 * severity; a flat wall of a thousand rows would be unreadable and would bury
 * the handful of genuinely broken entries underneath it.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/lib/client-auth';

interface Finding {
  code: string;
  severity: 'high' | 'medium' | 'low';
  ids: string[];
  words: string[];
  message: string;
  proposal: Record<string, unknown> | null;
}

interface Report {
  total: number;
  countsByCode: Record<string, number>;
  countsBySeverity: Record<string, number>;
  findings: Finding[];
  truncated: boolean;
  totalFindings: number;
}

const SEVERITY_STYLE: Record<string, string> = {
  high: 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30',
  medium: 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
  low: 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/40',
};

/** Findings shown at once. The rest stay behind "show more". */
const PAGE = 25;

export function AuditPanel({ onApplied }: { onApplied: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [filterCode, setFilterCode] = useState('');
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const run = async () => {
    setBusy(true);
    setShown(PAGE);
    try {
      const res = await adminFetch('/api/admin/lexicon/audit');
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || 'Failed');
      setReport(d);
      setApplied(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Audit failed');
    } finally {
      setBusy(false);
    }
  };

  const applyProposal = async (f: Finding) => {
    if (!f.proposal || f.ids.length !== 1) return;
    const id = f.ids[0];
    const res = await adminFetch(`/api/admin/lexicon/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(f.proposal),
    });
    if (res.ok) {
      setApplied((p) => new Set(p).add(`${f.code}:${id}`));
      toast.success('Applied');
      onApplied();
    } else {
      toast.error('Could not apply');
    }
  };

  const visible = (report?.findings ?? []).filter((f) => !filterCode || f.code === filterCode);

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">🩺 Audit lexicon</span>
        <button
          onClick={run}
          disabled={busy}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {busy ? 'Checking…' : 'Run audit'}
        </button>
        {report && (
          <span className="text-xs text-gray-500">
            {report.totalFindings} findings across {report.total} words ·{' '}
            <span className="text-red-600">{report.countsBySeverity.high ?? 0} high</span>,{' '}
            <span className="text-amber-600">{report.countsBySeverity.medium ?? 0} medium</span>,{' '}
            {report.countsBySeverity.low ?? 0} low
          </span>
        )}
      </div>

      {report && (
        <>
          {/* Counts first: on this lexicon the headline IS the count. */}
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setFilterCode('')}
              className={`rounded-full px-2 py-0.5 text-xs ${!filterCode ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
            >
              all
            </button>
            {Object.entries(report.countsByCode)
              .sort((a, b) => b[1] - a[1])
              .map(([code, n]) => (
                <button
                  key={code}
                  onClick={() => {
                    setFilterCode(code);
                    setShown(PAGE);
                  }}
                  className={`rounded-full px-2 py-0.5 text-xs ${filterCode === code ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                >
                  {code} {n}
                </button>
              ))}
          </div>

          {report.truncated && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Showing the first {report.findings.length} of {report.totalFindings} findings — fix some and re-run.
            </p>
          )}

          <ul className="space-y-1">
            {visible.slice(0, shown).map((f, i) => {
              const key = `${f.code}:${f.ids[0]}:${i}`;
              const wasApplied = applied.has(`${f.code}:${f.ids[0]}`);
              return (
                <li key={key} className={`rounded-md border px-3 py-2 text-xs ${SEVERITY_STYLE[f.severity]}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-gray-700 dark:text-gray-200">{f.message}</span>
                    {f.proposal && f.ids.length === 1 && (
                      <button
                        onClick={() => applyProposal(f)}
                        disabled={wasApplied}
                        className="shrink-0 rounded border border-gray-400 px-2 py-0.5 text-[11px] hover:bg-white disabled:opacity-50 dark:border-gray-500 dark:hover:bg-gray-900"
                      >
                        {wasApplied ? 'applied' : `apply: ${Object.entries(f.proposal).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`}
                      </button>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">{f.code}</div>
                </li>
              );
            })}
          </ul>

          {visible.length > shown && (
            <button
              onClick={() => setShown((s) => s + PAGE)}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs dark:border-gray-600"
            >
              Show {Math.min(PAGE, visible.length - shown)} more ({visible.length - shown} left)
            </button>
          )}
        </>
      )}
    </div>
  );
}
