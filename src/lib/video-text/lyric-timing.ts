/**
 * Automatic lyric timing for Video Text: Raj's lines in, a start and end for
 * each line out, taken from the words the lyric-timing worker heard.
 *
 * The contract of scripts/align-lyrics.ts holds here too: TIMES come from the
 * machine, WORDS come from Raj. `verifyRoundTrip` refuses any result whose text
 * is not his, byte for byte. The worker (worker/lyric_timing_worker) only
 * measures; every judgement is in this file and the libraries it calls, so it
 * is unit tested.
 *
 * Pure: no I/O, safe to import from the browser and the route alike.
 */
import { verifyRoundTrip } from '@/lib/caption-alignment';
import { alignLinesToWords } from '@/lib/word-alignment';
import { wordsToCues, type AsrWord } from '@/lib/local-asr-clock';
import { activeSpans, placeInSinging, type VocalActivity } from '@/lib/vocal-activity';
import { MIN_BLOCK_SEC } from '@/lib/video-text/timeline';
import type { TextBlock } from '@/types/videoText';

/** What the worker writes (worker/lyric_timing_worker/handler.py). */
export interface LyricTimingWords {
  durationSec: number;
  words: AsrWord[];
  activity?: VocalActivity;
}

export interface TimedLine {
  text: string;
  startSec: number;
  endSec: number;
  /** false = the recogniser did not hear this line; it was placed in the singing between heard lines. */
  heard: boolean;
}

export type LyricTimingResult = { ok: true; lines: TimedLine[] } | { ok: false; error: string };

/**
 * The lyric lines as Video Text shows them (one caption per non-empty line),
 * and which of them open a verse: the first line, and any line after a blank
 * line. A verse usually starts after a music break, which the placement uses.
 */
export function linesAndVerses(lyricsText: string): { lines: string[]; verseStarts: Set<number> } {
  const lines: string[] = [];
  const verseStarts = new Set<number>();
  let afterBlank = true;
  for (const raw of String(lyricsText ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      afterBlank = true;
      continue;
    }
    if (afterBlank) verseStarts.add(lines.length);
    lines.push(line);
    afterBlank = false;
  }
  return { lines, verseStarts };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function timeLyricLines(lyricsText: string, sensor: LyricTimingWords): LyricTimingResult {
  const { lines, verseStarts } = linesAndVerses(lyricsText);
  if (!lines.length) return { ok: false, error: 'Paste the lyrics first, one line per lyric line.' };
  const cues = wordsToCues(sensor.words ?? []);
  if (!cues.length) {
    return { ok: false, error: 'No singing was heard in this video, so the lines could not be timed. Tap to time them instead.' };
  }
  const cards = lines.map((l) => [l]);
  // Word by word, not line to chunk: each line starts at its own first heard word.
  const aligned = alignLinesToWords(lines, sensor.words);
  // Never a machine word on screen: his text exactly, or nothing.
  if (!verifyRoundTrip(aligned, cards)) {
    return { ok: false, error: 'The timing did not keep your lines exactly as written, so it was not used. Tap to time them instead.' };
  }
  const spans = sensor.activity ? activeSpans(sensor.activity) : [];
  const placed = placeInSinging(aligned, spans, { verseStarts }).map((c, i) => {
    // A heard line clears a second after its last heard word, unless the next line comes first.
    const lastEnd = aligned[i].lastWordEndSec;
    return lastEnd === null ? c : { ...c, endMs: Math.min(c.endMs, Math.round((lastEnd + 1) * 1000)) };
  });

  const duration = sensor.durationSec;
  const out: TimedLine[] = [];
  for (let i = 0; i < placed.length; i++) {
    const prevEnd = out.length ? out[out.length - 1].endSec : 0;
    let start = r2(Math.max(placed[i].startMs / 1000, prevEnd));
    let end = r2(Math.min(placed[i].endMs / 1000, duration));
    if (start > duration - MIN_BLOCK_SEC) start = r2(Math.max(prevEnd, duration - MIN_BLOCK_SEC));
    if (end - start < MIN_BLOCK_SEC) end = r2(Math.min(duration, start + MIN_BLOCK_SEC));
    if (end - start < MIN_BLOCK_SEC) {
      return { ok: false, error: 'There is not enough room in this video for every line. Tap to time them instead.' };
    }
    out.push({ text: lines[i], startSec: start, endSec: end, heard: placed[i].anchored });
  }
  return { ok: true, lines: out };
}

/**
 * Put the timed lines on the timeline. Title and credits stay as they are; the
 * lyric track is replaced by one block per line, keeping a line's existing
 * block id when the same text sits at the same position (so nothing flickers).
 */
export function applyTimedLines(blocks: TextBlock[], lines: TimedLine[], makeId: () => string): TextBlock[] {
  const others = blocks.filter((b) => b.track !== 'lyric');
  const lyric = blocks.filter((b) => b.track === 'lyric').sort((a, b) => a.startSec - b.startSec);
  const timed: TextBlock[] = lines.map((l, i) => ({
    id: lyric[i] && lyric[i].text === l.text ? lyric[i].id : makeId(),
    track: 'lyric',
    text: l.text,
    startSec: l.startSec,
    endSec: l.endSec,
  }));
  return [...others, ...timed];
}

/**
 * The three small files that hold one source video's automatic timing: the
 * run's start stamp, the words the worker heard, and its error if it failed.
 * The worker may write only under audio/mastering/lyric-timing/.
 */
export function lyricTimingKeys(projectId: string, sourceKey: string) {
  const base = (sourceKey.split('/').pop() ?? 'source').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const prefix = `audio/mastering/lyric-timing/${projectId}/${base}`;
  return { words: `${prefix}.words.json`, error: `${prefix}.error.json`, started: `${prefix}.started.json` };
}

/**
 * The same three files for a Visual Story's song: keyed by the story and its
 * master audio, so editing the lyrics re-aligns for free and a different
 * master is listened to afresh.
 */
export function storyLyricTimingKeys(vsId: string, audioKey: string) {
  return lyricTimingKeys(`vs/${vsId}`, audioKey);
}
