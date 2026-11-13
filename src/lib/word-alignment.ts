/**
 * Word-by-word lyric alignment: Raj's lyric words lined up, in order, against
 * the words the recogniser heard, so each line starts at its own first word.
 *
 * WHY NOT alignLyrics. That matcher (caption-alignment.ts) was built for
 * YouTube caption files: it groups the heard words into ~4 s chunks and pairs
 * whole lines with chunks. On பூவும் காற்றும் (2026-11-13) the recogniser heard
 * "கார்த்திகை" at exactly 1:35.5, where Charanam 1 starts, yet the line was
 * paired with a chunk before the music break at 1:15, and every later line in
 * the verse showed one line late. Matching word to word keeps that timing.
 *
 * The recognised text is still never shown: it only decides WHEN. Misheard
 * words (மழலே for மழையிலே) still line up by sound and position; a heard word
 * can stand for two lyric words (தினமுளா = தினம் உலா) or the other way round.
 * Pure and I/O-free.
 */
import { normaliseForMatch, similarity, type AlignedCue } from '@/lib/caption-alignment';
import type { AsrWord } from '@/lib/local-asr-clock';

export interface WordAlignedLine extends AlignedCue {
  /** End of the last heard word in the line, seconds (heard lines only). */
  lastWordEndSec: number | null;
}

/** A lyric word counts as heard at or above this similarity to its partner. */
const HEARD = 0.4;
/** Below this the pair is a substitution (misheard), scored as a small loss. */
const pairScore = (s: number) => 2 * s - 0.7;
const SKIP_LYRIC = -0.6; // a lyric word with no heard partner
const SKIP_HEARD = -0.4; // a heard word that is not in the lyrics (a breath, a hallucination)
const JOIN_COST = 0.1;

const tokensOf = (line: string) => normaliseForMatch(line).split(' ').filter(Boolean);

/**
 * Letters the recogniser swaps freely in sung Tamil, folded to one sound:
 * ன/ண/ந, ல/ள/ழ, ர/ற. Measured on பூவும் காற்றும்: வானம் heard as வாணம்,
 * கனவுகளே as கணவுகளே, மலரும் as மலறும் — the same word to a listener.
 */
const SOUND: Record<string, string> = { 'ண': 'ன', 'ந': 'ன', 'ள': 'ல', 'ழ': 'ல', 'ற': 'ர' };
const bySound = (w: string) => [...w].map((c) => SOUND[c] ?? c).join('');

function editRatio(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  if (!A.length || !B.length) return 0;
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[B.length] / Math.max(A.length, B.length);
}

/** How alike a lyric word and a heard word are, 0-1: by spelling, or by sound. */
export function wordSimilarity(a: string, b: string): number {
  return Math.max(similarity(a, b), editRatio(bySound(a), bySound(b)));
}

export function alignLinesToWords(lines: string[], heard: AsrWord[]): WordAlignedLine[] {
  // Songs repeat words (every chorus), so the same pair is compared many times
  // over the n×m table; each comparison costs regexes, bigram maps and an edit
  // distance. Cached per call: 2.7 s → well under a second on a 4-minute song.
  const memo = new Map<string, number>();
  const sim = (a: string, b: string) => {
    const k = `${a}\u0001${b}`;
    let v = memo.get(k);
    if (v === undefined) {
      v = wordSimilarity(a, b);
      memo.set(k, v);
    }
    return v;
  };
  const lyric: { text: string; line: number }[] = [];
  lines.forEach((l, i) => tokensOf(l).forEach((t) => lyric.push({ text: t, line: i })));
  const words = heard
    .map((w) => ({ ...w, text: normaliseForMatch(w.word) }))
    .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end));
  const n = lyric.length;
  const m = words.length;

  // Needleman-Wunsch with 1:1, 2:1 (two lyric words heard as one) and 1:2 moves.
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Int8Array(m + 1)); // 1 pair, 2 skipL, 3 skipH, 4 join2L, 5 join2H
  for (let i = 1; i <= n; i++) { score[i][0] = score[i - 1][0] + SKIP_LYRIC; move[i][0] = 2; }
  for (let j = 1; j <= m; j++) { score[0][j] = score[0][j - 1] + SKIP_HEARD; move[0][j] = 3; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = score[i - 1][j - 1] + pairScore(sim(lyric[i - 1].text, words[j - 1].text));
      let how = 1;
      const a = score[i - 1][j] + SKIP_LYRIC;
      if (a > best) { best = a; how = 2; }
      const b = score[i][j - 1] + SKIP_HEARD;
      if (b > best) { best = b; how = 3; }
      if (i >= 2) {
        const c = score[i - 2][j - 1] + pairScore(sim(lyric[i - 2].text + lyric[i - 1].text, words[j - 1].text)) - JOIN_COST;
        if (c > best) { best = c; how = 4; }
      }
      if (j >= 2) {
        const d = score[i - 1][j - 2] + pairScore(sim(lyric[i - 1].text, words[j - 2].text + words[j - 1].text)) - JOIN_COST;
        if (d > best) { best = d; how = 5; }
      }
      score[i][j] = best;
      move[i][j] = how;
    }
  }

  // Walk back: which heard word (if any) each lyric word landed on.
  const partner: Array<{ start: number; end: number } | null> = new Array(n).fill(null);
  // Where each lyric word sat in the heard stream, even if misheard: a line's
  // first word is often the one sung softest, but its slot still marks the start.
  const slot: Array<{ start: number; end: number } | null> = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const how = move[i][j];
    if (how === 1) {
      slot[i - 1] = words[j - 1];
      if (sim(lyric[i - 1].text, words[j - 1].text) >= HEARD) partner[i - 1] = words[j - 1];
      i--; j--;
    } else if (how === 4) {
      slot[i - 2] = words[j - 1];
      slot[i - 1] = words[j - 1];
      if (sim(lyric[i - 2].text + lyric[i - 1].text, words[j - 1].text) >= HEARD) {
        partner[i - 2] = words[j - 1];
        partner[i - 1] = words[j - 1];
      }
      i -= 2; j--;
    } else if (how === 5) {
      slot[i - 1] = { start: words[j - 2].start, end: words[j - 1].end };
      if (sim(lyric[i - 1].text, words[j - 2].text + words[j - 1].text) >= HEARD) {
        partner[i - 1] = { start: words[j - 2].start, end: words[j - 1].end };
      }
      i--; j -= 2;
    } else if (how === 2) {
      i--;
    } else {
      j--;
    }
  }

  // A line is heard when at least half its words were; it starts at its first heard word.
  const out: WordAlignedLine[] = lines.map((text, li) => {
    const own = lyric.map((t, k) => ({ t, p: partner[k], s: slot[k] })).filter((x) => x.t.line === li);
    const got = own.filter((x) => x.p);
    const heardLine = own.length > 0 && got.length >= Math.ceil(own.length / 2);
    // Start at the first word's slot when it is no later than the first heard word.
    const first = own[0]?.s && got.length && own[0].s.start <= got[0].p!.start ? own[0].s.start : got[0]?.p?.start ?? 0;
    return {
      text,
      anchored: heardLine,
      startMs: heardLine ? Math.round(first * 1000) : 0,
      endMs: 0,
      lastWordEndSec: heardLine ? got[got.length - 1].p!.end : null,
    };
  });

  // Keep heard starts in order (a stray early match must not jump the queue).
  let last = -Infinity;
  for (const l of out) {
    if (!l.anchored) continue;
    if (l.startMs <= last) { l.anchored = false; l.lastWordEndSec = null; continue; }
    last = l.startMs;
  }

  // Unheard lines get evenly spaced starts between their heard neighbours; the
  // singing-aware placement (vocal-activity.ts) refines them when it can.
  const total = heard.length ? Math.round(Math.max(...heard.map((w) => w.end)) * 1000) : 0;
  for (let k = 0; k < out.length; k++) {
    if (out[k].anchored) continue;
    let e = k;
    while (e < out.length && !out[e].anchored) e++;
    const from = k > 0 ? out[k - 1].startMs : 0;
    const to = e < out.length ? out[e].startMs : Math.max(total, from + 1000 * (e - k + 1));
    for (let q = k; q < e; q++) out[q].startMs = Math.round(from + ((to - from) * (q - k + (k > 0 ? 1 : 0))) / (e - k + (k > 0 ? 1 : 0)));
    k = e - 1;
  }
  for (let k = 0; k < out.length; k++) out[k].endMs = k + 1 < out.length ? out[k + 1].startMs : out[k].startMs + 4000;
  return out;
}
