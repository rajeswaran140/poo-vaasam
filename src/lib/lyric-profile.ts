/**
 * Tamil lyric PROFILE — what is measurably true about a draft, computed before
 * anything judges it.
 *
 * WHY THIS EXISTS. The Lyric Critic was asking an LLM to assess "meter/rhythm"
 * and "vocabulary (repetition, register)" from raw text, while this repo already
 * computed those exactly: `analyzeProsody` returns syllable counts, எதுகை /
 * மோனை / இயைபு families and gamaka scores, with tests. The critic imported none
 * of it. That is the real source of generic feedback — the model was guessing at
 * facts instead of interpreting them.
 *
 * THE SPLIT THIS ENFORCES:
 *   • FACTS — syllable counts, rhyme families, repeated words, root motifs,
 *     section shape, register signal. Computed here. Never asked of the model,
 *     never given a confidence score: meter is arithmetic, not an opinion.
 *   • JUDGEMENTS — intent, imagery freshness, narrative progression, polysemy.
 *     Left to the model, which receives this profile as grounding so it
 *     critiques the song against ITS OWN measured shape rather than a genre
 *     prior.
 *
 * Pure: no I/O, no model, no clock. Every field is reproducible from the text.
 */

import { analyzeProsody, toGraphemes, type ProsodyReport } from '@/lib/tamil-prosody';

/** U+0BCD விராமம் / pulli — dropped when comparing word roots. */
const PULLI = '்';

/** A root shared by two or more distinct surface words. */
export interface RootMotif {
  /** The shared opening graphemes, pulli-normalised. */
  root: string;
  /** The distinct surface forms that share it, in first-seen order. */
  forms: string[];
}

export interface LyricSection {
  index: number;
  /** The பல்லவி / சரணம் … heading when the block carries one. */
  heading: string | null;
  /** First lyric line — enough for a human (or model) to identify the section. */
  firstLine: string;
  lineCount: number;
}

/** Register is a SIGNAL with evidence, never a verdict — hence the counts. */
export type LyricRegister = 'literary' | 'colloquial' | 'mixed' | 'unknown';

export interface RegisterSignal {
  register: LyricRegister;
  /** Words carrying spoken-Tamil markers (உன்னோட, வரப்பில, தேடுறது, …). */
  colloquialHits: string[];
  /** Total words weighed. */
  wordCount: number;
}

export interface TamilLyricProfile {
  /** The full deterministic meter + rhyme report. */
  prosody: ProsodyReport;
  sections: LyricSection[];
  /** Words used 2+ times, most frequent first. */
  repeatedWords: Array<{ word: string; count: number }>;
  rootMotifs: RootMotif[];
  registerSignal: RegisterSignal;
}

/**
 * Spoken-Tamil suffix markers. Deliberately a SMALL, high-precision set — a
 * broad list would flag literary words and turn the signal into noise. These
 * are the forms Raj actually uses when writing rural/colloquial deliberately.
 */
const COLLOQUIAL_SUFFIXES = ['ோட', 'ுங்க', 'ுன்னு', 'ிட்டு', 'ாம்ல', 'ுது'];
/**
 * The spoken present-tense marker, which sits MEDIALLY rather than at the end:
 * தேட**ுற**து, பாக்க**ுற**ேன். A suffix-only check misses every one of them —
 * the first version of this did, and a test caught it.
 *
 * ⚠️ DELIBERATELY NARROW, and it UNDER-REPORTS. `போறது` carries ோ+ற rather
 * than ு+ற and is not matched. Broadening to `ோற` would also flag `தோற்று`,
 * and `ிற` would flag `நிறைந்த` — both literary. Precision beats recall here:
 * a FALSE colloquial reading makes the critic judge the song against the wrong
 * register, which is the exact failure this signal exists to prevent. The model
 * still reads the lyric itself and can disagree.
 */
const COLLOQUIAL_MEDIAL = ['ுற'];
/** A bare `ல` ending reads colloquial (வரப்பில) but only on a longer word. */
const SHORT_LOCATIVE = 'ல';

const isTamil = (w: string) => /[஀-௿]/.test(w);

/** Words of a line, punctuation and ellipses stripped. Pure. */
export function lyricWords(text: string): string[] {
  return (text ?? '')
    .replace(/[.,!?;:"'()\[\]…—–-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && isTamil(w));
}

/** Drop pulli so `சாய்` and `சாய` compare equal when matching roots. */
export function normaliseRoot(word: string): string {
  return (word ?? '').split(PULLI).join('');
}

/**
 * Root motifs — repeated word-ROOTS, not repeated words.
 *
 * `சாயங்கால / சாய்ந்த / சாய்ந்து` is a deliberate root motif, and a plain
 * repeated-word count misses it entirely because the three surface forms all
 * differ. Matching on the first two pulli-normalised graphemes catches the
 * family without collapsing unrelated words that merely share one letter.
 *
 * Reported as a candidate, never as a verdict — a shared root can be
 * coincidence, and it is the poet who knows whether it was meant.
 */
export const ROOT_PREFIX_GRAPHEMES = 2;
export const MIN_WORD_GRAPHEMES = 3;

export function rootMotifs(lyrics: string): RootMotif[] {
  const byRoot = new Map<string, string[]>();
  for (const raw of lyricWords(lyrics)) {
    const g = toGraphemes(normaliseRoot(raw));
    if (g.length < MIN_WORD_GRAPHEMES) continue;
    const root = g.slice(0, ROOT_PREFIX_GRAPHEMES).join('');
    const forms = byRoot.get(root) ?? [];
    // Distinct SURFACE forms only — three uses of one word is repetition, which
    // repeatedWords already reports. A motif needs the root to be re-inflected.
    if (!forms.includes(raw)) forms.push(raw);
    byRoot.set(root, forms);
  }
  return [...byRoot.entries()]
    .filter(([, forms]) => forms.length >= 2)
    .map(([root, forms]) => ({ root, forms }))
    .sort((a, b) => b.forms.length - a.forms.length || a.root.localeCompare(b.root));
}

/** Words used more than once, most frequent first. */
export function repeatedWords(lyrics: string): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>();
  for (const w of lyricWords(lyrics)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

/**
 * Register signal.
 *
 * WHY A SIGNAL AND NOT A VERDICT. A line carrying `உன்னோட` or `வரப்பில` is only
 * "inconsistent" if the song is otherwise literary — so the critic must infer
 * the song's own register FIRST and judge deviation from that, rather than
 * treating every colloquial form as a defect. Returning the hit words (not just
 * a label) lets the model see the evidence and disagree with it.
 */
export const COLLOQUIAL_LITERARY_CUT = 0.05;
export const COLLOQUIAL_MIXED_CUT = 0.2;

export function registerSignal(lyrics: string): RegisterSignal {
  const words = lyricWords(lyrics);
  const hits: string[] = [];
  for (const w of words) {
    const n = normaliseRoot(w);
    const colloquial =
      COLLOQUIAL_SUFFIXES.some((s) => n.endsWith(s)) ||
      COLLOQUIAL_MEDIAL.some((s) => n.includes(s)) ||
      (n.endsWith(SHORT_LOCATIVE) && toGraphemes(n).length >= 4);
    if (colloquial && !hits.includes(w)) hits.push(w);
  }
  if (words.length === 0) {
    return { register: 'unknown', colloquialHits: [], wordCount: 0 };
  }
  const ratio = hits.length / words.length;
  const register: LyricRegister =
    ratio < COLLOQUIAL_LITERARY_CUT ? 'literary' : ratio < COLLOQUIAL_MIXED_CUT ? 'mixed' : 'colloquial';
  return { register, colloquialHits: hits, wordCount: words.length };
}

/** Blank-line separated blocks, with any பல்லவி/சரணம் heading attached. */
export function lyricSections(lyrics: string): LyricSection[] {
  const report = analyzeProsody(lyrics);
  const out: LyricSection[] = [];
  let heading: string | null = null;
  let firstLine = '';
  let lineCount = 0;

  const flush = () => {
    if (lineCount > 0 || heading) {
      out.push({ index: out.length, heading, firstLine, lineCount });
    }
    heading = null;
    firstLine = '';
    lineCount = 0;
  };

  for (const l of report.lines) {
    if (l.letters === 0) {
      flush();
      continue;
    }
    if (l.isHeading) {
      // A heading starts a new block even without a blank line before it.
      if (lineCount > 0) flush();
      heading = l.text.trim();
      continue;
    }
    if (lineCount === 0) firstLine = l.text.trim();
    lineCount += 1;
  }
  flush();
  return out;
}

/** Everything measurable about a draft, in one pass. */
export function buildLyricProfile(lyrics: string): TamilLyricProfile {
  return {
    prosody: analyzeProsody(lyrics),
    sections: lyricSections(lyrics),
    repeatedWords: repeatedWords(lyrics),
    rootMotifs: rootMotifs(lyrics),
    registerSignal: registerSignal(lyrics),
  };
}

/** Caps so the grounding block cannot crowd out the lyric itself. */
export const MAX_GROUNDING_MOTIFS = 6;
export const MAX_GROUNDING_REPEATS = 8;
export const MAX_GROUNDING_OUTLIERS = 8;
export const MAX_GROUNDING_HITS = 10;

/**
 * Render the profile as compact grounding lines for the model.
 *
 * Written as MEASUREMENTS, not instructions — the model is told elsewhere what
 * to do with them. Kept small on purpose: this rides in front of the lyric on
 * every call, and a long block would push the poet's own words down the prompt.
 */
export function profileGrounding(profile: TamilLyricProfile): string[] {
  const p = profile.prosody;
  const out: string[] = ['MEASURED FACTS about this draft (computed, not inferred — do not re-derive or dispute these):'];

  out.push(`- Lines: ${p.lyricLineCount} lyric lines across ${profile.sections.length} section(s).`);

  if (p.dominantSyllables) {
    out.push(
      `- Meter: the song settles at ${p.dominantSyllables.count} syllables/line (${p.dominantSyllables.lines} lines).`
    );
    if (p.syllableOutliers.length) {
      const shown = p.syllableOutliers.slice(0, MAX_GROUNDING_OUTLIERS);
      const byIndex = new Map(p.lines.map((l) => [l.index, l]));
      out.push(
        `- Lines off that count: ${shown
          .map((i) => `"${byIndex.get(i)?.text.trim() ?? ''}" (${byIndex.get(i)?.syllables})`)
          .join(' · ')}${p.syllableOutliers.length > shown.length ? ' …' : ''}`
      );
    } else {
      out.push('- Every lyric line hits that count.');
    }
  }

  const rhyme = (label: string, groups: ProsodyReport['monai']) =>
    groups.length
      ? `- ${label}: ${groups
          .slice(0, 3)
          .map((g) => `"${g.key}" ×${g.lineIndexes.length}`)
          .join(', ')}`
      : null;
  for (const line of [
    rhyme('மோனை (line-opening)', p.monai),
    rhyme('எதுகை (second letter)', p.etukai),
    rhyme('இயைபு (line ending)', p.iyaipu),
  ]) {
    if (line) out.push(line);
  }

  out.push(
    `- Gamaka: mean ${p.gamaka.averageScore}/100; ${p.gamaka.openEndings} line endings sustain, ${p.gamaka.closedEndings} clip.`
  );

  if (profile.rootMotifs.length) {
    out.push(
      `- Root motifs (same root re-inflected): ${profile.rootMotifs
        .slice(0, MAX_GROUNDING_MOTIFS)
        .map((m) => m.forms.join(' / '))
        .join(' · ')}`
    );
  }
  if (profile.repeatedWords.length) {
    out.push(
      `- Repeated words: ${profile.repeatedWords
        .slice(0, MAX_GROUNDING_REPEATS)
        .map((r) => `${r.word} ×${r.count}`)
        .join(', ')}`
    );
  }

  const rs = profile.registerSignal;
  out.push(
    rs.colloquialHits.length
      ? `- Register signal: ${rs.register} — spoken-Tamil forms present: ${rs.colloquialHits
          .slice(0, MAX_GROUNDING_HITS)
          .join(', ')}. Judge consistency against THIS register, not against literary Tamil.`
      : `- Register signal: ${rs.register} — no spoken-Tamil markers found.`
  );

  return out;
}
