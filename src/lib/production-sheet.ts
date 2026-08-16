/**
 * PRODUCTION SHEET → structured lyrics.
 *
 * ⚠️ WHY THIS EXISTS. Some songs' stored `body` is not a lyric sheet but an
 * ARRANGEMENT sheet — the form given to the music tool:
 *
 *     [Intro]
 *     (solo violin & nadaswaram over tambura drone, plaintive)
 *     [Chorus - Female]
 *     நீ சிரிச்ச நேரம்தான்...
 *
 * `Lyrics.fromPlainText` treats every non-blank line as sung, so feeding a sheet
 * like this to the caption builder puts "[Intro]" and "(solo violin & nadaswaram
 * over tambura drone, plaintive)" ON SCREEN during the song. நீ சிரிச்ச நேரம்
 * has 53,380 views, so that mistake is not a small one.
 *
 * Two annotation forms, two different meanings:
 *
 *   [Section]      a STRUCTURAL marker — becomes the section's kind + label,
 *                  never a line. Labels are section metadata and `lyricsToCues`
 *                  never emits them, so they cannot reach the screen.
 *   (direction)    an ARRANGEMENT note for the performer/tool. Not sung, not
 *                  displayable — dropped.
 *
 * Nothing is dropped silently: `dropped` returns every discarded line so a
 * caller can show what was removed before anything is uploaded.
 */

import { Lyrics, type LyricsDTO, type LyricsSectionKind } from '@/domain/songs/Lyrics';

export interface SheetParseResult {
  lyrics: LyricsDTO;
  /** Arrangement directions removed — reported, never discarded silently. */
  dropped: string[];
  /** Section headers found, in order, as `[header] → kind`. */
  sections: Array<{ header: string; kind: LyricsSectionKind }>;
}

/** Whole-line arrangement direction: "(solo violin, plaintive)". */
const DIRECTION = /^\(.*\)$/;
/** Structural header: "[Chorus - Female]", "[Verse 2]". */
const HEADER = /^\[(.+)\]$/;

/**
 * Map an English/Tamil section header onto a Tamil section kind.
 *
 * `Chorus → pallavi` because the pallavi IS the recurring refrain in Tamil song
 * structure; `Verse → charanam` likewise. Anything without a clear counterpart
 * (bridge, interlude, instrumental) becomes `other` rather than being forced
 * into a form it isn't.
 */
export function sectionKindFor(header: string): LyricsSectionKind {
  const h = header.toLowerCase();
  if (/\bintro\b|முன்னிசை/.test(h)) return 'intro';
  if (/anupallavi|அனுபல்லவி|pre[- ]?chorus/.test(h)) return 'anupallavi';
  if (/chorus|pallavi|பல்லவி|refrain|hook/.test(h)) return 'pallavi';
  if (/verse|charanam|சரணம்/.test(h)) return 'charanam';
  return 'other';
}

/**
 * Parse an arrangement sheet into structured lyrics, keeping only sung lines.
 *
 * A section whose lines are all directions (a pure instrumental passage such as
 * `[Intro]` or `[Outro]`) yields NO section at all — an empty section would
 * otherwise survive into the caption track as dead structure.
 */
export function parseProductionSheet(text: string): SheetParseResult {
  const dropped: string[] = [];
  const sections: Array<{ header: string; kind: LyricsSectionKind }> = [];
  const out: LyricsDTO = { sections: [] };

  let current: { kind: LyricsSectionKind; label?: string; lines: Array<{ text: string }> } | null =
    null;

  const flush = () => {
    // Only keep a section that actually has words to sing.
    if (current && current.lines.length > 0) out.sections.push(current);
    current = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const header = line.match(HEADER);
    if (header) {
      flush();
      const label = header[1].trim();
      const kind = sectionKindFor(label);
      sections.push({ header: label, kind });
      current = { kind, label, lines: [] };
      continue;
    }

    if (DIRECTION.test(line)) {
      dropped.push(line);
      continue;
    }

    // A sung line before any header still belongs somewhere.
    if (!current) current = { kind: 'other', lines: [] };
    current.lines.push({ text: line });
  }
  flush();

  // Round-trip through the value object so the same sanitising (trimming, caps,
  // dropping empties) applies as on any other authoring route.
  return { lyrics: Lyrics.fromObject(out).toObject(), dropped, sections };
}

/**
 * Does this body look like an arrangement sheet rather than a plain lyric sheet?
 * Used to decide whether a stored `body` needs this converter at all.
 */
export function looksLikeProductionSheet(text: string): boolean {
  return text.split('\n').some((l) => HEADER.test(l.trim()));
}
