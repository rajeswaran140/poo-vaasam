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
const lu = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(1)} LU` : '—');

/** Inline "(unchanged)" marker — the whole point of printing LRA twice. */
function lraNote(job: MasterJob): string {
  if (typeof job.beforeLra !== 'number' || typeof job.afterLra !== 'number') return '';
  return dynamicsPreserved(job) ? '   ← unchanged' : '   ← CHANGED';
}

/** Platforms that normalise at this target, for the header (e.g. "Spotify, YouTube"). */
export function platformsForTarget(target: number): string {
  const names = STREAMING_TARGETS.filter((t) => t.lufs === target).map((t) => t.platform);
  return names.length ? names.join(', ') : 'custom target';
}

const isOnTarget = (job: MasterJob) => typeof job.afterLufs === 'number' && Math.abs(job.afterLufs - job.target) <= 1;
const isPeakSafe = (job: MasterJob) => typeof job.afterTp === 'number' && job.afterTp <= -1;

/**
 * The verdict line: did the master land on its target, and is it peak-safe?
 *
 * An unreported true peak is its OWN outcome, never "peak-safe". This report is
 * the evidence that travels to a distributor, so claiming a safety check that
 * did not happen is the one thing it must not do — and the Summary block above
 * already says "not reported" for the same job, so asserting it here contradicted
 * the very same file.
 */
function verdictLine(job: MasterJob): string {
  if (typeof job.afterLufs !== 'number') {
    return 'Master written, but the check measurement did not return — verify before use.';
  }
  const loud = isOnTarget(job) ? `on target (${job.target} LUFS)` : `${(job.afterLufs - job.target).toFixed(1)} LU off target`;
  const peak =
    typeof job.afterTp !== 'number'
      ? 'true peak not reported — verify before use'
      : isPeakSafe(job)
        ? 'peak-safe'
        : 'true peak above -1 dBTP — check for clipping';
  return `${loud}, ${peak}.`;
}

/** "24-bit · 48 kHz · stereo · 3:42" — whatever of it is known. */
export function sourceInfoLine(job: MasterJob): string | null {
  const s = job.source;
  if (!s) return null;
  const parts: string[] = [];
  if (s.bitDepth) parts.push(`${s.bitDepth}-bit`);
  if (s.sampleRate) parts.push(`${(s.sampleRate / 1000).toFixed(s.sampleRate % 1000 ? 1 : 0)} kHz`);
  if (s.channelLayout) parts.push(s.channelLayout);
  if (typeof s.durationSec === 'number') {
    const total = Math.round(s.durationSec);
    parts.push(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/**
 * The single glanceable verdict shown at the top of the Studio result panel AND
 * derived from the same rules as the saved .txt report, so the screen and the
 * file can never disagree.
 *
 * This exists because the Studio's own `verdict` only compared loudness to
 * target — a master that landed on -14 LUFS while clipping above -1 dBTP still
 * showed a green tick, while the report it downloaded said "check for
 * clipping". Readiness needs ALL THREE: on target, peak-safe, and dynamics
 * preserved.
 */
export interface Readiness {
  ok: boolean;
  headline: string;
  /** Compact facts line: loudness · peak · range · output format. */
  facts: string;
}

export function streamingReadiness(job: MasterJob): Readiness {
  const measured = typeof job.afterLufs === 'number';
  const onTarget = isOnTarget(job);
  const peakSafe = isPeakSafe(job);
  const dyn = dynamicsPreserved(job);

  const facts = [
    lufs(job.afterLufs),
    dbtp(job.afterTp),
    typeof job.afterLra === 'number'
      ? `LRA ${job.afterLra.toFixed(1)}${dyn ? ' unchanged' : ''}`
      : null,
    '24-bit/48 kHz',
  ].filter(Boolean).join(' · ');

  if (!measured) {
    return { ok: false, headline: 'Loudness not confirmed — the check pass did not return', facts };
  }
  if (!onTarget) {
    return {
      ok: false,
      headline: `Review before distributing — measured ${lufs(job.afterLufs)} against ${job.target} LUFS`,
      facts,
    };
  }
  if (!peakSafe) {
    // The case the old green tick got wrong.
    return {
      ok: false,
      headline: `Review before distributing — true peak ${dbtp(job.afterTp)} exceeds -1 dBTP`,
      facts,
    };
  }
  return { ok: true, headline: 'Streaming Ready', facts };
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

  return [loud, peak, dynamicsLine(job), ready];
}

/** Largest LRA drift still attributable to measurement rounding, not compression. */
export const LRA_TOLERANCE_LU = 0.5;

/**
 * True when the master demonstrably kept the source's dynamics. Exported so the
 * Studio badge and the .txt report are driven by ONE rule — a UI that said
 * "unchanged" while the report warned would be worse than showing neither.
 */
export function dynamicsPreserved(job: MasterJob): boolean {
  if (job.normalizationType === 'dynamic') return false;
  if (typeof job.beforeLra !== 'number' || typeof job.afterLra !== 'number') return false;
  return Math.abs(job.afterLra - job.beforeLra) <= LRA_TOLERANCE_LU;
}

/**
 * The "loudness only, never tone" claim — PROVEN per file rather than asserted.
 *
 * This line used to read "✓ Loudness only — tone, EQ and compression unchanged"
 * unconditionally, on every report. The intent was right (pass 2 requests
 * `linear=true`, a single static gain that cannot alter dynamics) but nothing
 * checked it, and ffmpeg silently downgrades to dynamic mode — which DOES
 * compress — when the linear gain would breach the true-peak ceiling. So on
 * exactly the hot sources where it matters most, the report could have promised
 * something untrue.
 *
 * Now it reports what happened: loudness range in vs out. A static gain moves
 * every sample equally, so LRA must survive unchanged; if it moved, something
 * compressed.
 */
export function dynamicsLine(job: MasterJob): string {
  const before = job.beforeLra;
  const after = job.afterLra;
  const haveLra = typeof before === 'number' && typeof after === 'number';

  if (job.normalizationType === 'dynamic') {
    return haveLra
      ? `⚠ Dynamic normalization — ffmpeg could not apply a linear gain without clipping, so range WAS compressed (LRA ${before.toFixed(1)} → ${after.toFixed(1)} LU). Tone is not preserved on this master.`
      : '⚠ Dynamic normalization — range was compressed; tone is not preserved on this master.';
  }
  if (!haveLra) {
    // Jobs mastered before LRA capture. Say so rather than claim the check ran.
    return '• Dynamics not recorded for this job — re-master to capture loudness range.';
  }
  const drift = Math.abs(after - before);
  return drift <= LRA_TOLERANCE_LU
    ? `✓ Loudness only — dynamics preserved: loudness range ${before.toFixed(1)} → ${after.toFixed(1)} LU (no compression, no EQ)`
    : `⚠ Loudness range moved ${drift.toFixed(1)} LU (${before.toFixed(1)} → ${after.toFixed(1)}) — larger than measurement rounding; inspect before distributing.`;
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
    ...(sourceInfoLine(job) ? [`Source file:        ${sourceInfoLine(job)}`] : []),
    'Output file:        24-bit · 48 kHz WAV',
    '',
    'Integrated loudness',
    `  Before:           ${lufs(job.beforeLufs)}`,
    `  After:            ${lufs(job.afterLufs)}`,
    'True peak',
    `  Before:           ${dbtp(job.beforeTp)}`,
    `  After:            ${dbtp(job.afterTp)}`,
    'Loudness range (LRA)',
    `  Before:           ${lu(job.beforeLra)}`,
    `  After:            ${lu(job.afterLra)}${lraNote(job)}`,
    '',
    ...platformLandingLines(job),
    `Result:             ${verdictLine(job)}`,
    ...(isPeakSafe(job) ? ['                    No clipping detected — no extra limiting needed.'] : []),
    '',
    // Reflects what ran, not what was requested — see dynamicsLine().
    job.normalizationType === 'dynamic'
      ? 'Processing           Two-pass loudnorm, DYNAMIC fallback — range was compressed.'
      : 'Processing           Two-pass loudnorm, linear correction — loudness only.',
    '  ✓ Loudness normalised to target',
    job.normalizationType === 'dynamic'
      ? '  · No EQ   · No stereo widening   ⚠ Range compressed (linear gain would have clipped)'
      : '  · No EQ   · No compression   · No stereo widening   · No limiting',
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
