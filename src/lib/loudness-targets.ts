/**
 * Streaming loudness targets — how a take's measured LUFS-I compares to where
 * each platform normalises playback. Pure. Positive delta = louder than target
 * (the platform turns it DOWN, often losing punch); negative = quieter (turned
 * up, or left quiet). Within tolerance = lands where intended.
 */

export interface LoudnessTarget {
  platform: string;
  lufs: number;
}

// Published playback-normalisation targets (LUFS-I). Most streamers sit at −14;
// Apple Music is quieter at −16. The −14 "streaming norm" is the common anchor.
export const STREAMING_TARGETS: LoudnessTarget[] = [
  { platform: 'Spotify', lufs: -14 },
  { platform: 'YouTube', lufs: -14 },
  { platform: 'Amazon Music', lufs: -14 },
  { platform: 'TIDAL', lufs: -14 },
  { platform: 'Apple Music', lufs: -16 },
];

/** The common streaming anchor most platforms share. */
export const STREAMING_NORM_LUFS = -14;

export type LoudnessStatus = 'ok' | 'hot' | 'quiet';

export interface TargetDelta {
  platform: string;
  target: number;
  /** measured − target (LU). */
  deltaLu: number;
  status: LoudnessStatus;
}

export function statusFor(deltaLu: number, tolerance = 1): LoudnessStatus {
  if (deltaLu > tolerance) return 'hot';
  if (deltaLu < -tolerance) return 'quiet';
  return 'ok';
}

/** Per-platform deltas for a measured LUFS-I value. */
export function compareToTargets(lufs: number, tolerance = 1): TargetDelta[] {
  return STREAMING_TARGETS.map((t) => {
    const deltaLu = Math.round((lufs - t.lufs) * 10) / 10;
    return { platform: t.platform, target: t.lufs, deltaLu, status: statusFor(deltaLu, tolerance) };
  });
}

export interface PlatformLanding {
  /** LUFS-I this group of platforms normalises to. */
  target: number;
  /** Platforms sharing this target (e.g. the four −14 streamers). */
  platforms: string[];
  /** mastered LUFS − target (LU); >0 ⇒ the platform turns it down. */
  deltaLu: number;
  status: LoudnessStatus;
  /** A glance mark: ✓ = plays as mastered, ↓ = playback lowered, · = below target. */
  mark: '✓' | '↓' | '·';
  /**
   * Plain-language outcome for a non-engineer, worded to reassure. Loudness
   * normalisation is a PLAYBACK-volume adjustment, not a re-encode — a hotter
   * master isn't "worse", so the copy says so ("no quality loss").
   */
  note: string;
}

/**
 * How a master at `lufs` LANDS on each platform, grouped by target so the four
 * −14 streamers collapse to one row instead of repeating. Answers "I mastered
 * once — what happens everywhere?": within tolerance it plays as mastered; hotter
 * than a platform's target and that platform lowers PLAYBACK volume (no quality
 * loss); quieter and it sits below the target. Pure — reuses compareToTargets' math.
 */
export function platformLanding(lufs: number, tolerance = 1): PlatformLanding[] {
  const byTarget = new Map<number, string[]>();
  for (const t of STREAMING_TARGETS) {
    const list = byTarget.get(t.lufs) ?? [];
    list.push(t.platform);
    byTarget.set(t.lufs, list);
  }
  return [...byTarget.entries()]
    .sort((a, b) => b[0] - a[0]) // loudest target first (−14 before −16)
    .map(([target, platforms]) => {
      const deltaLu = Math.round((lufs - target) * 10) / 10;
      const status = statusFor(deltaLu, tolerance);
      const mark: PlatformLanding['mark'] = status === 'ok' ? '✓' : status === 'hot' ? '↓' : '·';
      const note =
        status === 'ok'
          ? 'plays exactly as mastered'
          : status === 'hot'
            ? `playback lowered ~${deltaLu.toFixed(1)} LU · no quality loss`
            : `~${Math.abs(deltaLu).toFixed(1)} LU below target`;
      return { target, platforms, deltaLu, status, mark, note };
    });
}

/** One-line verdict vs the −14 streaming norm, e.g. "+3.0 LU hot for streaming". */
export function streamingNormVerdict(lufs: number, tolerance = 1): { status: LoudnessStatus; deltaLu: number; label: string } {
  const deltaLu = Math.round((lufs - STREAMING_NORM_LUFS) * 10) / 10;
  const status = statusFor(deltaLu, tolerance);
  const label =
    status === 'ok'
      ? `on target for the −14 LUFS streaming norm`
      : status === 'hot'
        ? `+${deltaLu} LU hot for the −14 LUFS norm — platforms will turn it down`
        : `${deltaLu} LU under the −14 LUFS norm — quieter than streaming targets`;
  return { status, deltaLu, label };
}
