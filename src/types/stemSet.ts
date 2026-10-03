/**
 * A saved master's stem set: the separate parts (vocals, drums, bass…)
 * TamilAgaval Music exports for a song. One set per master, kept under that
 * master's folder in the mastering workspace (isMasteringKey guard applies).
 *
 * ⚠️ STEMS ARE A MAP KEYED BY stemId, NOT A LIST. The worker records each
 * stem's listening copy as it finishes, and several finish at once; a list
 * would need read-modify-write and the second writer would erase the first.
 * A nested-map SET is atomic per stem. `order` carries display order.
 */

export interface StemEntry {
  key: string;
  name: string;
  previewKey: string | null;
  previewError: string | null;
  /**
   * When the POST .../stems route last asked the worker for this stem's
   * listening copy (first add, or a Retry re-POST). Null for a stem added
   * before this field existed. StemsStudio treats a pending stem (no
   * previewKey, no previewError) whose previewRequestedAt is null, or more
   * than 5 minutes old, as stuck rather than still rendering.
   */
  previewRequestedAt: string | null;
  durationSec: number | null;
  sampleRate: number | null;
  channels: number | null;
}

export interface StemMixEntry {
  gainDb: number;
  muted: boolean;
}

export interface StemRemix {
  key: string | null;
  renderedAt: string | null;
  mixUsed: Record<string, StemMixEntry> | null;
  notes: string[];
  error: string | null;
  requestedAt: string | null;
}

export interface StemSet {
  masterJobId: string;
  order: string[];
  stems: Record<string, StemEntry>;
  mix: Record<string, StemMixEntry>;
  remix: StemRemix | null;
  createdAt: string;
  updatedAt: string;
}
