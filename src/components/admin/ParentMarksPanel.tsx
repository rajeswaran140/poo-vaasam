'use client';
/**
 * The parent version's marks, shown on a child so a repair can be checked
 * off. Times are the PARENT's: a re-master with a different trim or a remix
 * moves every word, so these are listed, never drawn on this waveform.
 */
import { reasonLabel } from '@/lib/audition-marks';
import { parentMarksView, markTimeLabel, statusLabel, type NewMarkInput } from '@/lib/repair-marks';
import { lineageLabel } from '@/lib/master-lineage';
import type { LineageVia } from '@/types/masterJob';
import { useRepairMarks } from './useRepairMarks';

export function ParentMarksPanel({
  parent, masterJobId, onStillThere,
}: {
  parent: { jobId: string; via: LineageVia; title: string | null };
  masterJobId: string;
  onStillThere: (input: NewMarkInput) => void;
}) {
  const hook = useRepairMarks(parent.jobId);
  const heading = lineageLabel({ jobId: parent.jobId, via: parent.via }, parent.title);
  return (
    <div className="mt-2 rounded-lg border border-dashed border-gray-300 p-2 text-gray-500 dark:border-gray-700">
      <p className="text-[11px] font-medium">From the previous version — {heading}</p>
      <p className="text-[11px]">Times are the previous version&rsquo;s; a different trim or a remix moves them.</p>
      {hook.loadError && <p className="text-[11px] text-rose-600">{hook.loadError}</p>}
      {hook.notice && <p className="text-[11px] text-amber-700">{hook.notice}</p>}
      {hook.marks && hook.marks.length === 0 && <p className="text-[11px]">No marks on the previous version.</p>}
      {hook.marks && hook.marks.length > 0 && (
        <ul className="mt-1 divide-y divide-gray-100 dark:divide-gray-800">
          {parentMarksView(hook.marks).map((m) => {
            const label = markTimeLabel(m);
            return (
              <li key={m.markId} className="py-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">{label}</span>
                  <span>{reasonLabel(m.reason)}</span>
                  {m.note && <span className="text-gray-600 dark:text-gray-300">{m.note}</span>}
                  {m.status === 'open' ? (
                    <span className="ml-auto flex gap-2">
                      <button
                        type="button"
                        aria-label={`Fixed here — ${label}`}
                        onClick={() => void hook.update(m.markId, { status: 'fixed', fixedIn: masterJobId })}
                        className="rounded border border-emerald-400 px-1.5 py-0.5 text-emerald-700"
                      >
                        Fixed here
                      </button>
                      <button
                        type="button"
                        aria-label={`Still there — ${label}`}
                        onClick={() => onStillThere({ start: m.start, end: m.end, reason: m.reason, note: m.note })}
                        className="rounded border border-gray-300 px-1.5 py-0.5"
                      >
                        Still there
                      </button>
                    </span>
                  ) : (
                    <span className="ml-auto">{statusLabel(m.status)}</span>
                  )}
                </div>
                {hook.rowErrors[m.markId] && <p className="text-[11px] text-rose-600">{hook.rowErrors[m.markId]}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
