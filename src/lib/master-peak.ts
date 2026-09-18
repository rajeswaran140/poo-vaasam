/**
 * Peak-only normalisation — the mastering target for a karaoke bed.
 *
 * WHY THIS EXISTS RATHER THAN A QUIETER TARGET. A karaoke bed must keep its
 * headroom for a live voice, so the obvious idea is to master it to -18 or -20
 * instead of -14. Measured on the real Sevvanthi bed (2026-09-16), that does
 * not work: ffmpeg's `loudnorm` reports `Normalization Type: Dynamic` at -14,
 * -18 and -20 alike — even with `linear=true` explicitly requested — and misses
 * the target it was given by ~0.7 LU. There is no integrated target at which
 * the existing pipeline leaves a bed's dynamics alone.
 *
 *     the bed as built     -20.2 LUFS   LRA 6.4   -1.0 dBTP
 *     peak-only            -20.2 LUFS   LRA 6.4   -1.0 dBTP   ← unchanged
 *     loudnorm -> -18      -17.3        LRA 6.2   -0.9
 *     loudnorm -> -14      -14.0        LRA 5.8   (shipped, and wrong)
 *
 * Peak-only was the only option tested that preserved the bed exactly. It also
 * makes a bed that is ALREADY correct come out unchanged, which is the right
 * behaviour for a file someone built by hand.
 *
 * ⚠️ ONE GAIN CHANGE. No loudnorm, no limiter, no compressor. Everything in
 * this module exists to keep that true — if a filter is ever added here that
 * touches dynamics, the mode has stopped meaning anything.
 *
 * Pure and I/O-free, like master-video and master-short: this decides what is
 * legal and builds argument lists. The worker runs them.
 *
 * Spec: docs/superpowers/specs/2026-09-16-karaoke-master-target-design.md
 */

/**
 * How a master reaches its level.
 *
 * `'loudness'` is the two-pass loudnorm every job has always used, and stays
 * the default everywhere so an omitted field means today's behaviour.
 */
export type NormalizationMode = 'loudness' | 'peak';

const MODES: readonly NormalizationMode[] = ['loudness', 'peak'];

export function isValidNormalizationMode(v: unknown): v is NormalizationMode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v);
}

/**
 * Ceiling for a peak-normalised bed.
 *
 * The house ceiling everywhere else in the module, and — not a coincidence —
 * the level the Sevvanthi bed was already built to, which is why peak-only is
 * a no-op on it.
 */
export const PEAK_CEILING_DBTP = -1.0;

/**
 * A bed needing more boost than this is the wrong file, not a quiet one.
 *
 * 12 dB is a large lift for a finished bounce; past it the likeliest
 * explanation is a stem, a muted export, or the wrong take entirely. Refusing
 * costs one re-upload; applying it silently produces a delivered product built
 * from the wrong source.
 */
export const MAX_PEAK_GAIN_DB = 12;

/** Buyers are promised this — see KARAOKE_DELIVERABLE in src/lib/karaoke.ts. */
export const KARAOKE_MP3_BITRATE = '320k';

/** S3 key for a karaoke bed, beside the source it came from. */
export function karaokeMasterKeyFor(s3Key: string): string {
  const stem = s3Key.replace(/\.[a-z0-9]+$/i, '');
  return `${stem}-karaoke-1dBTP.wav`;
}

/**
 * True if the key is a karaoke bed this module produced.
 *
 * ⚠️ DELIBERATELY SEPARATE FROM `isMasterKey`, which must not be widened to
 * include these. That predicate answers two different questions — "is this
 * already a mastering output?" (the re-master guard) and "is this a valid
 * source for a video, short or YouTube upload?" (a positive requirement).
 * Widening it would satisfy the first and break the second, making karaoke beds
 * eligible for YouTube renders. Re-master guards compose the two predicates;
 * render, short and upload guards keep `isMasterKey` alone.
 */
export function isKaraokeMasterKey(s3Key: string): boolean {
  return /-karaoke-1dBTP\.wav$/i.test(s3Key);
}

export type PeakRefusal = 'unreadable-peak' | 'needs-too-much-gain';

export type PeakGainPlan =
  | { ok: true; gainDb: number }
  | { ok: false; reason: PeakRefusal; needsDb?: number };

/**
 * The single gain that puts this file at the ceiling.
 *
 * Attenuation is as legitimate as boost — a bed bounced hot needs pulling down,
 * and that is still one gain change, not compression.
 */
export function planPeakGain(measuredTruePeak: number | null | undefined): PeakGainPlan {
  if (typeof measuredTruePeak !== 'number' || !Number.isFinite(measuredTruePeak)) {
    return { ok: false, reason: 'unreadable-peak' };
  }
  const gainDb = Math.round((PEAK_CEILING_DBTP - measuredTruePeak) * 100) / 100;
  if (gainDb > MAX_PEAK_GAIN_DB) {
    return { ok: false, reason: 'needs-too-much-gain', needsDb: gainDb };
  }
  return { ok: true, gainDb };
}

/** Operator-facing wording. Says what to DO wherever there is something. */
export function peakRefusalMessage(reason: PeakRefusal, needsDb?: number): string {
  switch (reason) {
    case 'unreadable-peak':
      return 'The bed’s peak level could not be measured — check the file is readable audio.';
    case 'needs-too-much-gain':
      return `This file needs +${(needsDb ?? 0).toFixed(1)} dB to reach the ceiling — check it is the right bounce, not a stem.`;
  }
}

/**
 * The peak pass: one gain change, written in the same format as the loudness
 * path's pass 2 so the two outputs are interchangeable everywhere downstream.
 *
 * ⚠️ The gain is always rendered explicitly, including `volume=0.00dB`. A bed
 * already at the ceiling still goes through the pass, so the delivered file is
 * one this pipeline wrote and the job record describes something that actually
 * happened — rather than a copy with a master's name on it.
 */
export function buildPeakArgs(params: { inPath: string; outPath: string; gainDb: number }): string[] {
  return [
    '-hide_banner', '-nostats',
    '-i', params.inPath,
    '-af', `volume=${params.gainDb.toFixed(2)}dB`,
    '-ar', '48000', '-c:a', 'pcm_s24le',
    '-y', params.outPath,
  ];
}
