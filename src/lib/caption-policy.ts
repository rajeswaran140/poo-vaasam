/**
 * The caption policy — pure decisions, no network.
 *
 * **The policy, set by Raj on 2026-09-20:** *"we have to turn off all automatic
 * captions unless we uploaded our lyrics."*
 *
 * Every auto-generated (`asr`) track comes off. Where a human-uploaded track
 * exists the video still has captions — Raj's own lyrics — so nothing is lost;
 * where none exists the video has no captions, which he prefers to a machine's
 * guess at sung Tamil.
 *
 * WHY A POLICY AND NOT A ONE-OFF. Seven ASR tracks were deleted by hand on
 * 2026-09-19/20 and two of them came back within hours. They regenerate, and
 * there is no setting that prevents it:
 *
 *   - **There is no channel-wide switch.** YouTube's only channel-level caption
 *     setting filters inappropriate words; it does not control generation. The
 *     admin doc claimed otherwise and was wrong.
 *   - **Language metadata does not control the ASR language.** Measured across
 *     five videos with identical `ta`/`ta` settings: one came out Tamil, four
 *     English.
 *
 * So this is a recurring sweep, not a fix. What it buys is that for the hours
 * after a premiere — when the most people arrive — nobody is served a
 * wrong-language transcript.
 */

/** A caption track as `captions.list` returns it, narrowed to what we decide on. */
export interface CaptionTrack {
  id: string;
  /** `asr` = machine-generated. Anything else was uploaded by a human. */
  trackKind: string;
  language: string;
}

export type CaptionVerdict =
  /** Machine track to remove. */
  | { action: 'delete'; trackIds: string[]; keepsCaptions: boolean }
  /** Nothing generated here; leave it alone. */
  | { action: 'none'; keepsCaptions: boolean };

/** True for a track a person uploaded — the thing the policy protects. */
export function isUploadedTrack(t: CaptionTrack): boolean {
  return t.trackKind !== 'asr';
}

/**
 * What to do with one video's tracks.
 *
 * `keepsCaptions` reports whether the video still has captions AFTER the
 * deletions — the signal for which songs deserve a real lyric track next. It is
 * the useful half of the sweep's output: deleting is maintenance, but a song
 * with no captions at all is a gap worth filling.
 *
 * ⚠️ Deletes EVERY asr track, including one already in Tamil. A machine
 * transcription of sung Tamil is still a guess, and the policy says our lyrics
 * or nothing. The caller may override per video; the default is the policy.
 */
export function decideCaptions(tracks: CaptionTrack[]): CaptionVerdict {
  const uploaded = tracks.filter(isUploadedTrack);
  const asr = tracks.filter((t) => !isUploadedTrack(t));
  const keepsCaptions = uploaded.length > 0;
  if (asr.length === 0) return { action: 'none', keepsCaptions };
  return { action: 'delete', trackIds: asr.map((t) => t.id), keepsCaptions };
}

/** Documented cost of the two calls this sweep makes, in quota units. */
export const COST_CAPTIONS_LIST = 50;
export const COST_CAPTIONS_DELETE = 50;

/**
 * Units to check `videos` videos and delete `deletes` tracks, plus the playlist
 * paging to enumerate them.
 *
 * Costed because reading `captions.list` as 1 unit rather than 50 burned an
 * entire day's 10,000 on 2026-07-29. At 50 a full catalogue pass over ~124
 * videos is 6,200 units before a single delete — most of a day — which is why
 * the sweep is scoped by default and has to be asked for in full.
 */
export function sweepCost(videos: number, deletes: number, playlistPages: number): number {
  return playlistPages + videos * COST_CAPTIONS_LIST + deletes * COST_CAPTIONS_DELETE;
}

/**
 * Can this sweep run inside the budget left today?
 *
 * Assumes the worst case — every video carrying a track to delete — because a
 * sweep that runs out of quota halfway leaves the catalogue in a state nobody
 * can describe: some videos swept, some not, and no record of which.
 */
export function canAfford(videos: number, playlistPages: number, unitsAvailable: number): boolean {
  return sweepCost(videos, videos, playlistPages) <= unitsAvailable;
}
