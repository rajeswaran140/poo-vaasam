/**
 * A plain-text mastering report the admin can save next to the exported WAV.
 * Pure — no I/O, no Date (the timestamp comes from the job) — so it is fully
 * testable and deterministic.
 *
 * Everything here is already shown in the Studio after a job; the value is a
 * portable record that travels with the file into Adobe / DistroKid, documenting
 * exactly what was (and was NOT) done: loudness normalisation only, tone left
 * alone. Nothing here re-derives audio — it only formats the worker's own
 * measurements.
 */

import type { MasterJob } from '@/types/masterJob';
import { STREAMING_TARGETS } from '@/lib/loudness-targets';
import { sanitizeMasterFilename } from '@/lib/mastering-storage';

const lufs = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(1)} LUFS` : '—');
const dbtp = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(2)} dBTP` : '—');

/** Platforms that normalise at this target, for the header (e.g. "Spotify, YouTube"). */
export function platformsForTarget(target: number): string {
  const names = STREAMING_TARGETS.filter((t) => t.lufs === target).map((t) => t.platform);
  return names.length ? names.join(', ') : 'custom target';
}

/** The verdict line: did the master land on its target, and is it peak-safe? */
function verdictLine(job: MasterJob): string {
  if (typeof job.afterLufs !== 'number') {
    return 'Master written, but the check measurement did not return — verify before use.';
  }
  const onTarget = Math.abs(job.afterLufs - job.target) <= 1;
  const peakSafe = typeof job.afterTp !== 'number' || job.afterTp <= -1;
  const loud = onTarget ? `on target (${job.target} LUFS)` : `${(job.afterLufs - job.target).toFixed(1)} LU off target`;
  const peak = peakSafe ? 'peak-safe' : 'true peak above -1 dBTP — check for clipping';
  return `${loud}, ${peak}.`;
}

/**
 * Render the report. `title` is the admin's optional master name; when given it
 * heads the report and names the download.
 */
export function buildMasterReport(job: MasterJob, title?: string): string {
  const name = title?.trim();
  const lines = [
    'TamilAgaval — Streaming Master',
    '==============================',
    '',
    ...(name ? [`Title:              ${name}`] : []),
    `Target:             ${job.target} LUFS  (${platformsForTarget(job.target)})`,
    `Mastered:           ${job.updatedAt}`,
    '',
    'Integrated loudness',
    `  Before:           ${lufs(job.beforeLufs)}`,
    `  After:            ${lufs(job.afterLufs)}`,
    'True peak',
    `  Before:           ${dbtp(job.beforeTp)}`,
    `  After:            ${dbtp(job.afterTp)}`,
    '',
    `Result:             ${verdictLine(job)}`,
    '',
    'Processing:         Loudness normalisation only (two-pass loudnorm, linear).',
    'Tone / EQ / Comp:   Unchanged.',
    '',
    'Hand-off: import untouched at 48 kHz; disable any "Auto-Match"/normalisation',
    'on export, or it re-levels the audio and cancels this master.',
    '',
  ];
  return lines.join('\n');
}

/** Filename for the saved report, derived from the master title (or "master"). */
export function reportFilename(title?: string): string {
  const base = sanitizeMasterFilename(title?.trim() || 'master').replace(/\.wav$/i, '');
  return `${base} — master report.txt`;
}
