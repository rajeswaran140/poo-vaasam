/**
 * Take triage — turn a pile of generated audio into a publishing pipeline.
 *
 * CONTEXT. ~2,500 takes were generated, ~40-50 became songs. The other ~2,450
 * were judged "not a keeper" ONE AT A TIME and then left alone. They are not
 * worthless: a slice of them failed only on VOCALS while the arrangement landed
 * (→ a finished instrumental), and a further slice hold one strong 15-30s
 * passage (→ Short / WhatsApp Status material). Neither needs the generator to
 * be working, which is what makes this the production lever while it isn't.
 *
 * Be honest about the size of the prize: these takes were ALREADY rejected as
 * songs, so the recoverable yield is instrumentals and hooks — NOT a backlog of
 * releasable songs. Sorting them is worth doing; expecting albums is not.
 *
 * DESIGN
 * - Non-destructive. This module NEVER deletes audio. `discard` is a label, and
 *   the recipe text is retained even then — the durable asset is the
 *   prompt→outcome record, not the 2,450 files.
 * - Resumable. 2,450 takes is many sittings, so decisions live in a manifest
 *   that merges with a rescan: existing decisions always win over a fresh scan,
 *   and files that vanish are marked `missing` rather than dropped (silently
 *   losing a decision is worse than carrying a stale row).
 * - Pure. No fs, no network, no ffmpeg here — the CLI injects all of that — so
 *   every merge/queue/stats rule is unit-testable.
 */

/** What to do with a take. `undecided` is the default for a newly-scanned file. */
export const TAKE_DECISIONS = ['undecided', 'keep', 'instrumental', 'hook', 'discard'] as const;
export type TakeDecision = (typeof TAKE_DECISIONS)[number];

/** Decisions that feed a downstream pipeline, and which script consumes them. */
export const QUEUE_TARGETS: Record<'instrumental' | 'hook', string> = {
  instrumental: 'scripts/generate-karaoke-stem.ts (Demucs — keeps the arrangement, drops the failed vocal)',
  hook: 'scripts/generate-song-short.ts (hook-first 1080x1920 clip, <=29s for WhatsApp Status)',
};

export interface TakeRecord {
  /** Path relative to the scanned root. Display identity, and the fallback match. */
  file: string;
  /**
   * Content hash. The REAL identity — paths change when takes are pulled down in
   * batches and reorganised, and re-listening to a take because it moved is the
   * exact waste this tool exists to prevent. Optional: rows written before
   * hashing existed simply fall back to path matching.
   */
  hash?: string;
  decision: TakeDecision;
  /** Free-text note: what worked, what broke, which word was mispronounced. */
  note?: string;
  /** ISO timestamp of the last decision change. */
  decidedAt?: string;
  /** Objective signals, filled in by an optional probe pass. */
  durationSec?: number;
  lufs?: number;
  /**
   * The generation recipe (style prompt / settings) if a sidecar was found.
   * Retained even for `discard` — the recipe is the compounding asset.
   */
  recipe?: string;
  /** True when the manifest has a row the latest scan could not find on disk. */
  missing?: boolean;
}

export interface TriageManifest {
  version: 1;
  root: string;
  takes: TakeRecord[];
}

export function emptyManifest(root: string): TriageManifest {
  return { version: 1, root, takes: [] };
}

export interface ScannedTake {
  file: string;
  hash?: string;
  durationSec?: number;
  lufs?: number;
  recipe?: string;
}

/**
 * Merge a fresh directory scan into an existing manifest.
 *
 * Rules, in priority order:
 *  1. An existing decision is NEVER overwritten by a scan — hours of listening
 *     outrank a file walk.
 *  2. A row is matched by PATH first, then by CONTENT HASH. The hash pass is what
 *     makes a rename or a move survive: the verdict follows the audio to its new
 *     path instead of orphaning and coming back as undecided.
 *  3. Newly-seen files are appended as `undecided`.
 *  4. A row that matches neither path nor hash is flagged `missing`, not removed —
 *     losing a verdict silently is unrecoverable, because there is no way to tell
 *     which ones went.
 *  5. A previously-missing file that reappears is un-flagged, decision intact.
 *
 * Each scanned file is claimed at most once, so duplicate copies of the same take
 * can't have one row steal another's identity. Probe fields fill only the gaps —
 * a cheap rescan without --probe must not wipe earlier measurements.
 */
export function mergeScan(manifest: TriageManifest, scanned: ScannedTake[]): TriageManifest {
  const byPath = new Map(scanned.map((s) => [s.file, s]));
  // Hash → queue of files carrying it (a queue, so N duplicates match N rows).
  const byHash = new Map<string, ScannedTake[]>();
  for (const s of scanned) {
    if (!s.hash) continue;
    const q = byHash.get(s.hash);
    if (q) q.push(s);
    else byHash.set(s.hash, [s]);
  }
  const claimed = new Set<ScannedTake>();

  const claim = (s: ScannedTake | undefined): ScannedTake | undefined => {
    if (!s || claimed.has(s)) return undefined;
    claimed.add(s);
    return s;
  };

  const takes: TakeRecord[] = manifest.takes.map((t) => {
    // Path match first — the common case, and free.
    let hit = claim(byPath.get(t.file));
    // Then content match, which is how a rename keeps its verdict.
    if (!hit && t.hash) hit = claim((byHash.get(t.hash) ?? []).find((s) => !claimed.has(s)));
    if (!hit) return { ...t, missing: true };

    const merged: TakeRecord = { ...t, file: hit.file };
    delete merged.missing;
    if (hit.hash) merged.hash = hit.hash;
    if (merged.durationSec === undefined && hit.durationSec !== undefined) merged.durationSec = hit.durationSec;
    if (merged.lufs === undefined && hit.lufs !== undefined) merged.lufs = hit.lufs;
    if (!merged.recipe && hit.recipe) merged.recipe = hit.recipe;
    return merged;
  });

  for (const s of scanned) {
    if (claimed.has(s)) continue;
    takes.push({
      file: s.file,
      decision: 'undecided',
      ...(s.hash ? { hash: s.hash } : {}),
      ...(s.durationSec !== undefined ? { durationSec: s.durationSec } : {}),
      ...(s.lufs !== undefined ? { lufs: s.lufs } : {}),
      ...(s.recipe ? { recipe: s.recipe } : {}),
    });
  }
  return { ...manifest, takes };
}

/** Record a decision. Returns a new manifest; unknown files are rejected. */
export function setDecision(
  manifest: TriageManifest,
  file: string,
  decision: TakeDecision,
  opts: { note?: string; now: string }
): { ok: true; manifest: TriageManifest } | { ok: false; error: string } {
  const idx = manifest.takes.findIndex((t) => t.file === file);
  if (idx < 0) return { ok: false, error: `not in manifest: ${file}` };
  const takes = [...manifest.takes];
  takes[idx] = {
    ...takes[idx],
    decision,
    decidedAt: opts.now,
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  };
  return { ok: true, manifest: { ...manifest, takes } };
}

export interface TriageStats {
  total: number;
  byDecision: Record<TakeDecision, number>;
  decided: number;
  remaining: number;
  missing: number;
  /** 0-1, or null when the manifest is empty (avoids a fake 0% or 100%). */
  progress: number | null;
}

export function stats(manifest: TriageManifest): TriageStats {
  const byDecision = Object.fromEntries(TAKE_DECISIONS.map((d) => [d, 0])) as Record<TakeDecision, number>;
  let missing = 0;
  for (const t of manifest.takes) {
    byDecision[t.decision] = (byDecision[t.decision] ?? 0) + 1;
    if (t.missing) missing += 1;
  }
  const total = manifest.takes.length;
  const remaining = byDecision.undecided;
  const decided = total - remaining;
  return { total, byDecision, decided, remaining, missing, progress: total ? decided / total : null };
}

/**
 * The next takes to review. Missing files are skipped — there is nothing to
 * listen to — and the ordering is stable so a session can be resumed.
 */
export function nextUndecided(manifest: TriageManifest, limit = 1): TakeRecord[] {
  return manifest.takes.filter((t) => t.decision === 'undecided' && !t.missing).slice(0, limit);
}

/**
 * Files tagged for a downstream pipeline. Missing files are excluded so a batch
 * run can't fail halfway through on a path that no longer exists.
 */
export function exportQueue(manifest: TriageManifest, decision: TakeDecision): string[] {
  return manifest.takes.filter((t) => t.decision === decision && !t.missing).map((t) => t.file);
}

/**
 * Everything worth keeping if the audio were deleted tomorrow: the recipe and
 * the verdict for every take that has one, INCLUDING discards. This is the
 * dataset — which combination of raga/tempo/instrumentation/voice hit or missed
 * — and it is the part that survives a vendor.
 */
export function exportRecipes(manifest: TriageManifest): Array<Pick<TakeRecord, 'file' | 'decision' | 'note' | 'recipe'>> {
  return manifest.takes
    .filter((t) => t.recipe || t.note)
    .map(({ file, decision, note, recipe }) => ({ file, decision, ...(note ? { note } : {}), ...(recipe ? { recipe } : {}) }));
}
