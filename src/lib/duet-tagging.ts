/**
 * Duet structuring for SUNO. SUNO doesn't honor a global "male + female duet"
 * instruction — it assigns a voice PER SECTION and only reliably follows
 * voice tags placed at the start of each section (e.g. `[Female Verse]`). This
 * lib turns a poet's plain lyrics into SUNO-ready, per-section-tagged lyrics so
 * the male/female split is unambiguous, and warns when an assignment isn't
 * actually a duet — before any SUNO credits are spent.
 *
 * Pure + deterministic; the UI (DuetTagger) and any pre-flight own the I/O.
 */

export type Voice = 'male' | 'female' | 'duet';
export type SectionKind = 'verse' | 'chorus';

export interface LyricSection {
  /** The section's text (its lines, joined). */
  text: string;
  /** Repeated blocks (≈ பல்லவி/pallavi) are treated as the chorus. */
  kind: SectionKind;
}
export interface TaggedSection extends LyricSection {
  voice: Voice;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Split plain lyrics into blank-line-separated sections, marking any block that
 * repeats (the refrain) as `chorus` and the rest as `verse`.
 */
export function splitSections(lyrics: string): LyricSection[] {
  const blocks = (lyrics ?? '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const counts = new Map<string, number>();
  for (const b of blocks) counts.set(norm(b), (counts.get(norm(b)) ?? 0) + 1);

  return blocks.map((text) => ({
    text,
    kind: (counts.get(norm(text)) ?? 0) >= 2 ? 'chorus' : 'verse',
  }));
}

/**
 * Voice detail, in the form Raj actually pastes into SUNO. Taken from a real
 * working lyric of his, not invented: sung sections name the voice as a role
 * ("Male Lead"), and a shared chorus is spelled out in full.
 */
const VOICE_LABEL: Record<Voice, string> = {
  male: 'Male Lead',
  female: 'Female Lead',
  duet: 'Male and Female Together',
};
const KIND_LABEL: Record<SectionKind, string> = { verse: 'Verse', chorus: 'Chorus' };

/**
 * Section tag, e.g. `[Verse - Female Lead]` / `[Chorus - Male and Female Together]`.
 *
 * ⚠️ KIND FIRST, then the detail after a dash. This used to emit
 * `[Female Verse]`, which is NOT the grammar Raj's own working lyrics use —
 * and the two lived on the same page as the SUNO setup generator, which emits
 * `[Kind - Detail]`. Two grammars on one screen meant a writer could paste
 * either, and `hasVoiceTags` (below) recognised only one of them.
 */
export function duetTag(voice: Voice, kind: SectionKind): string {
  return `[${KIND_LABEL[kind]} - ${VOICE_LABEL[voice]}]`;
}

/**
 * A sensible starting assignment: verses alternate male → female, and the
 * repeated chorus is sung by both. The operator can override any of it.
 */
export function defaultAssignment(sections: LyricSection[]): TaggedSection[] {
  let next: Voice = 'male';
  return sections.map((s) => {
    if (s.kind === 'chorus') return { ...s, voice: 'duet' };
    const voice = next;
    next = next === 'male' ? 'female' : 'male';
    return { ...s, voice };
  });
}

/** Build SUNO-ready lyrics: each section prefixed with its voice tag. */
export function toDuetLyrics(sections: TaggedSection[]): string {
  return sections.map((s) => `${duetTag(s.voice, s.kind)}\n${s.text}`).join('\n\n');
}

/**
 * Does the text already carry section-level voice tags? (pre-flight signal.)
 *
 * ⚠️ MUST match a voice ANYWHERE inside the bracket, not just at the start.
 * The old anchored form missed every tag in Raj's real format — `[Chorus - Male
 * Lead]`, `[Verse - Female Lead]`, `[Chorus - Male and Female Together]` all
 * read as "untagged", so the duet pre-flight warned about a lyric that was
 * fully tagged. Both grammars are accepted: legacy `[Female Verse]` still
 * matches, because older drafts and saved briefs carry it.
 */
export function hasVoiceTags(text: string): boolean {
  return /\[[^\]]*\b(male|female|duet|both)\b[^\]]*\]/i.test(text ?? '');
}

/**
 * Warn when a "duet" assignment won't actually sound like a male+female duet —
 * the failure mode that wastes SUNO credits. Returns an empty array when the
 * assignment is a valid duet.
 */
export function duetWarnings(sections: TaggedSection[]): string[] {
  if (sections.length === 0) return ['No lyric sections found — paste lyrics first.'];
  const voices = new Set(sections.map((s) => s.voice));
  const w: string[] = [];
  if (voices.size === 1 && !voices.has('duet')) {
    w.push('Every section is the same single voice — that is a solo, not a duet.');
    return w;
  }
  if (!voices.has('male') && !voices.has('duet')) w.push('No male part — assign a section to Male (or Both).');
  if (!voices.has('female') && !voices.has('duet')) w.push('No female part — assign a section to Female (or Both).');
  return w;
}
