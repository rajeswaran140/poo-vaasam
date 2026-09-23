/**
 * Checking that the render did not touch the audio.
 *
 * WHY THIS EXISTS. Until now the render wrote an MP4, recorded its key, and
 * that was the end of it. Nothing measured the result — not its duration, not
 * its sample rate, not its loudness — so a video stage that quietly resampled,
 * re-levelled or truncated the song would produce a file that looked finished,
 * sat in the library like any other, and was uploaded to YouTube by hand. The
 * first evidence would have been a listener.
 *
 * The rule this defends is the operator's, stated plainly: the mastered WAV is
 * the authority, and visual processing must never normalize, compress, limit,
 * EQ, re-pan, resample or re-time it. This module is how that stops being a
 * matter of discipline and starts being a matter of record.
 *
 * ⚠️ TWO DIFFERENCES ARE EXPECTED AND ARE NOT FAULTS. The upload is AAC, not
 * PCM, so:
 *   - AAC carries encoder delay and padding; the coded stream can run a little
 *     longer than the PCM that went in.
 *   - Lossy coding moves sample values slightly, which can push INTER-SAMPLE
 *     peaks up. A true peak a little above the master's is normal behaviour.
 * Everything else — a changed sample rate, a lost channel, a loudness shift, a
 * squeezed loudness range — means something processed the audio, and that is
 * exactly what this is looking for.
 *
 * Pure and I/O-free, like the planners: this compares two measurements and
 * decides what they mean. The worker takes them.
 */

/**
 * Tolerances.
 *
 * ⚠️ THESE ARE MEASURED, NOT CHOSEN. A guessed tolerance fails in both
 * directions — too tight and every good render is flagged until the operator
 * learns to ignore it, too loose and the check never fires at all.
 *
 * Measured 2026-09-22 against a known-good render of a pink-noise master
 * loudnormed to -14 LUFS / -1.5 dBTP, through the real compose + encode path:
 *
 *     duration     +0.00 s
 *     LUFS         -0.10 LU
 *     true peak    -0.10 dB
 *     LRA          +0.00 LU
 *     sample rate  unchanged
 *     channels     unchanged
 *
 * Every limit below is at least five times the observed difference, so a
 * passing render is not near the edge of anything — which is what makes a
 * failure worth believing.
 */
export const DURATION_TOLERANCE_SEC = 0.5;
export const LUFS_TOLERANCE_LU = 0.5;
/** Lossy coding can RAISE inter-sample peaks. Asymmetric on purpose. */
export const TRUE_PEAK_RISE_LIMIT_DB = 1;
export const TRUE_PEAK_FALL_LIMIT_DB = 1;
/** A narrowed loudness range is the signature of compression or limiting. */
export const LRA_TOLERANCE_LU = 1;

export type AudioCheckStatus =
  /** Every comparable figure matched. */
  | 'passed'
  /** At least one figure is outside tolerance. The audio was altered. */
  | 'failed'
  /**
   * Something could not be measured, and nothing that COULD be measured was
   * wrong. Not a fault and never a blocker — it means we do not know.
   */
  | 'unknown';

export type AudioField = 'duration' | 'sampleRate' | 'channels' | 'lufs' | 'truePeak' | 'lra';

/** What a measurement of one file yielded. Nulls mean "the file would not say". */
export interface AudioSnapshot {
  durationSec: number | null;
  sampleRate: number | null;
  channels: number | null;
  lufs: number | null;
  truePeak: number | null;
  lra: number | null;
}

export interface AudioFinding {
  field: AudioField;
  /** True when this is a definite violation rather than an unmeasurable field. */
  violation: boolean;
  /** Operator-facing. Says what differs and by how much, never just "mismatch". */
  message: string;
}

export interface AudioCheck {
  status: AudioCheckStatus;
  findings: AudioFinding[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const signed = (n: number) => `${n >= 0 ? '+' : ''}${round2(n)}`;

function pair(a: number | null, b: number | null): [number, number] | null {
  return typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b)
    ? [a, b]
    : null;
}

/**
 * Compare a rendered file's audio against the master it was built from.
 *
 * `master` is measured from the WAV on disk rather than read from the job's
 * stored figures. A verification step that trusts a number somebody else wrote
 * down is not verifying anything — and the stored value is exactly what would
 * be wrong if the mastering stage had misreported.
 */
export function verifyRenderedAudio(master: AudioSnapshot, output: AudioSnapshot): AudioCheck {
  const findings: AudioFinding[] = [];
  const unmeasurable = (field: AudioField, what: string) =>
    findings.push({ field, violation: false, message: `Could not compare ${what}.` });

  // --- exact matches -------------------------------------------------------
  // No tolerance is meaningful here: a sample rate or a channel count is either
  // the master's or it is not, and either change means the audio was rebuilt.
  const sr = pair(master.sampleRate, output.sampleRate);
  if (!sr) unmeasurable('sampleRate', 'sample rate');
  else if (sr[0] !== sr[1]) {
    findings.push({
      field: 'sampleRate', violation: true,
      message: `Sample rate changed: master ${sr[0]} Hz, video ${sr[1]} Hz. The render resampled the audio.`,
    });
  }

  const ch = pair(master.channels, output.channels);
  if (!ch) unmeasurable('channels', 'channel count');
  else if (ch[0] !== ch[1]) {
    findings.push({
      field: 'channels', violation: true,
      message: `Channel count changed: master ${ch[0]}, video ${ch[1]}. The render remixed the audio.`,
    });
  }

  // --- the one that catches a truncated song -------------------------------
  const dur = pair(master.durationSec, output.durationSec);
  if (!dur) unmeasurable('duration', 'duration');
  else if (Math.abs(dur[1] - dur[0]) > DURATION_TOLERANCE_SEC) {
    const d = dur[1] - dur[0];
    findings.push({
      field: 'duration', violation: true,
      message: d < 0
        ? `The video is ${round2(Math.abs(d))} s SHORTER than the master (${dur[1]} s against ${dur[0]} s) — the song is cut off.`
        : `The video runs ${round2(d)} s longer than the master (${dur[1]} s against ${dur[0]} s).`,
    });
  }

  // --- the ones that catch processing --------------------------------------
  const lufs = pair(master.lufs, output.lufs);
  if (!lufs) unmeasurable('lufs', 'loudness');
  else if (Math.abs(lufs[1] - lufs[0]) > LUFS_TOLERANCE_LU) {
    findings.push({
      field: 'lufs', violation: true,
      message: `Loudness shifted ${signed(lufs[1] - lufs[0])} LU (master ${lufs[0]}, video ${lufs[1]} LUFS). Something re-levelled the audio.`,
    });
  }

  const tp = pair(master.truePeak, output.truePeak);
  if (!tp) unmeasurable('truePeak', 'true peak');
  else {
    const rise = tp[1] - tp[0];
    if (rise > TRUE_PEAK_RISE_LIMIT_DB) {
      findings.push({
        field: 'truePeak', violation: true,
        message: `True peak rose ${signed(rise)} dB (master ${tp[0]}, video ${tp[1]} dBTP). More than lossy coding accounts for — check for clipping.`,
      });
    } else if (-rise > TRUE_PEAK_FALL_LIMIT_DB) {
      findings.push({
        field: 'truePeak', violation: true,
        message: `True peak fell ${signed(rise)} dB (master ${tp[0]}, video ${tp[1]} dBTP). Something limited or attenuated the audio.`,
      });
    }
  }

  const lra = pair(master.lra, output.lra);
  if (!lra) unmeasurable('lra', 'loudness range');
  else if (Math.abs(lra[1] - lra[0]) > LRA_TOLERANCE_LU) {
    findings.push({
      field: 'lra', violation: true,
      message: `Loudness range changed ${signed(lra[1] - lra[0])} LU (master ${lra[0]}, video ${lra[1]}). The dynamics were altered.`,
    });
  }

  // A definite violation outranks an unmeasurable field: knowing one figure is
  // wrong is enough, whatever else could not be read.
  const status: AudioCheckStatus = findings.some((f) => f.violation)
    ? 'failed'
    : findings.length > 0
      ? 'unknown'
      : 'passed';
  return { status, findings };
}

/**
 * How far a clip's length may sit from the window that was asked for.
 *
 * One AAC frame is 1024 samples — 21 ms at 48 kHz — and the encoder pads to a
 * frame boundary, so a correct clip always runs a few ms long. 0.25 s is far
 * above that and far below the smallest mistake worth catching (a window that
 * ran past the end of the track loses whole seconds).
 */
export const CLIP_DURATION_TOLERANCE_SEC = 0.25;

/**
 * Check a vertical short against the WINDOW IT WAS CUT FROM — not against the
 * master.
 *
 * ⚠️ LOUDNESS IS DELIBERATELY NOT COMPARED, and this is the whole reason this
 * function exists instead of verifyRenderedAudio. A short is an excerpt with
 * `afade` 0.6 s in and 3 s out applied, so its integrated loudness, true peak
 * and LRA all legitimately differ from the master's. Running the full
 * comparison would fail every correctly cut clip, and a check that cries wolf
 * is one the operator learns to click past — which is how the real one stops
 * working too.
 *
 * What is honestly knowable about a clip is its SHAPE: as long as the window
 * that was requested, at the master's sample rate, with the master's channels.
 * That catches a truncated clip, a window that slid, a resample and a mono
 * collapse — everything the encode can get wrong about audio it was handed.
 */
export function verifyRenderedClip(
  expected: { seconds: number; sampleRate: number | null; channels: number | null },
  output: AudioSnapshot,
): AudioCheck {
  const findings: AudioFinding[] = [];
  const unmeasurable = (field: AudioField, what: string) =>
    findings.push({ field, violation: false, message: `Could not compare ${what}.` });

  const sr = pair(expected.sampleRate, output.sampleRate);
  if (!sr) unmeasurable('sampleRate', 'sample rate');
  else if (sr[0] !== sr[1]) {
    findings.push({
      field: 'sampleRate', violation: true,
      message: `Sample rate changed: master ${sr[0]} Hz, short ${sr[1]} Hz. The clip resampled the audio.`,
    });
  }

  const ch = pair(expected.channels, output.channels);
  if (!ch) unmeasurable('channels', 'channel count');
  else if (ch[0] !== ch[1]) {
    findings.push({
      field: 'channels', violation: true,
      message: `Channel count changed: master ${ch[0]}, short ${ch[1]}. The clip remixed the audio.`,
    });
  }

  const dur = pair(expected.seconds, output.durationSec);
  if (!dur) unmeasurable('duration', 'length');
  else if (Math.abs(dur[1] - dur[0]) > CLIP_DURATION_TOLERANCE_SEC) {
    findings.push({
      field: 'duration', violation: true,
      message: `The clip is ${dur[1].toFixed(2)} s, not the ${dur[0].toFixed(2)} s that was asked for.`,
    });
  }

  // Same precedence as the full check: a definite violation outranks a figure
  // that would not read.
  const status: AudioCheckStatus = findings.some((f) => f.violation)
    ? 'failed'
    : findings.length > 0
      ? 'unknown'
      : 'passed';
  return { status, findings };
}

/** One line for the row. The findings carry the detail. */
export function audioCheckSummary(check: AudioCheck): string {
  switch (check.status) {
    case 'passed':
      return 'Audio matches the master.';
    case 'failed': {
      const n = check.findings.filter((f) => f.violation).length;
      return `The video's audio does not match the master (${n} ${n === 1 ? 'difference' : 'differences'}). Do not upload it.`;
    }
    case 'unknown':
      return 'The audio could not be fully checked against the master.';
  }
}
