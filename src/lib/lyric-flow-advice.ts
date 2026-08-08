/**
 * Flow suggestions — turn the prosody MEASUREMENTS into things worth saying.
 *
 * `tamil-prosody` already computes everything needed: syllable counts, the
 * dominant line length, மோனை/எதுகை/இயைபு groupings, and gamaka (whether a line
 * ends somewhere the voice can hold). The panel renders "⚠ off-meter" and a
 * number, and stops there — which tells an experienced poet something he can
 * already hear, and never tells him the one thing he cannot: WHY a line will
 * fight the vocal.
 *
 * That gap matters specifically for Raj's workflow. He writes the lyric easily;
 * the hard part is revising it against what SUNO's vocalist does to it. A line
 * ending on a bare மெய் is exactly where a held note gets clipped — that is
 * predictable from the text alone, before a single credit is spent.
 *
 * RULES OF THIS MODULE:
 *  - PURE. No LLM, no I/O. Same posture as the prosody panel it sits beside.
 *  - SUGGESTS, NEVER REWRITES. It names what it observes and why it matters.
 *    It must never emit a replacement line or a replacement word — that is the
 *    standing constraint on every lyric surface here, and the reason the poet
 *    trusts the tool at all.
 *  - SILENT WHEN THERE IS NOTHING TO SAY. A panel that always finds three
 *    problems teaches you to stop reading it.
 */

import type { ProsodyReport, LineProsody } from '@/lib/tamil-prosody';

export type FlowSeverity = 'note' | 'watch';

export interface FlowSuggestion {
  /** 0-based line index, or null for a whole-draft observation. */
  line: number | null;
  /** The line's text, quoted verbatim so the poet can find it. */
  quote?: string;
  severity: FlowSeverity;
  /** What was observed. */
  observation: string;
  /** Why it matters for how the line will sing. */
  why: string;
}

/**
 * Off-meter tolerance. A one-syllable difference is ordinary variation in
 * Tamil song lines and flagging it would fire on nearly every draft; two is
 * where a line audibly stops sitting on the same தாளம்.
 */
export const SYLLABLE_TOLERANCE = 1;

/**
 * Below this gamaka score a line ending is hard to sustain. Calibrated against
 * the scale in analyzeGamaka (0-100, weighted toward an open long-vowel
 * ending), not chosen from theory — the aim is to flag the endings a vocalist
 * will clip, not every line that lacks a நெடில்.
 */
export const WEAK_ENDING_SCORE = 35;

/** How many line-level suggestions to emit before it becomes noise. */
export const MAX_LINE_SUGGESTIONS = 6;

function quoteOf(l: LineProsody): string {
  const t = l.text.trim();
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

/**
 * Suggestions derived purely from the prosody report.
 *
 * Ordered most-actionable first: meter breaks the singability of a specific
 * line, weak endings shape what the vocalist can hold, and the whole-draft
 * notes are context rather than tasks.
 */
export function flowSuggestions(report: ProsodyReport): FlowSuggestion[] {
  const out: FlowSuggestion[] = [];
  const lyricLines = report.lines.filter((l) => !l.isHeading && l.letters > 0);
  if (lyricLines.length === 0) return out;

  const byIndex = new Map(report.lines.map((l) => [l.index, l]));
  const dominant = report.dominantSyllables;

  // --- 1. Lines that sit off the song's own meter -------------------------
  // Compared against the draft's OWN dominant length, never a textbook count:
  // the song decides its தாளம், and a fixed target would flag a whole draft
  // written in a shorter line.
  if (dominant && lyricLines.length >= 3) {
    const off = report.syllableOutliers
      .map((i) => byIndex.get(i))
      .filter((l): l is LineProsody => !!l)
      .map((l) => ({ line: l, delta: l.syllables - dominant.count }))
      .filter((x) => Math.abs(x.delta) > SYLLABLE_TOLERANCE)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    for (const { line, delta } of off.slice(0, MAX_LINE_SUGGESTIONS)) {
      out.push({
        line: line.index,
        quote: quoteOf(line),
        severity: 'watch',
        observation: `${line.syllables} syllables against this song's ${dominant.count} — ${Math.abs(delta)} ${delta > 0 ? 'over' : 'under'}.`,
        why:
          delta > 0
            ? 'Longer lines get compressed to fit the beat, which is where words start running together.'
            : 'Shorter lines leave a gap the tune has to stretch across, often by holding a syllable that was not meant to be held.',
      });
    }
  }

  // --- 2. Endings the voice cannot hold -----------------------------------
  // The SUNO-specific one: a line ending on a bare மெய் gives the vocalist
  // nothing to sustain, so an ornament lands on a consonant and gets clipped.
  const weakEndings = lyricLines
    .filter((l) => !l.endsOpen && l.gamakaScore < WEAK_ENDING_SCORE)
    .sort((a, b) => a.gamakaScore - b.gamakaScore);

  for (const l of weakEndings.slice(0, MAX_LINE_SUGGESTIONS)) {
    out.push({
      line: l.index,
      quote: quoteOf(l),
      severity: 'watch',
      observation: 'Ends on a closed syllable (மெய்) — nothing open to hold.',
      why: 'A held note or gamaka lands on a consonant here, so the vocalist clips it short. Lines ending in a long vowel (ஆ, ஈ, ஊ, ஏ, ஓ) sustain.',
    });
  }

  // --- 3. Whole-draft context --------------------------------------------
  if (report.gamaka.closedEndings > 0 && report.gamaka.openEndings === 0 && lyricLines.length >= 3) {
    out.push({
      line: null,
      severity: 'watch',
      observation: `All ${report.gamaka.closedEndings} lines end closed.`,
      why: 'Nothing in the song offers a sustained note, so the vocal stays clipped throughout regardless of the melody.',
    });
  }

  // Rhyme binding is what makes it a பாடல் rather than a paragraph — worth
  // naming when it is absent, but only as a note, never as a fault: a deliberate
  // unrhymed lyric is a legitimate choice and this module does not know the intent.
  const hasBinding = report.etukai.length > 0 || report.monai.length > 0 || report.iyaipu.length > 0;
  if (!hasBinding && lyricLines.length >= 4) {
    out.push({
      line: null,
      severity: 'note',
      observation: 'No எதுகை, மோனை or இயைபு grouping found across these lines.',
      why: 'Sound-binding is what makes lines cohere as a song. If the looseness is deliberate, ignore this.',
    });
  }

  return out;
}

/** One-line summary for a collapsed panel. Empty string when there is nothing to say. */
export function flowHeadline(suggestions: FlowSuggestion[]): string {
  if (suggestions.length === 0) return '';
  const watch = suggestions.filter((s) => s.severity === 'watch').length;
  if (watch === 0) return `${suggestions.length} note${suggestions.length > 1 ? 's' : ''}`;
  return `${watch} line${watch > 1 ? 's' : ''} worth a look`;
}
