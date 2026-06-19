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
    for (let k = ptr; k < Math.min(asrCues.length, ptr + window); k++) {
      const ct = tokens(asrCues[k].text);
      if (ct.some((t) => head.includes(t))) {
        found = k;
        break;
      }
    }
    if (found >= 0) {
      starts[i] = asrCues[found].start;
      ptr = found + 1;
    }
  }
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
