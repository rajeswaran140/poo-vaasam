/**
 * Fit a story's rows to the sung lines (design 2026-11-13 §5.2, "Keep my
 * rows"): the rows keep their count and order and only the cuts move. Inside
 * singing a cut lands only on a line start (floored to the tenth, so at or
 * before the first sung word); inside a music break it may land anywhere.
 * Each row aims at its own clip's length; a made clip is trimmed or slowed
 * (visual-story-clip-fit.ts), and a Grok clip that cannot fit is marked out of
 * date rather than refused, so Raj sees what a fit would cost.
 *
 * Exact, not greedy: dynamic programming over (row, cut) in integer tenths.
 * Pure and client-safe: the panel runs it in the browser.
 */
import type { TimedLine } from '@/lib/video-text/lyric-timing';
import { clipFitFor, MIN_PLAYBACK_RATE, type ClipFit } from '@/lib/visual-story-clip-fit';
import { MAX_OWN_CLIP_SEC, MAX_SHOT_SEC, MIN_SHOT_SEC } from '@/types/visualStory';

/** A gap this long between two lines is a music break. */
export const BREAK_GAP_SEC = 4;
/** A break starts this long after the last line's end (the word's tail rings on). */
export const BREAK_LEAD_SEC = 0.3;

/** A timed line in story time (0 = the window's start). */
export interface WindowLine {
  text: string;
  startSec: number;
  endSec: number;
  heard: boolean;
}

const hundredth = (n: number) => Math.round(n * 100) / 100;
/** Seconds → whole tenths, floored, without float noise (29.86 → 298, 141.98 → 1419). */
const floorTenths = (s: number) => Math.floor(Math.round(s * 1000) / 100);
const ceilTenths = (s: number) => Math.ceil(Math.round(s * 1000) / 100);

/** The lines that start inside the window, shifted to window time. */
export function linesInWindow(lines: TimedLine[], windowStartSec: number, windowEndSec: number): WindowLine[] {
  const len = windowEndSec - windowStartSec;
  return lines
    .filter((l) => l.startSec >= windowStartSec && l.startSec < windowEndSec)
    .map((l) => ({
      text: l.text,
      startSec: hundredth(l.startSec - windowStartSec),
      endSec: hundredth(Math.min(l.endSec - windowStartSec, len)),
      heard: l.heard,
    }));
}

export interface CutGrid {
  /** Where a cut may go, in whole tenths, ascending; never 0 or the window's end. */
  tenths: number[];
  /** Music breaks [from, to] in tenths (intro, between verses, tail). */
  breaks: Array<[number, number]>;
}

export function cutGrid(lines: WindowLine[], windowSec: number): CutGrid {
  const W = Math.round(windowSec * 10);
  const breaks: Array<[number, number]> = [];
  if (!lines.length) breaks.push([0, W]);
  else {
    breaks.push([0, floorTenths(lines[0].startSec)]);
    for (let k = 0; k < lines.length; k++) {
      const next = lines[k + 1];
      if (next && next.startSec - lines[k].endSec < BREAK_GAP_SEC) continue;
      const from = ceilTenths(lines[k].endSec + BREAK_LEAD_SEC);
      // Clamped to the next line's floored start, so a cut never lands inside it.
      const to = next ? floorTenths(next.startSec) : W;
      if (from <= to) breaks.push([from, to]);
    }
  }
  const set = new Set<number>(lines.map((l) => floorTenths(l.startSec)));
  for (const [a, b] of breaks) for (let t = a; t <= b; t++) set.add(t);
  const tenths = [...set].filter((t) => t > 0 && t < W).sort((a, b) => a - b);
  return { tenths, breaks };
}

export interface FitRowIn {
  /** The made clip's length; null = unknown (made before 2026-11-13) or none. */
  clipSec: number | null;
  /** The row shows a made clip (Grok's or the admin's own). */
  isClip: boolean;
  /** The clip is the admin's own upload (never re-made by Grok). */
  isOwn: boolean;
  /** The next row continues from this clip's last frame. */
  continuedFrom: boolean;
  currentSec: number;
}

export interface FitRowOut {
  startSec: number;
  endSec: number;
  durationSec: number;
  /** What happens to the row's clip; null for a picture. */
  fit: ClipFit | null;
  /** The window lines (1-based) that start in this row, or null for music only. */
  lines: [number, number] | null;
}

export type KeepRowsFit = { ok: true; rows: FitRowOut[]; staleCount: number } | { ok: false; error: string };

const STALE_COST = 1000;
const MAX_SPAN = MAX_OWN_CLIP_SEC * 10;

interface Bounds {
  lo: number;
  hi: number;
  target: number;
  /** A Grok clip that cannot fit may be marked out of date (made again) at STALE_COST. */
  canStale: boolean;
}

function boundsFor(r: FitRowIn, minRate: number): Bounds {
  const anyLen = { lo: MIN_SHOT_SEC * 10, hi: MAX_SHOT_SEC * 10 };
  const cur = Math.round(r.currentSec * 10);
  if (!r.isClip) return { ...anyLen, target: cur, canStale: false };
  const c = r.clipSec ?? (r.isOwn ? r.currentSec : null);
  // Unknown length (made before 2026-11-13): kept exactly as it is, never trimmed, slowed or re-made on a guess.
  if (c === null) return { lo: cur, hi: cur, target: cur, canStale: false };
  const ct = Math.round(c * 10);
  const max = r.isOwn ? MAX_OWN_CLIP_SEC * 10 : MAX_SHOT_SEC * 10;
  const hi = Math.min(max, Math.floor(Math.round((c / minRate) * 1e6) / 1e5));
  return { lo: r.continuedFrom ? ct : MIN_SHOT_SEC * 10, hi, target: ct, canStale: !r.isOwn };
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export function fitKeepRows(
  rows: FitRowIn[],
  lines: WindowLine[],
  windowSec: number,
  opts: { minRate?: number } = {}
): KeepRowsFit {
  const minRate = opts.minRate ?? MIN_PLAYBACK_RATE;
  const W = Math.round(windowSec * 10);
  const pos = [0, ...cutGrid(lines, windowSec).tenths, W];
  const P = pos.length;
  const n = rows.length;
  const bounds = rows.map((r) => boundsFor(r, minRate));
  const INF = Number.POSITIVE_INFINITY;
  // cost[k][j]: best cost with the first k rows ending at pos[j]; from/stale for the way back.
  const cost: Float64Array[] = [];
  const from: Int32Array[] = [];
  const stale: Uint8Array[] = [];
  for (let k = 0; k <= n; k++) {
    cost.push(new Float64Array(P).fill(INF));
    from.push(new Int32Array(P).fill(-1));
    stale.push(new Uint8Array(P));
  }
  cost[0][0] = 0;
  for (let k = 0; k < n; k++) {
    const b = bounds[k];
    const prev = cost[k];
    const next = cost[k + 1];
    for (let i = 0; i < P; i++) {
      if (prev[i] === INF) continue;
      for (let j = i + 1; j < P; j++) {
        const len = pos[j] - pos[i];
        if (len > MAX_SPAN) break;
        let c = INF;
        let s = 0;
        if (len >= b.lo && len <= b.hi) c = prev[i] + ((len - b.target) * (len - b.target)) / 100;
        else if (b.canStale && len >= MIN_SHOT_SEC * 10 && len <= MAX_SHOT_SEC * 10) {
          c = prev[i] + STALE_COST;
          s = 1;
        }
        // Strictly less: the earliest previous cut wins a tie.
        if (c < next[j]) {
          next[j] = c;
          from[k + 1][j] = i;
          stale[k + 1][j] = s;
        }
      }
    }
  }
  if (!n || cost[n][P - 1] === INF) {
    return {
      ok: false,
      error: `These ${n} rows cannot cover ${mmss(windowSec)} with every cut on a line start or in the music. Add or remove a row.`,
    };
  }

  const cuts: Array<{ a: number; b: number; stale: boolean }> = [];
  for (let k = n, j = P - 1; k > 0; k--) {
    const i = from[k][j];
    cuts.push({ a: pos[i], b: pos[j], stale: stale[k][j] === 1 });
    j = i;
  }
  cuts.reverse();

  const starts = lines.map((l) => floorTenths(l.startSec));
  let staleCount = 0;
  const out: FitRowOut[] = cuts.map(({ a, b, stale: isStale }, k) => {
    const r = rows[k];
    const durationSec = (b - a) / 10;
    let fit: ClipFit | null = null;
    if (r.isClip) {
      fit = isStale
        ? { kind: 'stale' }
        : clipFitFor(r.clipSec ?? (r.isOwn ? r.currentSec : null), durationSec, { continuedFrom: r.continuedFrom, minRate });
    }
    if (fit?.kind === 'stale') staleCount++;
    const inRow = starts.map((t, i) => (t >= a && t < b ? i + 1 : 0)).filter(Boolean);
    return {
      startSec: a / 10,
      endSec: b / 10,
      durationSec,
      fit,
      lines: inRow.length ? [inRow[0], inRow[inRow.length - 1]] : null,
    };
  });
  return { ok: true, rows: out, staleCount };
}
