/**
 * Timing Raj's verbatim lyrics against a song's own auto-caption track.
 *
 * WHY THIS EXISTS. YouTube's `captions.insert?sync=true` is documented as
 * "YouTube will disregard any time codes in the uploaded file and generate new
 * ones". It does not. Proven 2026-07-30: a track copied onto a 7:35 video came
 * back byte-identical to its 6:28 source, and on 2026-08-02 a lyrics track on a
 * 6:24 song was found holding all 20 cues between 00:00 and 01:20 — placeholder
 * 4-second steps, used verbatim. Uploaded cue times are ALWAYS used as given, so
 * anything that publishes lyrics must compute real ones first.
 *
 * THE METHOD — "ASR as clock". Tamil speech recognition is a bad transcript of
 * sung Tamil (it mishears வாசம் as பாசம்) but a good CLOCK: it reliably marks
 * *when* singing happens. So we take the timings from the machine track and the
 * words from Raj — never the reverse. His text is emitted byte-for-byte;
 * `verifyRoundTrip` fails the whole alignment rather than let a machine word
 * reach a caption.
 *
 * WHY GLOBAL ALIGNMENT AND NOT GREEDY. The first implementation matched each
 * line to the best cue in a small forward window. It anchored most lines but let
 * repeated refrains fall through to interpolation, and across four choruses that
 * interpolation stretched — captions drifted progressively later through the
 * back half of the song. Needleman-Wunsch over ALL lines x ALL cues at once
 * resolves each repetition to its own occurrence, because the traceback can only
 * produce a non-crossing (monotonic) matching: chorus 3 cannot claim chorus 1's
 * slot without stranding everything between them. நெஞ்சக் கூட்டினிலே repeats a
 * stanza three times and another twice, which is exactly the case that broke the
 * greedy version.
 *
 * Pure and I/O-free. Fetching the ASR track, and publishing the result, live
 * elsewhere — so the judgement-bearing part is unit-testable without a network.
 */

/** One cue from the machine-generated track: timings we trust, text we don't. */
export interface AsrCue {
  startMs: number;
  endMs: number;
  text: string;
}

/** A caption card: the lines Raj wrote, kept together as he grouped them. */
export type LyricCard = string[];

export interface AlignedCue {
  startMs: number;
  endMs: number;
  /** Raj's lines, joined with newlines. Never machine text. */
  text: string;
  /** true = matched to a real ASR cue; false = interpolated between anchors. */
  anchored: boolean;
}

export interface AlignmentResult {
  cues: AlignedCue[];
  anchoredLines: number;
  interpolatedLines: number;
  /** Non-fatal observations worth showing before anyone publishes. */
  warnings: string[];
}

export interface AlignOptions {
  /** Below this similarity a line/cue pair is not considered a match at all. */
  matchFloor?: number;
  /** A caption shorter than this flickers unreadably. */
  minCueMs?: number;
  /** A caption longer than this has outstayed its line. */
  maxCueMs?: number;
}

const DEFAULTS = { matchFloor: 0.45, minCueMs: 1200, maxCueMs: 6000 } as const;

/**
 * Cues that carry no lyric content. YouTube emits these for instrumental
 * passages; they have timings but nothing to match against, and leaving them in
 * lets a line anchor to a stretch where nobody is singing.
 */
export function isMusicMarker(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // [இசை] / [Music] / [♪] and friends — a bracketed or symbol-only cue.
  if (/^[[(（【]/.test(t) && /[\])）】]$/.test(t)) return true;
  return /^[♪♫\s.·—–-]+$/.test(t);
}

/**
 * Strip everything that varies between how Raj writes a line and how the
 * recogniser hears it: punctuation, the ellipses he uses for held notes, and
 * spacing. Tamil script itself is left untouched — normalising it further (e.g.
 * dropping combining marks) would collapse genuinely different words.
 */
export function normaliseForMatch(text: string): string {
  return text
    // Bracketed annotations are dropped WHOLE, not just de-bracketed. Real
    // tracks append them inline — `நெஞ்ச கூட்டினிலே [பாடுதல்]` — so leaving
    // "பாடுதல்" behind as a token would depress every match on the song and
    // reward whichever line happened to be longest.
    .replace(/[[(（【][^\])）】]*[\])）】]/g, ' ')
    .replace(/[.,!?;:"'`|/\\~^*_=+<>{}[\]()–—-]/g, ' ')
    .replace(/[.]{2,}|…/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const t = s.replace(/\s/g, '');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen-Dice over character bigrams — a stand-in for difflib's ratio(). */
function diceCoefficient(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return a === b ? 1 : 0;
  let shared = 0;
  for (const [g, n] of A) shared += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return (2 * shared) / total;
}

function tokenJaccard(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * How much a lyric line and an ASR cue look like the same moment. Blends
 * character-level and token-level agreement so neither a single misheard word
 * nor a different word order alone sinks a real match, with a bonus when one
 * string contains the other (the recogniser often catches only a fragment).
 */
export function similarity(lyricLine: string, cueText: string): number {
  const a = normaliseForMatch(lyricLine);
  const b = normaliseForMatch(cueText);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const base = 0.6 * diceCoefficient(a, b) + 0.4 * tokenJaccard(a, b);
  const contains = a.includes(b) || b.includes(a);
  return Math.min(1, base + (contains ? 0.15 : 0));
}

/**
 * Maximum-weight NON-CROSSING matching between lines and cues.
 *
 * Standard Needleman-Wunsch shape: skipping is free on both sides (a lyric line
 * the recogniser never caught, or a cue with no lyric), and a pair is only
 * allowed to match when it clears the floor. Because the recurrence can only
 * step diagonally, the recovered matching is monotonic in both sequences —
 * which is precisely the property that keeps repeated refrains in order.
 */
function globalMatch(
  lines: string[],
  cues: AsrCue[],
  floor: number
): Map<number, number> {
  const m = lines.length;
  const n = cues.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  const w = (i: number, j: number): number => {
    const s = similarity(lines[i], cues[j].text);
    return s >= floor ? s : Number.NEGATIVE_INFINITY;
  };
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const diag = w(i - 1, j - 1);
      dp[i][j] = Math.max(
        dp[i - 1][j],
        dp[i][j - 1],
        diag === Number.NEGATIVE_INFINITY ? Number.NEGATIVE_INFINITY : dp[i - 1][j - 1] + diag
      );
    }
  }
  const pairs = new Map<number, number>();
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const diag = w(i - 1, j - 1);
    if (diag !== Number.NEGATIVE_INFINITY && dp[i][j] === dp[i - 1][j - 1] + diag) {
      pairs.set(i - 1, j - 1);
      i--;
      j--;
    } else if (dp[i][j] === dp[i - 1][j]) {
      i--;
    } else {
      j--;
    }
  }
  return pairs;
}

/**
 * Give every line a start time: anchored lines take their cue's, unanchored
 * lines are spaced evenly between the anchors on either side. Lines before the
 * first anchor or after the last are extrapolated using the local spacing, so a
 * song whose opening line the recogniser missed still starts in the right place
 * rather than at 00:00.
 */
function fillStarts(lineCount: number, anchors: Map<number, number>, cues: AsrCue[]): number[] {
  const starts = new Array<number>(lineCount).fill(NaN);
  for (const [line, cue] of anchors) starts[line] = cues[cue].startMs;

  const known = [...anchors.keys()].sort((a, b) => a - b);
  if (!known.length) return starts;

  const gap = (() => {
    if (known.length < 2) return 3000;
    const first = known[0];
    const last = known[known.length - 1];
    return Math.max(500, (starts[last] - starts[first]) / (last - first));
  })();

  for (let i = 0; i < lineCount; i++) {
    if (!Number.isNaN(starts[i])) continue;
    const prev = [...known].reverse().find((k) => k < i);
    const next = known.find((k) => k > i);
    if (prev !== undefined && next !== undefined) {
      const span = starts[next] - starts[prev];
      starts[i] = starts[prev] + (span * (i - prev)) / (next - prev);
    } else if (prev !== undefined) {
      starts[i] = starts[prev] + gap * (i - prev);
    } else if (next !== undefined) {
      starts[i] = Math.max(0, starts[next] - gap * (next - i));
    }
  }
  return starts;
}

/**
 * Align Raj's cards to the song's own clock.
 *
 * Cards are aligned at LINE level — the recogniser emits short fragments, so a
 * four-line stanza matched as one blob would anchor poorly — and then regrouped,
 * each card taking its first line's start.
 */
export function alignLyrics(
  cards: LyricCard[],
  asrCues: AsrCue[],
  options: AlignOptions = {}
): AlignmentResult {
  const { matchFloor, minCueMs, maxCueMs } = { ...DEFAULTS, ...options };
  const warnings: string[] = [];

  const usable = asrCues
    .filter((c) => !isMusicMarker(c.text))
    .sort((a, b) => a.startMs - b.startMs);
  if (!usable.length) {
    return { cues: [], anchoredLines: 0, interpolatedLines: 0, warnings: ['no usable ASR cues — nothing to align against'] };
  }

  const lines = cards.flat();
  if (!lines.length) {
    return { cues: [], anchoredLines: 0, interpolatedLines: 0, warnings: ['no lyric lines supplied'] };
  }

  const anchors = globalMatch(lines, usable, matchFloor);
  const starts = fillStarts(lines.length, anchors, usable);

  // Regroup lines into the cards Raj wrote, each starting at its first line.
  const cues: AlignedCue[] = [];
  let cursor = 0;
  for (const card of cards) {
    const first = cursor;
    cursor += card.length;
    const cardAnchored = card.some((_, k) => anchors.has(first + k));
    cues.push({
      startMs: Math.max(0, Math.round(starts[first] || 0)),
      endMs: 0, // filled below, once every start is known
      text: card.join('\n'),
      anchored: cardAnchored,
    });
  }

  // Starts must strictly increase — an out-of-order cue is rejected by YouTube
  // and, worse, silently reorders the lyric.
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].startMs <= cues[i - 1].startMs) cues[i].startMs = cues[i - 1].startMs + minCueMs;
  }
  // A card runs until the next one, bounded so it neither flickers nor lingers.
  const lastCue = usable[usable.length - 1];
  for (let i = 0; i < cues.length; i++) {
    const nextStart = i + 1 < cues.length ? cues[i + 1].startMs : lastCue.endMs;
    const span = nextStart - cues[i].startMs;
    cues[i].endMs = cues[i].startMs + Math.min(maxCueMs, Math.max(minCueMs, span));
  }

  const anchoredLines = anchors.size;
  const interpolatedLines = lines.length - anchoredLines;
  if (anchoredLines === 0) warnings.push('no line matched any cue — the ASR track may be for a different recording');
  if (interpolatedLines > lines.length / 2) {
    warnings.push(`${interpolatedLines} of ${lines.length} lines interpolated — timings are approximate`);
  }
  if (cues[0].startMs < 500) {
    warnings.push('first card starts at ~0:00 — check it lands on the vocal entry, not the intro');
  }
  return { cues, anchoredLines, interpolatedLines, warnings };
}

/**
 * The guard that makes this safe to automate: every published character must be
 * Raj's. If regrouping ever dropped or reordered a line this returns false and
 * the caller must refuse to publish.
 */
export function verifyRoundTrip(cues: AlignedCue[], cards: LyricCard[]): boolean {
  const out = cues.map((c) => c.text).join('\n');
  const src = cards.map((c) => c.join('\n')).join('\n');
  return out === src;
}

function srtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = String(Math.floor(t / 3_600_000)).padStart(2, '0');
  const m = String(Math.floor((t % 3_600_000) / 60_000)).padStart(2, '0');
  const s = String(Math.floor((t % 60_000) / 1000)).padStart(2, '0');
  const msec = String(t % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${msec}`;
}

/** SRT for `captions.insert` — uploaded with sync=false, since the times are real. */
export function toSrt(cues: AlignedCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${c.text}\n`)
    .join('\n');
}
