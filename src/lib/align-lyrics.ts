/**
 * Align human-authored lyric lines to a YouTube ASR caption track's real,
 * audio-aligned timestamps — so a clean lyric caption inherits accurate timing
 * (incl. the instrumental gaps between stanzas) without anyone hand-syncing.
 *
 * ASR text is usually close but messy and finer-grained (it splits a lyric line
 * into half-line cues). We walk both sequences in order: for each lyric line we
 * find the next ASR cue whose words overlap the line's opening, and adopt that
 * cue's start. A monotonic pointer makes repeated lines (a recurring pallavi)
 * align to successive occurrences in time. `fillStarts` then interpolates any
 * unmatched lines between anchors so every line gets a sensible start.
 *
 * Pure + unit-tested. Matching reuses the NFC/lowercase normaliser from search.
 */

import { normalizeForSearch } from '@/lib/search-match';
import type { CaptionCue } from '@/lib/captions';

function tokens(s: string): string[] {
  return normalizeForSearch(s).split(' ').filter(Boolean);
}

export interface AlignOptions {
  /** How many ASR cues ahead to scan for a match (bounds drift on a missing line). */
  window?: number;
}

/**
 * Returns a start time (seconds) per lyric line, or undefined where no confident
 * ASR match was found within the look-ahead window.
 */
export function alignLyricsToAsr(
  lyricLines: string[],
  asrCues: CaptionCue[],
  opts: AlignOptions = {}
): (number | undefined)[] {
  const window = opts.window ?? 8;
  const starts: (number | undefined)[] = new Array(lyricLines.length).fill(undefined);
  let ptr = 0;

  for (let i = 0; i < lyricLines.length; i++) {
    const head = tokens(lyricLines[i]).slice(0, 3);
    if (head.length === 0) continue;

    let found = -1;
    let frac = 0;
    for (let k = ptr; k < Math.min(asrCues.length, ptr + window); k++) {
      const ct = tokens(asrCues[k].text);
      const pos = ct.findIndex((t) => head.includes(t));
      if (pos >= 0) {
        found = k;
        // ASR cues often straddle line boundaries (a cue holds the END of one
        // line + the START of the next). If this line's first word sits mid-cue,
        // interpolate its time to that word's position so the line doesn't fire
        // at the cue's start (which caused later lines to run "a little fast").
        frac = ct.length > 0 ? pos / ct.length : 0;
        break;
      }
    }
    if (found >= 0) {
      const c = asrCues[found];
      starts[i] = c.start + frac * Math.max(0, c.end - c.start);
      ptr = found + 1;
    }
  }
  return starts;
}

/** Explode ASR cues into a per-word timeline (words spread evenly within a cue). */
function asrWordTimeline(asrCues: CaptionCue[]): { w: string; t: number }[] {
  const out: { w: string; t: number }[] = [];
  for (const c of asrCues) {
    const ws = tokens(c.text);
    const span = Math.max(0, c.end - c.start);
    ws.forEach((w, i) => out.push({ w, t: c.start + (ws.length > 1 ? (i / ws.length) * span : 0) }));
  }
  return out;
}

/** Two words match on exact (normalised) equality or a shared 4+ char prefix
 *  (tolerates ASR inflection/segmentation noise). */
function wordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a));
}

/**
 * Phrase/word-level alignment: thread the lyric WORD stream through the ASR's
 * per-word timeline (monotonic, windowed) and start each line at its first
 * matched word's real time. Finer + steadier than {@link alignLyricsToAsr},
 * which only anchors on a line's leading token and so drifts where ASR cues
 * merge across line boundaries. Returns a start per line (undefined if no word
 * matched) — pair with {@link fillStarts}.
 */
export function alignLyricLineStarts(
  lyricLines: string[],
  asrCues: CaptionCue[],
  opts: AlignOptions = {}
): (number | undefined)[] {
  const window = opts.window ?? 14;
  const asr = asrWordTimeline(asrCues);
  const starts: (number | undefined)[] = new Array(lyricLines.length).fill(undefined);
  let ai = 0;

  lyricLines.forEach((line, li) => {
    for (const word of tokens(line)) {
      let found = -1;
      for (let k = ai; k < Math.min(asr.length, ai + window); k++) {
        if (wordMatch(asr[k].w, word)) {
          found = k;
          break;
        }
      }
      if (found >= 0) {
        if (starts[li] === undefined) starts[li] = asr[found].t; // first matched word of the line
        ai = found + 1;
      }
    }
  });
  return starts;
}

/**
 * Fill undefined starts by linear interpolation between matched anchors, bounded
 * by [startSec, totalSec], and force the result monotonic non-decreasing. With no
 * anchors at all, falls back to even distribution.
 */
export function fillStarts(
  starts: (number | undefined)[],
  totalSec: number,
  startSec = 0
): number[] {
  const n = starts.length;
  if (n === 0) return [];

  const known: [number, number][] = [];
  starts.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) known.push([i, v]);
  });

  if (known.length === 0) {
    const span = (totalSec - startSec) / n;
    return starts.map((_, i) => startSec + i * span);
  }

  // Virtual end anchors bound the interpolation cleanly.
  const anchors: [number, number][] = [[-1, startSec], ...known, [n, totalSec]];
  const out: number[] = new Array(n);
  for (let a = 0; a < anchors.length - 1; a++) {
    const [i0, v0] = anchors[a];
    const [i1, v1] = anchors[a + 1];
    for (let i = Math.max(0, i0); i < Math.min(n, i1); i++) {
      out[i] = i1 === i0 ? v0 : v0 + (v1 - v0) * ((i - i0) / (i1 - i0));
    }
  }
  // Preserve exact anchor values + enforce monotonicity.
  for (const [i, v] of known) out[i] = v;
  for (let i = 0; i < n; i++) if (out[i] == null) out[i] = i > 0 ? out[i - 1] : startSec;
  for (let i = 1; i < n; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
  return out;
}
