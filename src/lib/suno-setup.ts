/**
 * SUNO setup — the four fields a generation actually needs, validated.
 *
 * WHAT THIS REPLACES. The composer emits a prose paragraph describing the song.
 * That fills ONE of four inputs. The real setup is:
 *   1. LYRICS box   — the lyric broken at musical points with [Kind - Detail]
 *                     section tags, including the instrumental breaks
 *   2. STYLE box    — comma-separated descriptors, hard cap 1000 chars
 *   3. WEIRDNESS + STYLE INFLUENCE — two sliders
 *   4. EXCLUDE      — a short negative list, a dedicated field (NOT the style box)
 * Producing these by hand in a general chat assistant is the step this removes.
 *
 * NOTHING HERE IS SONG-SPECIFIC. The section-tag grammar and the style-group
 * ordering are SUNO's format; the content is always generated per song. No
 * instrument, mood, genre or exclusion is hardcoded — a house list baked in
 * here would quietly contradict the next song (a "no melancholy" default is
 * wrong for a grief song; "no folk" is wrong for a folk song).
 *
 * PURE. No I/O, no LLM. The model proposes; this decides whether the proposal
 * is safe to paste, and says why when it is not.
 */

import { PROMPT_LIMITS } from '@/lib/prompt-preflight';

/**
 * Style-box budget. The hard cap is PROMPT_LIMITS.STYLE_MAX (1000). The lower
 * bound exists because the common failure is UNDER-using the box: a 150-char
 * style leaves the model to invent the arrangement. Measured guidance puts the
 * useful band at roughly 400-800.
 */
export const STYLE_TARGET_MIN = 400;
export const STYLE_TARGET_MAX = 800;

/**
 * Negatives are attention-priced like positives — a long exclude list dilutes
 * every item in it. The documented ceiling is small, and each exclusion works
 * best paired with a positive replacement in the style prompt.
 */
export const EXCLUDE_MAX = 3;

/** Slider ranges. 50 is the generator's own "normal" for weirdness. */
export const WEIRDNESS_DEFAULT = 50;
export const SLIDER_MIN = 0;
export const SLIDER_MAX = 100;

/**
 * Style influence defaults HIGH here, deliberately. It controls how strictly
 * the style prompt is followed, and these prompts are dense and specific —
 * naming vocal roles, an instrument set and an era. A loose setting discards
 * exactly the detail that took the effort to specify.
 */
export const STYLE_INFLUENCE_DEFAULT = 80;

export interface SunoSetup {
  /** The lyric with [Kind - Detail] tags, ready for the lyrics box. */
  lyricsBlock: string;
  /** Comma-separated descriptors, ready for the style box. */
  style: string;
  weirdness: number;
  styleInfluence: number;
  /** Short negative list for the dedicated Exclude field. */
  exclude: string[];
}

export interface SectionTag {
  raw: string;
  /** Intro / Chorus / Verse / Bridge / Break / Interlude / Outro … */
  kind: string;
  /** Everything after the dash: "Male Lead", "Flute Phrase", "Instrumental". */
  detail: string;
  /** No sung lines follow it — a purely instrumental marker. */
  instrumental: boolean;
  line: number;
}

const TAG_LINE = /^\s*\[([^\]]+)\]\s*$/;
/** Details that describe playing rather than singing. */
const VOCAL_HINT = /\b(lead|vocal|voice|together|duet|solo vocal|chorus vocals?|male|female|child|choir)\b/i;

/**
 * Parse the lyrics block into its section tags.
 *
 * A tag is instrumental when its detail names no voice — that is how the
 * arrangement is expressed, and it is nearly half the tags in a real song, so
 * it cannot be treated as decoration.
 */
export function parseSectionTags(lyricsBlock: string): SectionTag[] {
  const out: SectionTag[] = [];
  const lines = (lyricsBlock ?? '').split('\n');
  lines.forEach((l, i) => {
    const m = TAG_LINE.exec(l);
    if (!m) return;
    const inner = m[1].trim();
    // Accept an em-dash or hyphen; writers use both.
    const parts = inner.split(/\s+[-–—]\s+/);
    const kind = (parts[0] ?? inner).trim();
    const detail = parts.slice(1).join(' - ').trim();
    out.push({ raw: inner, kind, detail, instrumental: !VOCAL_HINT.test(detail), line: i });
  });
  return out;
}

/** Sung (non-tag, non-empty) lines. */
export function sungLines(lyricsBlock: string): string[] {
  return (lyricsBlock ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !TAG_LINE.test(l));
}

export type SetupSeverity = 'error' | 'warning' | 'info';

export interface SetupFinding {
  severity: SetupSeverity;
  field: 'lyrics' | 'style' | 'exclude' | 'weirdness' | 'styleInfluence';
  message: string;
  /** What to do about it — never a rewrite, always a direction. */
  fix?: string;
}

/** Split a style string into its comma-separated descriptors, groups flattened. */
export function styleDescriptors(style: string): string[] {
  return (style ?? '')
    .split(/[|,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Words in an instrumental tag's detail that look like instrument names.
 *
 * Deliberately loose — it strips the role nouns ("phrase", "fill", "solo") and
 * keeps the rest. A false positive costs one advisory line; a false negative
 * means a contradiction reaches the generator silently.
 */
const ROLE_WORDS = /\b(phrase|fill|answer|swell|lift|groove|solo|riff|motif|break|section|and|the|full|instrumental|intro|outro|interlude)\b/gi;

export function instrumentsInTag(detail: string): string[] {
  return (detail ?? '')
    .replace(ROLE_WORDS, ' ')
    .split(/[\s,]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 2);
}

/**
 * Validate a proposed setup.
 *
 * The two checks that matter most are cross-field, because each is a real
 * contradiction the generator receives silently:
 *  - an instrument named in a break tag that the style prompt never mentions
 *  - an exclusion naming something the style prompt asks for
 * Neither is visible reading either field alone, which is exactly why they
 * survive a human review and waste a credit.
 */
export function checkSetup(setup: SunoSetup): SetupFinding[] {
  const findings: SetupFinding[] = [];
  const style = (setup.style ?? '').trim();
  const descriptors = styleDescriptors(style);
  const styleLower = style.toLowerCase();

  // ---- style box ----
  if (!style) {
    findings.push({ severity: 'error', field: 'style', message: 'Style box is empty.' });
  } else if (style.length > PROMPT_LIMITS.STYLE_MAX) {
    findings.push({
      severity: 'error',
      field: 'style',
      message: `Style is ${style.length} chars — over the ${PROMPT_LIMITS.STYLE_MAX} limit and will be truncated.`,
      fix: 'Drop whole descriptors from the least load-bearing group rather than trimming words everywhere.',
    });
  } else if (style.length < STYLE_TARGET_MIN) {
    findings.push({
      severity: 'warning',
      field: 'style',
      message: `Style is only ${style.length} chars — under the ~${STYLE_TARGET_MIN} where the box starts doing work.`,
      fix: 'Name the vocal roles, the instrument set and a production character; an under-filled box leaves the arrangement to chance.',
    });
  } else if (style.length > STYLE_TARGET_MAX) {
    findings.push({
      severity: 'info',
      field: 'style',
      message: `Style is ${style.length} chars — past the ~${STYLE_TARGET_MAX} comfort band but within the cap.`,
    });
  }

  // Negatives belong in the Exclude field; in the style box the model still
  // processes the unwanted idea alongside the wanted ones.
  const negative = /\b(no|without|avoid|exclude|not)\s+[a-z]/i.exec(style);
  if (negative) {
    findings.push({
      severity: 'warning',
      field: 'style',
      message: `Style box contains a negative ("${negative[0]}…").`,
      fix: 'Move it to the Exclude field — a negative here makes the model weigh the unwanted idea too.',
    });
  }

  // ---- exclude ----
  if (setup.exclude.length > EXCLUDE_MAX) {
    findings.push({
      severity: 'warning',
      field: 'exclude',
      message: `${setup.exclude.length} exclusions — more than the ~${EXCLUDE_MAX} that stay effective.`,
      fix: 'Keep the few that actually threaten this song; a long list dilutes every item in it.',
    });
  }
  for (const ex of setup.exclude) {
    const e = ex.trim().toLowerCase();
    if (!e) continue;
    if (descriptors.some((d) => d === e || d.includes(e))) {
      findings.push({
        severity: 'error',
        field: 'exclude',
        message: `"${ex}" is excluded but the style prompt asks for it.`,
        fix: 'Remove it from one side — the generator is being told to use and avoid the same thing.',
      });
    }
  }

  // ---- lyrics block ----
  const tags = parseSectionTags(setup.lyricsBlock);
  const sung = sungLines(setup.lyricsBlock);
  if (tags.length === 0) {
    findings.push({
      severity: 'error',
      field: 'lyrics',
      message: 'No [section] tags — the lyric has no musical break points.',
      fix: 'Mark each section as [Kind - Detail], e.g. a chorus with its vocal role, and place instrumental breaks between them.',
    });
  }
  if (setup.lyricsBlock.length > PROMPT_LIMITS.LYRICS_MAX_CHARS) {
    findings.push({
      severity: 'error',
      field: 'lyrics',
      message: `Lyrics are ${setup.lyricsBlock.length} chars — over the ${PROMPT_LIMITS.LYRICS_MAX_CHARS} limit.`,
    });
  }
  if (tags.length > 0 && sung.length === 0) {
    findings.push({ severity: 'error', field: 'lyrics', message: 'Section tags but no sung lines.' });
  }

  // Cross-field: a break naming an instrument the style never mentions.
  for (const t of tags.filter((x) => x.instrumental && x.detail)) {
    const named = instrumentsInTag(t.detail);
    const unknown = named.filter((n) => !styleLower.includes(n));
    if (named.length > 0 && unknown.length === named.length) {
      findings.push({
        severity: 'warning',
        field: 'lyrics',
        message: `[${t.raw}] names ${unknown.join(', ')}, which the style prompt never mentions.`,
        fix: 'Add it to the instrument descriptors, or name a break instrument the style already has.',
      });
    }
  }

  // ---- sliders ----
  for (const [field, value] of [
    ['weirdness', setup.weirdness],
    ['styleInfluence', setup.styleInfluence],
  ] as const) {
    if (!Number.isFinite(value) || value < SLIDER_MIN || value > SLIDER_MAX) {
      findings.push({
        severity: 'error',
        field,
        message: `${field} must be between ${SLIDER_MIN} and ${SLIDER_MAX}.`,
      });
    }
  }

  return findings;
}

/** True when nothing would waste a credit. Warnings do not block. */
export function isReady(findings: SetupFinding[]): boolean {
  return !findings.some((f) => f.severity === 'error');
}
