/**
 * Tamil prosody — deterministic meter & rhyme analysis for the Lyric Critic, so
 * the poet can SEE a draft's rhythm and sound-patterns at a glance. Pure, no LLM
 * (augment-the-craft, see [[feedback_tamilagaval_ai_augments_craft]]).
 *
 * Units (Tamil is an abugida):
 *  - எழுத்து (letter): an independent vowel (உயிர்), a consonant cluster
 *    (உயிர்மெய் = consonant + inherent/மாற்று vowel, or மெய் = consonant + புள்ளி),
 *    or ஆய்தம் — each is ONE letter/grapheme.
 *  - syllable: a pronounced vowel — every உயிர் and every உயிர்மெய், but NOT a
 *    bare மெய் (consonant + புள்ளி, which is a coda).
 *
 * Sound patterns (classical யாப்பு, pragmatic form):
 *  - மோனை: lines whose first letter shares the same base sound (alliteration).
 *  - எதுகை: lines whose SECOND letter agrees (the Tamil "rhyme").
 *  - இயைபு: lines whose LAST letter agrees (end-rhyme).
 */

const VOWEL_START = 0x0b85; // அ
const VOWEL_END = 0x0b94; // ஔ
const AYTHAM = 0x0b83; // ஃ
const CONS_START = 0x0b95; // க
const CONS_END = 0x0bb9; // ஹ
const PULLI = 0x0bcd; // ் (virama)
const MATRA_START = 0x0bbe; // ா
const MATRA_END = 0x0bcc; // ௌ
const AU_LENGTH = 0x0bd7;

const cp = (ch: string) => ch.codePointAt(0) ?? 0;
const isVowel = (c: number) => c >= VOWEL_START && c <= VOWEL_END;
const isConsonant = (c: number) => c >= CONS_START && c <= CONS_END;
const isAytham = (c: number) => c === AYTHAM;
const isMatra = (c: number) => (c >= MATRA_START && c <= MATRA_END) || c === AU_LENGTH;
const isPulli = (c: number) => c === PULLI;
const isCombining = (c: number) => isMatra(c) || isPulli(c);

// Long vowels fold to their short family so மா/மு alliterate and ஆனை/அழகு share மோனை.
const VOWEL_FAMILY: Record<number, number> = {
  0x0b86: 0x0b85, // ஆ→அ
  0x0b88: 0x0b87, // ஈ→இ
  0x0b8a: 0x0b89, // ஊ→உ
  0x0b8f: 0x0b8e, // ஏ→எ
  0x0b93: 0x0b92, // ஓ→ஒ
};

// நெடில் (long) vowels — the ones a voice can sustain/ornament. Independent
// letters and their matra (vowel-sign) equivalents.
const LONG_VOWELS = new Set([0x0b86, 0x0b88, 0x0b8a, 0x0b8f, 0x0b90, 0x0b93, 0x0b94]); // ஆ ஈ ஊ ஏ ஐ ஓ ஔ
const LONG_MATRAS = new Set([0x0bbe, 0x0bc0, 0x0bc2, 0x0bc7, 0x0bc8, 0x0bcb, 0x0bcc]); // ா ீ ூ ே ை ோ ௌ

export type VowelLength = 'long' | 'short' | 'none';

/** Split text into எழுத்து units — combining marks (matra/புள்ளி) attach to their base. */
export function toGraphemes(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (isCombining(cp(ch)) && cur) {
      cur += ch;
      continue;
    }
    if (cur) out.push(cur);
    cur = ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Pronounced syllables = உயிர் + உயிர்மெய் (a bare மெய் carries no vowel). */
export function countSyllables(text: string): number {
  const cps = Array.from(text, cp);
  let n = 0;
  for (let i = 0; i < cps.length; i++) {
    if (isVowel(cps[i])) n++;
    else if (isConsonant(cps[i]) && cps[i + 1] !== PULLI) n++;
  }
  return n;
}

/** எழுத்து count = independent vowels + consonant clusters + ஆய்தம். */
export function countLetters(text: string): number {
  let n = 0;
  for (const ch of text) {
    const c = cp(ch);
    if (isVowel(c) || isConsonant(c) || isAytham(c)) n++;
  }
  return n;
}

/**
 * Classify one எழுத்து (from toGraphemes) as a syllable nucleus or a coda மெய்,
 * with the nucleus vowel's length. Pure மெய் (base + புள்ளி) is a coda; a
 * consonant with a matra or the inherent 'அ' is a nucleus.
 */
function graphemeUnit(g: string): { role: 'nucleus' | 'coda' | 'skip'; vowel: VowelLength } {
  const cps = Array.from(g, cp);
  const first = cps[0];
  if (isVowel(first)) return { role: 'nucleus', vowel: LONG_VOWELS.has(first) ? 'long' : 'short' };
  if (isConsonant(first)) {
    const matra = cps.find(isMatra);
    if (matra != null) return { role: 'nucleus', vowel: LONG_MATRAS.has(matra) ? 'long' : 'short' };
    if (cps.some(isPulli)) return { role: 'coda', vowel: 'none' }; // bare மெய்
    return { role: 'nucleus', vowel: 'short' }; // inherent அ
  }
  return { role: 'skip', vowel: 'none' };
}

export interface GamakaProsody {
  /** Final syllable is OPEN (ends in a vowel) — sustainable, no clipping மெய். */
  endsOpen: boolean;
  finalVowel: VowelLength;
  openRatio: number; // share of open syllables
  longVowelRatio: number; // share of syllables carrying a நெடில்
  gamakaScore: number; // 0-100, weighted toward an open long-vowel line ending
}

// The glide/ornament lives at the line ending, so an open long final vowel
// dominates; overall open/long ratios are supporting texture. Weights tunable.
const W_FINAL_OPEN = 40;
const W_FINAL_LONG = 25;
const W_OPEN_RATIO = 20;
const W_LONG_RATIO = 15;

/**
 * How gamaka-friendly a line is: can the voice sustain/ornament its notes,
 * especially the ending? Deterministic — the singer adds the ornament, but the
 * WORD decides whether a note can carry one (open நெடில் vs clipped மெய்).
 */
export function analyzeGamaka(text: string): GamakaProsody {
  const units: Array<{ vowel: VowelLength; open: boolean }> = [];
  for (const g of toGraphemes(text)) {
    const u = graphemeUnit(g);
    if (u.role === 'nucleus') units.push({ vowel: u.vowel, open: true });
    else if (u.role === 'coda' && units.length) units[units.length - 1].open = false;
  }
  const n = units.length;
  if (n === 0) return { endsOpen: false, finalVowel: 'none', openRatio: 0, longVowelRatio: 0, gamakaScore: 0 };
  const last = units[n - 1];
  const openRatio = units.filter((u) => u.open).length / n;
  const longVowelRatio = units.filter((u) => u.vowel === 'long').length / n;
  const gamakaScore = Math.round(
    (last.open ? W_FINAL_OPEN : 0) +
      (last.vowel === 'long' ? W_FINAL_LONG : 0) +
      openRatio * W_OPEN_RATIO +
      longVowelRatio * W_LONG_RATIO
  );
  return { endsOpen: last.open, finalVowel: last.vowel, openRatio, longVowelRatio, gamakaScore };
}

/** Base sound of a grapheme for மோனை (consonant, or short-vowel family). null if non-Tamil. */
function baseSound(grapheme: string | undefined): string | null {
  if (!grapheme) return null;
  const c = cp(grapheme);
  if (isConsonant(c)) return String.fromCodePoint(c);
  if (isVowel(c)) return String.fromCodePoint(VOWEL_FAMILY[c] ?? c);
  return null;
}

export interface LineProsody {
  index: number;
  text: string;
  isHeading: boolean;
  syllables: number;
  letters: number;
  /** Base sound of the first letter (மோனை key), or null. */
  monai: string | null;
  /** The second எழுத்து (எதுகை key), or null. */
  etukai: string | null;
  /** The last எழுத்து (இயைபு / end-rhyme key), or null. */
  iyaipu: string | null;
  /** Gamaka-friendliness (0-100) — 0 for headings/blank lines. */
  gamakaScore: number;
  /** Final syllable open (sustainable ending). */
  endsOpen: boolean;
}

// பல்லவி / அனுபல்லவி / சரணம் … markers are structure, not lyric lines.
const HEADINGS = ['பல்லவி', 'அனுபல்லவி', 'சரணம்', 'முடிப்பு', 'சரணம்1', 'சரணம்2'];
const stripPunct = (s: string) => s.replace(/[\s:：.\-–—()0-9]/g, '');

export function analyzeLine(text: string, index: number): LineProsody {
  const isHeading = HEADINGS.includes(stripPunct(text));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const firstG = words.length ? toGraphemes(words[0]) : [];
  const lastG = words.length ? toGraphemes(words[words.length - 1]) : [];
  const gamaka = isHeading ? null : analyzeGamaka(text);
  return {
    index,
    text,
    isHeading,
    syllables: countSyllables(text),
    letters: countLetters(text),
    monai: isHeading ? null : baseSound(firstG[0]),
    etukai: isHeading ? null : (firstG[1] ?? null),
    iyaipu: isHeading ? null : (lastG[lastG.length - 1] ?? null),
    gamakaScore: gamaka ? gamaka.gamakaScore : 0,
    endsOpen: gamaka ? gamaka.endsOpen : false,
  };
}

export interface RhymeGroup {
  key: string;
  lineIndexes: number[];
}

export interface ProsodyReport {
  lines: LineProsody[];
  /** Lyric lines only (headings/blanks excluded). */
  lyricLineCount: number;
  /** Most common syllable count among lyric lines, with how many lines hit it. */
  dominantSyllables: { count: number; lines: number } | null;
  /** Lyric line indexes whose syllable count differs from the dominant (rhythm outliers). */
  syllableOutliers: number[];
  monai: RhymeGroup[];
  etukai: RhymeGroup[];
  iyaipu: RhymeGroup[];
  /** Gamaka summary over lyric lines: mean score + how many endings sustain. */
  gamaka: { averageScore: number; openEndings: number; closedEndings: number };
}

function groupBy(lines: LineProsody[], pick: (l: LineProsody) => string | null): RhymeGroup[] {
  const m = new Map<string, number[]>();
  for (const l of lines) {
    const k = pick(l);
    if (k == null) continue;
    (m.get(k) ?? m.set(k, []).get(k)!).push(l.index);
  }
  // Only groups of 2+ lines are an actual shared pattern; biggest first.
  return [...m.entries()]
    .filter(([, idx]) => idx.length >= 2)
    .map(([key, lineIndexes]) => ({ key, lineIndexes }))
    .sort((a, b) => b.lineIndexes.length - a.lineIndexes.length);
}

/** Full meter + rhyme analysis of a multi-line lyric. Pure. */
export function analyzeProsody(lyrics: string): ProsodyReport {
  const lines = (lyrics ?? '').split('\n').map((t, i) => analyzeLine(t, i));
  const lyricLines = lines.filter((l) => !l.isHeading && l.letters > 0);

  // Dominant syllable count (the line length the song mostly settles into).
  const counts = new Map<number, number>();
  for (const l of lyricLines) counts.set(l.syllables, (counts.get(l.syllables) ?? 0) + 1);
  let dominantSyllables: { count: number; lines: number } | null = null;
  for (const [count, n] of counts) {
    if (!dominantSyllables || n > dominantSyllables.lines || (n === dominantSyllables.lines && count > dominantSyllables.count)) {
      dominantSyllables = { count, lines: n };
    }
  }
  const syllableOutliers = dominantSyllables
    ? lyricLines.filter((l) => l.syllables !== dominantSyllables!.count).map((l) => l.index)
    : [];

  const openEndings = lyricLines.filter((l) => l.endsOpen).length;
  const averageScore = lyricLines.length
    ? Math.round(lyricLines.reduce((s, l) => s + l.gamakaScore, 0) / lyricLines.length)
    : 0;

  return {
    lines,
    lyricLineCount: lyricLines.length,
    dominantSyllables,
    syllableOutliers,
    monai: groupBy(lyricLines, (l) => l.monai),
    etukai: groupBy(lyricLines, (l) => l.etukai),
    iyaipu: groupBy(lyricLines, (l) => l.iyaipu),
    gamaka: { averageScore, openEndings, closedEndings: lyricLines.length - openEndings },
  };
}
