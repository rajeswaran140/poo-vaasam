// src/components/admin/RepairMarksPanel.tsx
'use client';
import { X } from 'lucide-react';
import { FAILURE_REASONS } from '@/types/generation';
import { reasonLabel, type MarkReason } from '@/lib/audition-marks';
import { MARK_STATUSES, markTimeLabel, statusLabel, type MarkStatus } from '@/lib/repair-marks';
import type { RepairMarksState } from './useRepairMarks';

export function RepairMarksPanel({ hook, onSeek }: { hook: RepairMarksState; onSeek: (t: number) => void }) {
  const { marks, pending, loadError, notice, rowErrors, update, remove, discardPending } = hook;
  const empty = (marks?.length ?? 0) === 0 && pending.length === 0;
  return (
    <>
      {loadError && <p className="mt-1 text-[11px] text-rose-600">{loadError}</p>}
      {notice && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{notice}</p>}
      {marks === null && !loadError && pending.length === 0 ? (
        <p className="mt-1 text-[11px] text-gray-500">Loading marks…</p>
      ) : empty && marks !== null ? (
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          Press <kbd>M</kbd> to mark a moment, or drag the waveform and press Save span. Marks are saved with this master.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
          {marks === null && !loadError && (
            <li className="py-1 text-[11px] text-gray-500">Loading marks…</li>
          )}
          {(marks ?? []).map((m) => {
            const label = markTimeLabel(m);
            return (
              <li key={m.markId} className="py-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => onSeek(m.start)} className="tabular-nums font-medium text-purple-700 hover:underline dark:text-purple-300">
                    {label}
                  </button>
                  <select
                    aria-label={`Reason for ${label}`}
                    value={m.reason}
                    onChange={(e) => void update(m.markId, { reason: e.target.value as MarkReason })}
                    className="rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-700 dark:bg-gray-900"
                  >
                    {FAILURE_REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
                  </select>
                  <select
                    aria-label={`Status for ${label}`}
                    value={m.status}
                    onChange={(e) => void update(m.markId, { status: e.target.value as MarkStatus })}
                    className="rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-700 dark:bg-gray-900"
                  >
                    {MARK_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                  <input
                    aria-label={`Note for ${label}`}
                    defaultValue={m.note}
                    maxLength={500}
                    placeholder="note"
                    onBlur={(e) => { if (e.target.value !== m.note) void update(m.markId, { note: e.target.value }); }}
                    className="min-w-0 grow rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-700 dark:bg-gray-900"
                  />
                  {m.note && <span className="sr-only">{m.note}</span>}
                  <button type="button" onClick={() => void remove(m.markId)} aria-label={`Remove mark at ${label}`} className="text-gray-400 hover:text-rose-600">
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
                {rowErrors[m.markId] && <p className="mt-0.5 text-[11px] text-rose-600">{rowErrors[m.markId]}</p>}
              </li>
            );
          })}
          {pending.map((p) => (
            <li key={p.tempId} className="py-1 text-xs">
              <div className="flex items-center gap-2 text-gray-500">
                <span className="tabular-nums">{markTimeLabel(p.input)}</span>
                <span>{reasonLabel(p.input.reason)}</span>
                {p.error ? (
                  <>
                    <span className="text-rose-600">{p.error}</span>
                    <button type="button" onClick={() => discardPending(p.tempId)} className="ml-auto underline">Discard</button>
                  </>
                ) : (
                  <span>saving…</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
