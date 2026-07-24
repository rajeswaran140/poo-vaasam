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
import { STREAMING_TARGETS, platformLanding } from '@/lib/loudness-targets';
import { sanitizeMasterFilename } from '@/lib/mastering-storage';

const lufs = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(1)} LUFS` : '—');
const dbtp = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(2)} dBTP` : '—');

/** Platforms that normalise at this target, for the header (e.g. "Spotify, YouTube"). */
export function platformsForTarget(target: number): string {
  const names = STREAMING_TARGETS.filter((t) => t.lufs === target).map((t) => t.platform);
  return names.length ? names.join(', ') : 'custom target';
}

const isOnTarget = (job: MasterJob) => typeof job.afterLufs === 'number' && Math.abs(job.afterLufs - job.target) <= 1;
const isPeakSafe = (job: MasterJob) => typeof job.afterTp === 'number' && job.afterTp <= -1;

/** The verdict line: did the master land on its target, and is it peak-safe? */
function verdictLine(job: MasterJob): string {
  if (typeof job.afterLufs !== 'number') {
    return 'Master written, but the check measurement did not return — verify before use.';
  }
  const peakSafe = typeof job.afterTp !== 'number' || job.afterTp <= -1;
  const loud = isOnTarget(job) ? `on target (${job.target} LUFS)` : `${(job.afterLufs - job.target).toFixed(1)} LU off target`;
  const peak = peakSafe ? 'peak-safe' : 'true peak above -1 dBTP — check for clipping';
  return `${loud}, ${peak}.`;
}

/**
 * A pass/fail checklist for a glance before the numbers. Each line reflects the
 * job's actual state — it never claims "ready" for an off-target or clipping
 * master.
 */
export function summaryLines(job: MasterJob): string[] {
  const measured = typeof job.afterLufs === 'number';
  const onTarget = isOnTarget(job);
  const peakReported = typeof job.afterTp === 'number';
  const peakSafe = isPeakSafe(job);

  const loud = !measured
    ? '⚠ Loudness not confirmed — the check pass did not return; verify before use'
    : onTarget
      ? `✓ Streaming ready — mastered to ${job.target} LUFS`
      : `⚠ Off target — measured ${lufs(job.afterLufs)} against ${job.target} LUFS; verify before use`;

  const peak = !peakReported
    ? '• True peak not reported'
    : peakSafe
      ? `✓ Peak-safe — true peak ${dbtp(job.afterTp)} (within -1 dBTP)`
      : `✗ True peak ${dbtp(job.afterTp)} exceeds -1 dBTP — check for clipping`;

  const ready =
    measured && onTarget && peakSafe
      ? '✓ Ready for streaming, video editing and distribution'
      : '⚠ Review the flags above before distributing';

  return [loud, peak, '✓ Loudness only — tone, EQ and compression unchanged', ready];
}

/**
 * Wall-clock from enqueue (createdAt) to completion (updatedAt) — how long the
 * operator waited. Omitted (null) if either stamp is unparseable or the delta is
 * implausible, so the report never prints a misleading number.
 */
export function turnaroundLabel(createdAt: string, updatedAt: string): string | null {
  const start = Date.parse(createdAt);
  const end = Date.parse(updatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const secs = Math.round((end - start) / 1000);
  if (secs < 0 || secs > 60 * 60) return null; // Lambda budget is 15 min; beyond an hour is noise
  return secs < 90 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/**
 * "Master once → what happens everywhere" — how the mastered loudness lands on
 * each streaming platform, grouped by target. Empty when the output wasn't
 * measured (no honest number to compare against).
 */
export function platformLandingLines(job: MasterJob): string[] {
  if (typeof job.afterLufs !== 'number') return [];
  const rows = platformLanding(job.afterLufs).map((r) => {
    const platforms = r.platforms.join(', ');
    return `  ${r.mark}  ${`${r.target} LUFS`.padEnd(9)} ${platforms.padEnd(38)} ${r.note}`;
  });
  return [`Streaming readiness (master at ${lufs(job.afterLufs)})`, ...rows, ''];
}

/**
 * Render the report. `title` is the admin's optional master name; when given it
 * heads the report and names the download.
 */
export function buildMasterReport(job: MasterJob, title?: string): string {
  const name = title?.trim();
  const turnaround = turnaroundLabel(job.createdAt, job.updatedAt);
  const lines = [
    'TamilAgaval — Streaming Master',
    '==============================',
    '',
    'Summary',
    ...summaryLines(job).map((l) => `  ${l}`),
    '',
    ...(name ? [`Title:              ${name}`] : []),
    `Target:             ${job.target} LUFS  (${platformsForTarget(job.target)})`,
    `Job ID:             ${job.id}`,
    `Mastered:           ${job.updatedAt}${turnaround ? `  (turnaround ${turnaround})` : ''}`,
    '',
    'Integrated loudness',
    `  Before:           ${lufs(job.beforeLufs)}`,
    `  After:            ${lufs(job.afterLufs)}`,
    'True peak',
    `  Before:           ${dbtp(job.beforeTp)}`,
    `  After:            ${dbtp(job.afterTp)}`,
    '',
    ...platformLandingLines(job),
    `Result:             ${verdictLine(job)}`,
    ...(isPeakSafe(job) ? ['                    No clipping detected — no extra limiting needed.'] : []),
    '',
    'Processing           Two-pass loudnorm, linear correction — loudness only.',
    '  ✓ Loudness normalised to target',
    '  · No EQ   · No compression   · No stereo widening   · No limiting',
    '',
    'Adobe hand-off',
    '  1. Import at 48 kHz, untouched.',
    '  2. Disable Essential Sound "Auto-Match".',
    '  3. Disable loudness normalisation on export.',
    '  4. Export PCM or high-bitrate AAC — no added gain.',
    '  (any of these re-levels the audio and cancels this master.)',
    '',
  ];
  return lines.join('\n');
}

/** Filename for the saved report, derived from the master title (or "master"). */
export function reportFilename(title?: string): string {
  const base = sanitizeMasterFilename(title?.trim() || 'master').replace(/\.wav$/i, '');
  return `${base} — master report.txt`;
}
