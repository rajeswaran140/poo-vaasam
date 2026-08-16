/**
 * Lyrics — a structured value object for a song's words.
 *
 * Why this exists: the Content aggregate's `body` field has historically held a
 * placeholder ("…full song on YouTube"), so the site's whole "lyrics" premise had
 * no real data behind it. Storing lyrics as STRUCTURE (sections → lines, with
 * optional romanisation + per-line timestamps) — not a single opaque blob —
 * unlocks, from one asset: on-site lyric pages (SEO), YouTube captions, lyrics in
 * descriptions, and time-synced karaoke for the Performers initiative.
 *
 * This is a pure, immutable value object: no DOM, no network, no DB — every rule
 * lives here and is fully unit-testable. Construction is TOLERANT (junk in →
 * empty/sanitised out, never throws) to match the codebase's defensive
 * `fromObject` style; hard size limits are enforced by truncation, not errors, so
 * a malformed import can never wedge a save.
 */

/** Section kinds in Carnatic/Tamil song structure, plus catch-alls. */
export const LYRICS_SECTION_KINDS = [
  'pallavi',
  'anupallavi',
  'charanam',
  'intro',
  'other',
] as const;

export type LyricsSectionKind = (typeof LYRICS_SECTION_KINDS)[number];

/** A single line: Tamil text, with optional romanisation + karaoke timestamp. */
export interface LyricsLineDTO {
  text: string;
  /** Romanised form (e.g. "nee siricha neram") for diaspora who can't read script. */
  romanized?: string;
  /** Start offset in seconds for time-synced display / LRC export. */
  startSeconds?: number;
}

export interface LyricsSectionDTO {
  kind: LyricsSectionKind;
  /** Display label as authored ("சரணம் 2", "Pallavi"); optional. */
  label?: string;
  lines: LyricsLineDTO[];
}

export interface LyricsDTO {
  sections: LyricsSectionDTO[];
}

// Defensive caps — generous for songs, but bounded so a bad import can't bloat a
// DynamoDB item past limits. Enforced by truncation (see sanitise()).
const MAX_SECTIONS = 50;
const MAX_LINES_PER_SECTION = 200;
const MAX_LINE_LENGTH = 1000;
const MAX_TOTAL_CHARS = 50_000;

/** Detect a section-header line ("Pallavi", "சரணம் 2", "Charanam:") → kind+label. */
function detectMarker(raw: string): { kind: LyricsSectionKind; label: string } | null {
  const label = raw.trim();
  // Drop a trailing colon, then a trailing number ("சரணம் 2" / "Charanam 2").
  const base = label
    .replace(/[:：]\s*$/, '')
    .replace(/[\s\-_]*\d+\s*$/, '')
    .trim()
    .toLowerCase();

  const defs: ReadonlyArray<readonly [LyricsSectionKind, readonly string[]]> = [
    ['anupallavi', ['anupallavi', 'anu pallavi', 'அனுபல்லவி']],
    ['pallavi', ['pallavi', 'பல்லவி']],
    ['charanam', ['charanam', 'saranam', 'சரணம்']],
    ['intro', ['intro', 'introduction', 'முன்னுரை', 'அறிமுகம்']],
  ];
  for (const [kind, names] of defs) {
    if (names.includes(base)) return { kind, label };
  }
  return null;
}

function isKind(value: unknown): value is LyricsSectionKind {
  return typeof value === 'string' && (LYRICS_SECTION_KINDS as readonly string[]).includes(value);
}

export class Lyrics {
  private constructor(private readonly _sections: ReadonlyArray<LyricsSectionDTO>) {}

  /** An empty lyrics object (the default for content without words). */
  static empty(): Lyrics {
    return new Lyrics([]);
  }

  /**
   * Reconstruct from a persisted/plain object. Tolerant: anything that isn't a
   * well-formed section/line is dropped; oversized input is truncated. Accepts
   * an existing {@link Lyrics} (returns it) for convenient call sites.
   */
  static fromObject(data: unknown): Lyrics {
    if (data instanceof Lyrics) return data;
    if (!data || typeof data !== 'object') return Lyrics.empty();
    const raw = (data as { sections?: unknown }).sections;
    if (!Array.isArray(raw)) return Lyrics.empty();
    return new Lyrics(Lyrics.sanitise(raw));
  }

  /**
   * Parse a plain-text blob into sections. Blocks are separated by blank lines;
   * a block whose first line is a section marker ("Pallavi" / "சரணம்") adopts
   * that kind/label, otherwise the block is `other`. A marker on its own line
   * (header, blank, then the verse) attaches to the following block.
   */
  static fromPlainText(text: unknown): Lyrics {
    if (typeof text !== 'string' || !text.trim()) return Lyrics.empty();

    const blocks = text
      .replace(/\r\n?/g, '\n')
      .split(/\n[ \t]*\n/);

    const sections: LyricsSectionDTO[] = [];
    let pending: { kind: LyricsSectionKind; label: string } | null = null;

    for (const block of blocks) {
      const rawLines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (rawLines.length === 0) continue;

      const marker = detectMarker(rawLines[0]);
      if (marker) {
        const body = rawLines.slice(1);
        if (body.length === 0) {
          pending = marker; // header-only block → attach to next block
          continue;
        }
        sections.push({ kind: marker.kind, label: marker.label, lines: body.map((t) => ({ text: t })) });
        pending = null;
        continue;
      }

      if (pending) {
        sections.push({ kind: pending.kind, label: pending.label, lines: rawLines.map((t) => ({ text: t })) });
        pending = null;
      } else {
        sections.push({ kind: 'other', lines: rawLines.map((t) => ({ text: t })) });
      }
    }

    return new Lyrics(Lyrics.sanitise(sections));
  }

  /** Validate + bound a raw section array into clean DTOs (drops junk). */
  private static sanitise(rawSections: unknown[]): LyricsSectionDTO[] {
    const out: LyricsSectionDTO[] = [];
    let totalChars = 0;

    for (const rawSection of rawSections) {
      if (out.length >= MAX_SECTIONS) break;
      if (!rawSection || typeof rawSection !== 'object') continue;

      const s = rawSection as { kind?: unknown; label?: unknown; lines?: unknown };
      const kind: LyricsSectionKind = isKind(s.kind) ? s.kind : 'other';
      const label =
        typeof s.label === 'string' && s.label.trim() ? s.label.trim() : undefined;

      const lines: LyricsLineDTO[] = [];
      if (Array.isArray(s.lines)) {
        for (const rawLine of s.lines) {
          if (lines.length >= MAX_LINES_PER_SECTION) break;
          const line = Lyrics.sanitiseLine(rawLine);
          if (!line) continue;
          totalChars += line.text.length;
          if (totalChars > MAX_TOTAL_CHARS) break;
          lines.push(line);
        }
      }

      if (lines.length === 0) continue; // a section with no usable lines is dropped
      const section: LyricsSectionDTO = { kind, lines };
      if (label) section.label = label;
      out.push(section);

      if (totalChars > MAX_TOTAL_CHARS) break;
    }

    return out;
  }

  /** Coerce one raw line into a clean DTO, or null if it has no text. */
  private static sanitiseLine(rawLine: unknown): LyricsLineDTO | null {
    if (typeof rawLine === 'string') {
      const text = rawLine.trim().slice(0, MAX_LINE_LENGTH);
      return text ? { text } : null;
    }
    if (!rawLine || typeof rawLine !== 'object') return null;

    const l = rawLine as { text?: unknown; romanized?: unknown; startSeconds?: unknown };
    const text = typeof l.text === 'string' ? l.text.trim().slice(0, MAX_LINE_LENGTH) : '';
    if (!text) return null;

    const line: LyricsLineDTO = { text };
    if (typeof l.romanized === 'string' && l.romanized.trim()) {
      line.romanized = l.romanized.trim().slice(0, MAX_LINE_LENGTH);
    }
    if (
      typeof l.startSeconds === 'number' &&
      Number.isFinite(l.startSeconds) &&
      l.startSeconds >= 0
    ) {
      line.startSeconds = l.startSeconds;
    }
    return line;
  }

  /** Deep copy of the sections (callers can't mutate internal state). */
  get sections(): LyricsSectionDTO[] {
    return this._sections.map((s) => ({
      kind: s.kind,
      ...(s.label ? { label: s.label } : {}),
      lines: s.lines.map((l) => ({ ...l })),
    }));
  }

  isEmpty(): boolean {
    return this._sections.length === 0;
  }

  /** Total number of lyric lines across all sections. */
  get lineCount(): number {
    return this._sections.reduce((n, s) => n + s.lines.length, 0);
  }

  /** True when at least one line carries a timestamp (karaoke-capable). */
  isTimeSynced(): boolean {
    return this._sections.some((s) => s.lines.some((l) => typeof l.startSeconds === 'number'));
  }

  /** Serialise for persistence / API. Empty → `{ sections: [] }`. */
  toObject(): LyricsDTO {
    return { sections: this.sections };
  }

  /**
   * Flatten back to a plain-text blob (labels prefix their section). Round-trips
   * with {@link fromPlainText} for label-carrying structure.
   */
  toPlainText(): string {
    return this._sections
      .map((s) => {
        const header = s.label ? `${s.label}\n` : '';
        return header + s.lines.map((l) => l.text).join('\n');
      })
      .join('\n\n');
  }

  /**
   * Export an LRC time-synced lyrics file (for karaoke / caption seeds). Only
   * lines with a `startSeconds` are emitted; returns '' when none are synced.
   */
  toLRC(): string {
    const tag = (secs: number) => {
      const m = Math.floor(secs / 60);
      const s = secs - m * 60;
      const ss = s.toFixed(2).padStart(5, '0');
      return `[${String(m).padStart(2, '0')}:${ss}]`;
    };
    const lines: string[] = [];
    for (const section of this._sections) {
      for (const line of section.lines) {
        if (typeof line.startSeconds === 'number') {
          lines.push(`${tag(line.startSeconds)}${line.text}`);
        }
      }
    }
    return lines.join('\n');
  }
}
