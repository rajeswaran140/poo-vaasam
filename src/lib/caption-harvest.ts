/**
 * Recovering Raj's own lyrics from the caption tracks already on YouTube.
 *
 * WHY. The catalogue is 57 unique songs; only 4 have their lyrics stored
 * anywhere queryable (measured 2026-08-01). Everything downstream that anyone
 * has asked for — prosody analysis over the catalogue, romanized diaspora
 * search, karaoke, a "Song DNA" that describes what makes a Tamilagaval song —
 * needs the words as data, and none of it can start while they are 57 videos
 * and a drawer of files.
 *
 * The lyrics are Raj's own work, written over 35+ years; nothing here generates
 * or alters a single word. This only RECOVERS what he already uploaded: on a
 * sample of 12 songs, 3 carried a `standard` (human-uploaded) Tamil track. Those
 * are his lines, already timed by him — so for that slice the alignment problem
 * is not solved by us, it was solved by him and then left on YouTube.
 *
 * ⚠️ ASR TRACKS ARE NEVER HARVESTED. A machine transcription of sung Tamil is
 * noise wearing the shape of lyrics, and importing it would poison the corpus
 * that later analysis depends on — silently, because it would look plausible.
 * `trackKind === 'asr'` is refused even when it is the only track present.
 *
 * Pure and I/O-free; the script does the network and disk work.
 */

/** What `captions.list` reports per track. */
export interface CaptionTrack {
  id: string;
  trackKind: string;
  language: string;
  name?: string;
}

/** One timed line, as authored. */
export interface LyricCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface HarvestedLyrics {
  cues: LyricCue[];
  /** Cue text joined by newline — the lyrics as a document. */
  text: string;
  lineCount: number;
  /** End of the last cue; a sanity check against the video's duration. */
  lastCueEndMs: number;
}

// --- quota -----------------------------------------------------------------
// Documented YouTube Data API costs. `captions.list` at 50 and `download` at
// 200 are the expensive pair; reading list as 1 burned an entire 10,000-unit
// day on 2026-07-29, so these are named constants and the plan is checked
// BEFORE anything runs rather than discovered halfway through.
export const COST_CAPTIONS_LIST = 50;
export const COST_CAPTIONS_DOWNLOAD = 200;
export const COST_PLAYLIST_PAGE = 1;
export const COST_VIDEOS_LIST = 1;
export const DAILY_QUOTA_BUDGET = 10_000;

/**
 * Leave room for the day's reporting crons, which run whether or not a harvest
 * does. A sweep that technically fits but starves the daily digests is not a
 * sweep that fits.
 */
export const HARVEST_UNIT_CEILING = 6_000;

export interface HarvestPlan {
  videos: number;
  /** Worst case: every video listed, and every one turns out to have a track. */
  maxUnits: number;
  affordable: boolean;
  reason?: string;
}

export function planHarvest(videoCount: number, pages = 2): HarvestPlan {
  const maxUnits =
    pages * COST_PLAYLIST_PAGE +
    Math.ceil(videoCount / 50) * COST_VIDEOS_LIST +
    videoCount * COST_CAPTIONS_LIST +
    videoCount * COST_CAPTIONS_DOWNLOAD;
  const affordable = maxUnits <= HARVEST_UNIT_CEILING;
  return {
    videos: videoCount,
    maxUnits,
    affordable,
    ...(affordable
      ? {}
      : {
          reason:
            `Worst case ${maxUnits} units exceeds the ${HARVEST_UNIT_CEILING} ceiling ` +
            `(daily budget ${DAILY_QUOTA_BUDGET}, shared with the reporting crons). ` +
            `Run it in batches with --limit.`,
        }),
  };
}

/**
 * Pick the track worth downloading, or null.
 *
 * Prefers Tamil, then any other human-uploaded track (an English original like
 * Maple Breeze is still Raj's writing). ASR is never eligible.
 */
export function selectTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const human = tracks.filter((t) => t.trackKind !== 'asr');
  if (!human.length) return null;
  return human.find((t) => t.language === 'ta') ?? human[0];
}

/** `00:01:23,456` / `00:01:23.456` → ms. */
function stampToMs(stamp: string): number | null {
  const m = stamp.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return null;
  return (
    Number(m[1]) * 3_600_000 + Number(m[2]) * 60_000 + Number(m[3]) * 1000 + Number(m[4].padEnd(3, '0'))
  );
}

/**
 * SRT → timed lyric cues.
 *
 * Tolerant on purpose: these files were authored by hand and by three different
 * upload paths over months, so blank lines, CRLF, a missing index number or a
 * BOM are all normal. A cue that cannot be parsed is DROPPED rather than
 * guessed at — a wrong timing would corrupt the alignment silently, and a
 * missing line is visible in the count.
 */
export function parseSrt(srt: string): HarvestedLyrics {
  const cues: LyricCue[] = [];
  const blocks = srt
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    // An index line is optional — some exports omit it.
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx < 0) continue;
    const [rawStart, rawEnd] = lines[timingIdx].split('-->');
    const startMs = stampToMs(rawStart ?? '');
    const endMs = stampToMs(rawEnd ?? '');
    if (startMs === null || endMs === null) continue;
    const text = lines
      .slice(timingIdx + 1)
      .join('\n')
      .trim();
    if (!text) continue;
    cues.push({ startMs, endMs, text });
  }

  cues.sort((a, b) => a.startMs - b.startMs);
  return {
    cues,
    text: cues.map((c) => c.text).join('\n'),
    lineCount: cues.length,
    lastCueEndMs: cues.length ? cues[cues.length - 1].endMs : 0,
  };
}

/**
 * Does this look like real lyrics rather than a stub or a mis-parse?
 *
 * A guard against importing something worthless into the corpus. Deliberately
 * loose — it judges SHAPE, never content. Raj's Tamil is his; this only asks
 * whether enough of it arrived.
 */
export const MIN_LYRIC_LINES = 4;

/**
 * Average non-whitespace characters per cue.
 *
 * Density, NOT total length — a first cut used an 80-character floor over the
 * whole track and rejected a real four-line Tamil verse, because Tamil carries
 * far more meaning per character than the English-ish density that number was
 * unconsciously calibrated to. Judging the total also punishes short songs for
 * being short, which is a content judgement this has no business making.
 *
 * What it is actually for is catching a track that is structurally present but
 * empty of words — a run of `♪` markers, or a mis-parse that produced cues with
 * stray punctuation in them. Those sit near one character per line; real lines
 * of any language sit far above it.
 */
export const MIN_CHARS_PER_LINE = 4;

export function looksLikeLyrics(h: HarvestedLyrics): boolean {
  if (h.lineCount < MIN_LYRIC_LINES) return false;
  const density = h.text.replace(/\s/g, '').length / h.lineCount;
  return density >= MIN_CHARS_PER_LINE;
}

/** Filesystem-safe stem for one song's harvested files. */
export function harvestFilename(videoId: string, title: string): string {
  const stem = title
    .split('|')[0]
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    // Stripping the pictographs alone leaves their INVISIBLE companions behind:
    // U+FE0F/U+FE0E variation selectors, U+200D zero-width joiners and skin-tone
    // modifiers are not themselves Extended_Pictographic. A title of "❤️❤️" then
    // reduced to two invisible characters — a stem that looks empty, passes a
    // truthiness check, and writes a file nobody can name or delete easily.
    .replace(/[︎️‍]|[\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${stem || 'untitled'} [${videoId}]`;
}
