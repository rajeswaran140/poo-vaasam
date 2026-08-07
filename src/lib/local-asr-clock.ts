/**
 * Building a song's own clock LOCALLY, so lyric timing no longer depends on
 * YouTube having generated an auto-caption track.
 *
 * WHY. caption-alignment.ts times Raj's verbatim lyrics against a machine
 * transcript — his words, the machine's clock. That works, but the clock came
 * from YouTube's ASR track, which is an external dependency with three failure
 * modes we have actually hit: the track may not exist yet, it may be deleted
 * (2026-08-02: I deleted one before verifying its replacement and destroyed the
 * only clock the aligner could use), and it cannot be consulted at all BEFORE a
 * video is uploaded. A local clock removes all three — a song can be captioned
 * from its master, before anyone publishes anything.
 *
 * ⚠️ THE TRANSCRIPT IS STILL NOT TRUSTED. Nothing here changes the contract:
 * timings from the machine, words from Raj, `verifyRoundTrip` failing the whole
 * alignment rather than letting a machine word reach a caption. Measured on
 * வானவில்லே 2026-08-07, the recogniser heard மலை for மழை, காலும் for காலம் and
 * "என்னை ஆருறிவா" for "என்ன யாரறிவார்" — wrong in detail, right in position.
 * That is exactly the signal the aligner wants and exactly the text it discards.
 *
 * Pure and I/O-free. Running the separator and the recogniser lives in
 * scripts/align-lyrics.ts; the judgement lives here so it can be tested without
 * a 5-minute CPU job.
 */

import type { AsrCue } from '@/lib/caption-alignment';

/** One recognised word with its own timing. */
export interface AsrWord {
  /** Seconds from the start of the track. */
  start: number;
  end: number;
  word: string;
}

/**
 * ⚠️ VOICE-ACTIVITY FILTERING MUST BE OFF FOR SINGING.
 *
 * Measured 2026-08-07 on a 60s excerpt of வானவில்லே: with faster-whisper's
 * `vad_filter=True` (its default recommendation, tuned for speech) the model
 * returned **zero** segments from a vocal stem that was demonstrably full of
 * singing — sustained vowels and reverb tails do not look like speech to a
 * speech VAD. The same audio with the filter off produced six correctly-ordered
 * segments. A silent failure, so it is recorded rather than left as a flag.
 */
export const VAD_MUST_BE_DISABLED = true;

/**
 * ⚠️ SEPARATE THE VOCAL FIRST — it is not an optimisation.
 *
 * Same measurement, same excerpt. Run against the full mix the recogniser stuck,
 * emitting "வாழ்ந்த கதையென்னா வென்பா" three times across 0-29s — a repeated
 * hallucination that would have anchored three different lyric lines to the same
 * stretch of song. Run against the Demucs vocal stem it progressed cleanly
 * through six distinct lines. The separation buys correctness, not tidiness.
 */
export const SEPARATE_VOCAL_FIRST = true;

export interface CueGroupingOptions {
  /** A silence at least this long ends the current cue. */
  gapMs?: number;
  /** No cue may run longer than this, however continuous the singing. */
  maxCueMs?: number;
  /** Cues shorter than this are merged forward rather than left to flicker. */
  minCueMs?: number;
}

const DEFAULTS = { gapMs: 400, maxCueMs: 4000, minCueMs: 700 } as const;

/**
 * Regroup word-level recognition into SHORT cues.
 *
 * ⚠️ THIS EXISTS BECAUSE THE TWO RECOGNISERS DISAGREE ABOUT CUE LENGTH.
 * alignLyrics matches at line level and its docstring is explicit that "the
 * recogniser emits short fragments" — true of YouTube's track, false of Whisper,
 * which returns 10-25 second segments spanning whole stanzas. Feeding those in
 * directly gives the matcher one blob where it expects several fragments, and
 * every line in the stanza competes for the same anchor. Splitting on the
 * silences BETWEEN sung phrases restores the granularity the matcher was
 * designed around.
 *
 * Grouping is on pauses first and length second, because a pause is where a
 * singer actually ends a phrase, whereas a duration cap is only a backstop for
 * a held note or a run-on line.
 */
export function wordsToCues(words: AsrWord[], options: CueGroupingOptions = {}): AsrCue[] {
  const { gapMs, maxCueMs, minCueMs } = { ...DEFAULTS, ...options };

  const usable = words
    .filter((w) => w.word.trim().length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
  if (!usable.length) return [];

  const cues: AsrCue[] = [];
  let bucket: AsrWord[] = [];

  const flush = () => {
    if (!bucket.length) return;
    cues.push({
      startMs: Math.round(bucket[0].start * 1000),
      endMs: Math.round(bucket[bucket.length - 1].end * 1000),
      text: bucket.map((w) => w.word.trim()).join(' ').replace(/\s{2,}/g, ' ').trim(),
    });
    bucket = [];
  };

  for (const w of usable) {
    if (!bucket.length) {
      bucket = [w];
      continue;
    }
    const prev = bucket[bucket.length - 1];
    const gap = (w.start - prev.end) * 1000;
    const spanIfAdded = (w.end - bucket[0].start) * 1000;
    if (gap >= gapMs || spanIfAdded > maxCueMs) {
      flush();
      bucket = [w];
    } else {
      bucket.push(w);
    }
  }
  flush();

  return mergeShortCues(cues, minCueMs);
}

/**
 * Fold away cues too short to be matched on.
 *
 * A one-syllable fragment carries almost no text for the similarity score, so
 * left alone it becomes a near-random anchor. Merging it into its NEAREST
 * neighbour keeps its timing information — which is the part we actually want —
 * without letting it compete as a match on its own.
 */
export function mergeShortCues(cues: AsrCue[], minCueMs: number = DEFAULTS.minCueMs): AsrCue[] {
  if (cues.length <= 1) return cues;
  const out: AsrCue[] = [];
  for (const cue of cues) {
    const prev = out[out.length - 1];
    const tooShort = cue.endMs - cue.startMs < minCueMs;
    if (tooShort && prev) {
      prev.endMs = cue.endMs;
      prev.text = `${prev.text} ${cue.text}`.trim();
    } else {
      out.push({ ...cue });
    }
  }
  // A short FIRST cue has no earlier neighbour to fold into; fold it backwards.
  if (out.length > 1 && out[0].endMs - out[0].startMs < minCueMs) {
    out[1].startMs = out[0].startMs;
    out[1].text = `${out[0].text} ${out[1].text}`.trim();
    out.shift();
  }
  return out;
}

/**
 * How much of the track the clock actually covers, 0..1.
 *
 * The single most useful health number, because the failure this whole module
 * exists to prevent is EXACTLY a coverage failure: வானவில்லே's published track
 * held all 64 cues between 00:00 and 03:11 of a longer song, in flat 2.8-second
 * steps. Any clock that stops early produces captions that drift and then stop,
 * and that is visible here before anything is published.
 */
export function clockCoverage(cues: AsrCue[], durationSec: number): number {
  if (!cues.length || durationSec <= 0) return 0;
  const last = Math.max(...cues.map((c) => c.endMs));
  return Math.min(1, last / (durationSec * 1000));
}

/**
 * How far past the end of the audio a caption may run before it is a fault.
 *
 * Not zero: the last cue legitimately holds its minimum readable duration, and
 * a track's reported length and its final sample disagree by a few tens of
 * milliseconds. Two seconds distinguishes that from extrapolation, which
 * overshot by 49 seconds when it was measured.
 */
export const OVERRUN_TOLERANCE_MS = 2000;

/** Minimal shape of an aligned cue — enough to judge the OUTPUT, not the clock. */
interface TimedCue {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Why the produced caption file is unusable, or null if it looks sane.
 *
 * ⚠️ THIS EXISTS BECAUSE A GOOD CLOCK AND AN INTACT ROUND-TRIP ARE NOT ENOUGH.
 * Measured on வானவில்லே 2026-08-07: the clock covered 99.6% of the song and
 * `verifyRoundTrip` passed, and the file was still garbage — every one of the
 * 128 lines in ONE six-second caption. The lyrics file was the stanza-stripped
 * variant kept for caption upload, so it had no blank lines, so
 * `splitLyricsIntoCards` returned a single card and the aligner faithfully
 * timed that one card. Nothing lied; the two checks in place simply measured
 * different things than the thing that was wrong.
 *
 * So the OUTPUT gets its own check. The failures below are the ones that make a
 * caption file worthless no matter how good the alignment was.
 */
export function captionShapeProblem(cues: TimedCue[], durationSec: number): string | null {
  if (!cues.length) return 'no cues were produced — nothing to publish';

  if (cues.length === 1 && durationSec > 60) {
    return (
      'every lyric landed in ONE caption — the lyrics file almost certainly has no blank ' +
      'lines between stanzas, so it was read as a single card. Use the stanza-separated copy.'
    );
  }

  const last = Math.max(...cues.map((c) => c.endMs));
  if (last < durationSec * 1000 * 0.4) {
    return (
      `captions stop at ${Math.round(last / 1000)}s of a ${Math.round(durationSec)}s song — ` +
      'the back half would be silent. This is the failure the published track already had.'
    );
  }

  // ⚠️ AND THE OPPOSITE FAILURE, which is easy to miss because "coverage" looks
  // healthy. Measured 2026-08-07: the last caption ended at 390s of a 341s song
  // — 114% — because interpolation past the final anchor keeps extrapolating.
  // Captions timed after the audio ends simply never appear, so the song ends
  // with its last lines silently dropped.
  if (last > durationSec * 1000 + OVERRUN_TOLERANCE_MS) {
    return (
      `captions run to ${Math.round(last / 1000)}s but the song ends at ${Math.round(durationSec)}s — ` +
      'the final lines would never appear. Interpolation has extrapolated past the last anchor.'
    );
  }

  // A caption nobody can read is not a caption. 12 lines is already generous:
  // the on-screen card in generate-song-short.ts shows far fewer.
  const worst = Math.max(...cues.map((c) => c.text.split('\n').length));
  if (worst > 12) {
    return `one caption holds ${worst} lines — too many to read before it changes`;
  }

  return null;
}
