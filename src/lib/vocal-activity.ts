/**
 * Keeping unheard lyric lines where the singing is.
 *
 * WHY. The recogniser misses whole verses. On பூவும் காற்றும் (4:06, 2026-11-12)
 * it heard nothing from 2:49 to 3:30 while the vocal was plainly there, and
 * `alignLyrics` spread the unheard lines evenly between the lines it did hear,
 * so lines landed in the music breaks. The separated vocal's loudness still
 * shows when someone is singing, so unheard lines are placed only inside those
 * stretches, in order, sharing the singing time equally.
 *
 * Pure and I/O-free. The worker (worker/lyric_timing_worker) only measures the
 * loudness every 0.1 s; every threshold lives here.
 */
import type { AlignedCue } from '@/lib/caption-alignment';

export interface VocalActivity {
  hopSec: number;
  /** Loudness of the vocal stem per hop, whole dBFS. */
  db: number[];
}

export interface Span {
  startSec: number;
  endSec: number;
}

export interface ActivityOptions {
  /** Never call anything quieter than this singing. */
  floorDb?: number;
  /** Singing is within this many dB of the loud end of the vocal (its 95th percentile). */
  rangeDb?: number;
  /** A gap shorter than this is a breath, not a break. */
  bridgeSec?: number;
  /** A stretch shorter than this is a click or a bleed, not a line. */
  minSpanSec?: number;
}

const DEFAULTS: Required<ActivityOptions> = { floorDb: -50, rangeDb: 24, bridgeSec: 1.2, minSpanSec: 0.4 };

/** The stretches where the vocal stem has singing in it. */
export function activeSpans(activity: VocalActivity, options: ActivityOptions = {}): Span[] {
  const { floorDb, rangeDb, bridgeSec, minSpanSec } = { ...DEFAULTS, ...options };
  const { db, hopSec } = activity;
  if (!db.length || !(hopSec > 0)) return [];
  const sorted = [...db].sort((a, b) => a - b);
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const threshold = Math.max(floorDb, loud - rangeDb);

  const raw: Span[] = [];
  let open: number | null = null;
  db.forEach((v, i) => {
    if (v >= threshold && open === null) open = i;
    if (v < threshold && open !== null) {
      raw.push({ startSec: open * hopSec, endSec: i * hopSec });
      open = null;
    }
  });
  if (open !== null) raw.push({ startSec: open * hopSec, endSec: db.length * hopSec });

  const bridged: Span[] = [];
  for (const s of raw) {
    const last = bridged[bridged.length - 1];
    if (last && s.startSec - last.endSec < bridgeSec) last.endSec = s.endSec;
    else bridged.push({ ...s });
  }
  return bridged.filter((s) => s.endSec - s.startSec >= minSpanSec).map((s) => ({ startSec: r2(s.startSec), endSec: r2(s.endSec) }));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Seconds of singing between 0 and t. */
function activeBefore(spans: Span[], t: number): number {
  let sum = 0;
  for (const s of spans) {
    if (s.startSec >= t) break;
    sum += Math.min(s.endSec, t) - s.startSec;
  }
  return sum;
}

/** The first instant at which `amount` seconds of singing have passed. */
function instantAfterSinging(spans: Span[], amount: number): number {
  let left = amount;
  for (const s of spans) {
    const len = s.endSec - s.startSec;
    if (left <= len) return s.startSec + left;
    left -= len;
  }
  return spans.length ? spans[spans.length - 1].endSec : 0;
}

export interface PlaceOptions {
  /**
   * Indexes of lines that open a verse (the line after a blank line in Raj's
   * lyrics). A verse usually starts after a music break, so an unheard opening
   * line goes to the first singing after the longest break in its window.
   */
  verseStarts?: ReadonlySet<number>;
  /** A gap in the singing at least this long is a music break. */
  breakSec?: number;
  /** Snap a placed start to a singing onset this close to it. */
  snapSec?: number;
  /** How long a line stays on screen after its singing stretch ends. */
  holdSec?: number;
  /** No caption shorter than this. */
  minLineSec?: number;
}

const PLACE_DEFAULTS: Required<Omit<PlaceOptions, 'verseStarts'>> = { breakSec: 4, snapSec: 1.5, holdSec: 1.0, minLineSec: 1.0 };

/** The singing onset right after the longest break between `from` and `to`, if there is a break. */
function onsetAfterLongestBreak(spans: Span[], from: number, to: number, breakSec: number): number | null {
  let best: { gap: number; onset: number } | null = null;
  for (let k = 1; k < spans.length; k++) {
    const gapStart = spans[k - 1].endSec;
    const onset = spans[k].startSec;
    if (gapStart < from || onset > to) continue;
    const gap = onset - gapStart;
    if (gap >= breakSec && (!best || gap > best.gap)) best = { gap, onset };
  }
  return best ? best.onset : null;
}

/**
 * Re-place the lines the recogniser did not hear, inside the singing.
 *
 * Heard (anchored) lines keep their start. Each run of unheard lines shares the
 * singing time between the heard line before it and the heard line after it
 * equally, and each start snaps to a nearby singing onset (a new line usually
 * begins after a breath). Every line then ends where the next begins, or soon
 * after its own singing stretch ends, so no caption sits through a music break.
 * Text and order never change.
 */
export function placeInSinging(cues: AlignedCue[], spans: Span[], options: PlaceOptions = {}): AlignedCue[] {
  if (!cues.length || !spans.length) return cues.map((c) => ({ ...c }));
  const { snapSec, holdSec, minLineSec, breakSec } = { ...PLACE_DEFAULTS, ...options };
  const verseStarts = options.verseStarts ?? new Set<number>();
  const out = cues.map((c) => ({ ...c }));
  const starts = out.map((c) => c.startMs / 1000);
  const fixed = out.map((c) => c.anchored);
  const firstSung = spans[0].startSec;
  const lastSung = spans[spans.length - 1].endSec;

  /** Unheard lines i..j-1 share the singing between the fixed line before them and the one after. */
  const spread = (i: number, j: number) => {
    const prev = i > 0 ? i - 1 : null;
    const from = prev !== null ? starts[prev] : firstSung;
    const to = j < out.length ? starts[j] : lastSung;
    const shares = j - i + (prev !== null ? 1 : 0);
    const a0 = activeBefore(spans, from);
    const total = Math.max(0, activeBefore(spans, to) - a0);
    for (let k = i; k < j; k++) {
      const nth = k - i + (prev !== null ? 1 : 0);
      starts[k] = instantAfterSinging(spans, a0 + (total * nth) / shares);
    }
  };

  let i = 0;
  while (i < out.length) {
    if (fixed[i]) { i++; continue; }
    let j = i;
    while (j < out.length && !fixed[j]) j++;
    // First pin each unheard verse opening to the singing after the longest
    // break in its window; those then act like heard lines for the rest.
    const from = i > 0 ? starts[i - 1] : firstSung;
    const to = j < out.length ? starts[j] : lastSung;
    for (let k = i; k < j; k++) {
      if (!verseStarts.has(k)) continue;
      const onset = onsetAfterLongestBreak(spans, from, to, breakSec);
      if (onset !== null && (k === 0 || onset > starts[k - 1] || !fixed[k - 1])) {
        starts[k] = onset;
        fixed[k] = true;
        break; // one verse opening per window; the rest of the run is re-split below
      }
    }
    let a = i;
    while (a < j) {
      if (fixed[a]) { a++; continue; }
      let b = a;
      while (b < j && !fixed[b]) b++;
      spread(a, b);
      a = b;
    }
    i = j;
  }

  // Snap unheard starts to a nearby singing onset, keeping order.
  const onsets = spans.map((s) => s.startSec);
  for (let k = 0; k < out.length; k++) {
    if (out[k].anchored) continue;
    const near = onsets.filter((o) => Math.abs(o - starts[k]) <= snapSec);
    if (!near.length) continue;
    const best = near.reduce((a, b) => (Math.abs(b - starts[k]) < Math.abs(a - starts[k]) ? b : a));
    const lo = k > 0 ? starts[k - 1] + minLineSec : -Infinity;
    const hi = k + 1 < out.length ? starts[k + 1] - minLineSec : Infinity;
    if (best >= lo && best <= hi) starts[k] = best;
  }
  // Keep starts strictly increasing with room for each line.
  for (let k = 1; k < starts.length; k++) starts[k] = Math.max(starts[k], starts[k - 1] + minLineSec);

  // The stretch a line is sung in: the one it starts inside, or one starting
  // just after it (a heard start can sit a moment before the loudness rises).
  const spanEndAt = (t: number) => spans.find((s) => s.startSec <= t + 0.5 && t < s.endSec)?.endSec ?? null;
  for (let k = 0; k < out.length; k++) {
    const next = k + 1 < out.length ? starts[k + 1] : Math.max(lastSung + holdSec, starts[k] + minLineSec);
    const sungUntil = spanEndAt(starts[k]);
    let end = next;
    if (sungUntil !== null) end = Math.min(next, sungUntil + holdSec);
    end = Math.max(end, Math.min(next, starts[k] + minLineSec));
    out[k].startMs = Math.round(starts[k] * 1000);
    out[k].endMs = Math.round(end * 1000);
  }
  return out;
}
