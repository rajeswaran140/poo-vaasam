/**
 * SUNO pre-flight linter — validate a composer-generated SUNO style prompt +
 * lyrics BEFORE spending a credit. SUNO has no API, so every generation costs a
 * credit; this catches the known credit-wasters up front: over-long or
 * contradictory style prompts, lyrics leaking into the style box, missing
 * section tags, lyrics too long for one render, mixed language, stray
 * emoji/markup. Pure + deterministic (no LLM, no network) → fully unit-testable;
 * an optional LLM "critic" can layer on top later.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  field: 'style' | 'lyrics';
  severity: Severity;
  code: string;
  message: string;
  /** Concrete suggested fix. */
  fix?: string;
}

export interface PreflightInput {
  /** The SUNO "Style of Music" prompt paragraph — must NOT contain lyrics. */
  style: string;
  /** The lyrics, ideally with [Verse]/[Chorus]/… section tags. */
  lyrics: string;
  /** Optional target song length (seconds) for a rough lyric-length sanity check. */
  targetSeconds?: number;
}

export interface PreflightResult {
  /** True when there are no `error`-severity findings — safe to spend a credit. */
  ready: boolean;
  /** 0–100 readiness score (errors hurt most). */
  score: number;
  findings: Finding[];
}

/** SUNO field limits (tunable; based on the custom-mode "Style of Music" box). */
export const SUNO_LIMITS = {
  STYLE_MAX: 1000, // hard cap — SUNO's style box truncates beyond ~1000 chars
  STYLE_SOFT: 850, // warn only as it APPROACHES the cap (composer prompts run rich by design, and SUNO V5 accepts them)
  LYRICS_MAX_CHARS: 5000, // SUNO truncates very long lyrics in a single render
  LYRICS_SOFT_LINES: 60, // beyond this, likely too long for one ~3–4 min song
  /** Rough sung pace for the duration check: ~6s per lyric line. */
  SECONDS_PER_LINE: 6,
} as const;

// Match any bracketed marker CONTAINING a known section word, so descriptive
// tags like "[Chorus — Pallavi]" / "[Verse 1 — Anupallavi]" and Carnatic names
// (pallavi/anupallavi/charanam/…) all count as structure.
const SECTION_TAG =
  /\[[^\]]*\b(intro|verse|pre-?chorus|chorus|bridge|hook|outro|drop|break|instrumental|interlude|pallavi|anupallavi|charanam|idaicharanam|refrain|coda)\b[^\]]*\]/i;
const TAMIL = /[஀-௿]/;
// Common emoji / pictographic ranges (SUNO may try to "sing" them).
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{2764}]/u;

/** Genre pairs that confuse SUNO when combined in one style prompt. */
const GENRE_CONFLICTS: Array<[RegExp, RegExp, string]> = [
  [/\b(edm|techno|dubstep|electronic dance|house music)\b/i, /\b(folk|carnatic|classical|acoustic|devotional)\b/i, 'electronic vs acoustic/folk'],
  [/\b(metal|heavy metal|thrash)\b/i, /\b(lullaby|devotional|bhajan|ballad|soft)\b/i, 'metal vs gentle/devotional'],
  [/\b(rap|hip-?hop|trap)\b/i, /\b(carnatic|classical|devotional|bhajan)\b/i, 'rap vs carnatic/devotional'],
];

// A good SUNO style prompt names these concrete elements.
const CONCRETE = {
  tempo: /\b(\d{2,3}\s?bpm|slow|mid-?tempo|up-?tempo|fast|moderate|andante|allegro|ballad tempo)\b/i,
  instrument: /\b(flute|veena|violin|tabla|mridangam|guitar|piano|strings|nadaswaram|sitar|santoor|percussion|synth|harmonium|drums|cello|sarod)\b/i,
  vocal: /\b(male|female|duet|solo|choir|vocals?|voice|baritone|soprano)\b/i,
  mood: /\b(romantic|melancholic|joyful|devotional|nostalgic|uplifting|soulful|tender|energetic|peaceful|emotional|warm|sad|happy)\b/i,
};

/** Latin letters outside [section tags] — used for the mixed-language check. */
function latinOutsideTags(text: string): number {
  return (text.replace(/\[[^\]]*\]/g, '').match(/[A-Za-z]/g) || []).length;
}

function nonEmptyLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Lint a SUNO style prompt + lyrics. Returns findings + a readiness verdict.
 * `ready` is false when any `error` is present (would likely waste the credit).
 */
export function preflightSuno(input: PreflightInput): PreflightResult {
  const findings: Finding[] = [];
  const style = (input.style ?? '').trim();
  const lyrics = (input.lyrics ?? '').trim();
  const add = (field: Finding['field'], severity: Severity, code: string, message: string, fix?: string) =>
    findings.push({ field, severity, code, message, fix });

  // ---- Style prompt ----
  if (!style) {
    add('style', 'error', 'STYLE_EMPTY', 'No style prompt — the generator needs a style/description.', 'Add genre, mood, tempo, instrumentation and vocal type.');
  } else {
    if (style.length > SUNO_LIMITS.STYLE_MAX) {
      add('style', 'error', 'STYLE_TOO_LONG', `Style is ${style.length} chars — over the ${SUNO_LIMITS.STYLE_MAX}-char cap; the tail is dropped.`, 'Trim to the essentials (genre, mood, tempo, key instruments, vocal).');
    } else if (style.length > SUNO_LIMITS.STYLE_SOFT) {
      add('style', 'warning', 'STYLE_LONG', `Style is ${style.length} chars — approaching the ~${SUNO_LIMITS.STYLE_MAX}-char limit; could clip.`, 'Trim if easy, but rich prompts are fine on most current versions.');
    }
    if (SECTION_TAG.test(style) || /["“][^"”]{15,}/.test(style)) {
      add('style', 'error', 'STYLE_HAS_LYRICS', 'The style box appears to contain lyrics / section tags — the generator sings the style box too.', 'Move all lyrics to the lyrics field; keep the style box describing the music only.');
    }
    for (const [a, b, label] of GENRE_CONFLICTS) {
      if (a.test(style) && b.test(style)) {
        add('style', 'warning', 'STYLE_GENRE_CONFLICT', `Conflicting genres (${label}) — the generator often blends these into mush.`, 'Pick one primary genre.');
        break;
      }
    }
    const missing = (Object.keys(CONCRETE) as Array<keyof typeof CONCRETE>).filter((k) => !CONCRETE[k].test(style));
    if (missing.length >= 2) {
      add('style', 'warning', 'STYLE_VAGUE', `Style is missing concrete cues: ${missing.join(', ')}. Vague prompts give inconsistent results (= retries).`, 'Name a tempo, lead instrument(s), vocal type and mood.');
    }
  }

  // ---- Lyrics ----
  if (!lyrics) {
    add('lyrics', 'error', 'LYRICS_EMPTY', 'No lyrics provided.', 'Paste the structured lyrics with [Verse]/[Chorus] tags.');
  } else {
    // Count SUNG lines only — drop pure-bracket markers ([Verse], [Break — …]).
    const sungLines = nonEmptyLines(lyrics).filter((l) => !/^\[[^\]]*\]$/.test(l));
    if (!SECTION_TAG.test(lyrics)) {
      add('lyrics', 'warning', 'LYRICS_NO_STRUCTURE', 'No [Verse]/[Chorus]/… section tags — the generator structures the song better with them.', 'Add section tags (e.g. [Verse], [Chorus], [Bridge]).');
    }
    if (lyrics.length > SUNO_LIMITS.LYRICS_MAX_CHARS) {
      add('lyrics', 'error', 'LYRICS_TOO_LONG', `Lyrics are ${lyrics.length} chars — the generator truncates very long lyrics in one render.`, 'Split into multiple generations or trim repeats.');
    } else if (sungLines.length > SUNO_LIMITS.LYRICS_SOFT_LINES) {
      add('lyrics', 'warning', 'LYRICS_MANY_LINES', `${sungLines.length} lyric lines may exceed a single ~3–4 min render.`, 'Consider trimming or a two-part generation.');
    }
    if (TAMIL.test(lyrics) && latinOutsideTags(lyrics) > 40) {
      add('lyrics', 'warning', 'LYRICS_MIXED_LANG', 'Lyrics mix Tamil with substantial English (outside tags) — the generator often mispronounces mixed-language lines.', 'Keep one primary language, or transliterate the English into Tamil.');
    }
    if (EMOJI.test(lyrics)) {
      add('lyrics', 'warning', 'LYRICS_EMOJI', 'Lyrics contain emoji — the generator may try to vocalise them.', 'Remove emoji from the lyrics field.');
    }
    if (input.targetSeconds && input.targetSeconds > 0) {
      const estSeconds = sungLines.length * SUNO_LIMITS.SECONDS_PER_LINE;
      if (estSeconds > input.targetSeconds * 1.5) {
        add('lyrics', 'info', 'LYRICS_OVER_DURATION', `~${sungLines.length} lines (~${estSeconds}s sung) likely overshoots the ${input.targetSeconds}s target.`, 'Trim lines or raise the target length.');
      }
    }
  }

  const penalty = findings.reduce((n, f) => n + (f.severity === 'error' ? 25 : f.severity === 'warning' ? 10 : 3), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const ready = !findings.some((f) => f.severity === 'error');
  return { ready, score, findings };
}
