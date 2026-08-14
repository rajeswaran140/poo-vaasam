/**
 * Pure helpers for bulk word collection: parse a pasted block of Tamil words
 * into create-ready inputs, and serialise the lexicon to CSV for backup/reuse.
 *
 * No I/O — the API routes (/bulk) and the export button own the side effects.
 * Kept pure so the parsing/escaping rules are unit-testable in isolation.
 */

import { normalizeWord, type LexiconWordDraft, type LexiconRegister, type LexiconUsage } from '@/types/lexicon';

export interface PasteOptions {
  register: LexiconRegister;
  usage: LexiconUsage;
  themes: string[];
}

// A line is "<word>" or "<word> <sep> <gloss>". Separators: an en/em-dash or a
// hyphen surrounded by spaces (so hyphenated romanisations like "vil-akku"
// don't split), or a bare pipe/equals/colon/tab. The word is everything before
// the first separator.
const SEP = /^(.+?)(?:\s+[—–-]\s+|\s*[|=:\t]\s*)(.+)$/;

// A word with no meaning yet — collected now, glossed later via row-edit.
export const GLOSS_PLACEHOLDER = '—';

/**
 * Split one pasted/typed line into candidate words.
 *
 * ⚠️ NEWLINES ALONE ARE NOT ENOUGH — that assumption put a real blob in the
 * database. On 2026-08-14 Raj pasted `பொற்கதிர், இளங்கதிர், செங்கதிர்,கதிரொளி,
 * பொற்சுடர்` (five synonyms for "sun"), which is ONE line, so it became ONE
 * entry 49 characters long. People paste comma-separated lists because that is
 * how word families are written down.
 *
 * The gloss separator is matched FIRST by the caller, so `நிலா — moon, sky`
 * keeps "moon, sky" intact as a gloss; only the WORD side is split here.
 */
export const LIST_SEPARATORS = /[,;、，]/;

export function splitWordList(wordSide: string): string[] {
  return wordSide.split(LIST_SEPARATORS).map((w) => w.trim()).filter(Boolean);
}

/**
 * Parse pasted or typed text into deduped, create-ready inputs. Words may be
 * separated by newlines AND/OR commas — `a, b` and `a\nb` both yield two.
 * Register/usage/themes from the panel apply to every parsed word; a missing
 * gloss becomes a placeholder the admin fills in later. `skipped` counts blank,
 * over-long (>60 char), and within-paste duplicate lines that were dropped.
 */
export function parsePastedWords(text: string, opts: PasteOptions): { words: LexiconWordDraft[]; skipped: number } {
  const seen = new Set<string>();
  const words: LexiconWordDraft[] = [];
  let skipped = 0;

  for (const rawLine of (text ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const m = SEP.exec(line);
    const wordSide = (m ? m[1] : line).trim();
    const gloss = (m ? m[2].trim() : '') || GLOSS_PLACEHOLDER;

    // One line can carry a whole word family; they share the line's gloss.
    for (const word of splitWordList(wordSide)) {
      if (!word || word.length > 60) {
        skipped++;
        continue;
      }
      const key = normalizeWord(word);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      words.push({ word, gloss, register: opts.register, usage: opts.usage, themes: opts.themes });
    }
  }

  return { words, skipped };
}

/**
 * The bulk endpoint accepts at most 50 words per request
 * (`lexiconBulkSchema`). A realistic paste blows straight past that: Raj's
 * nature list on 2026-08-14 was 55 lines which, once comma-splitting landed,
 * parsed to **153 words** — a correct parse that the API then rejected whole
 * with "Too big: expected array to have <=50 items", so the import failed and
 * nothing was saved. Raising the cap is the wrong fix (an unbounded write
 * request is worth bounding); sending several requests is the right one.
 */
export const BULK_MAX_WORDS = 50;

/** Split a parsed batch into request-sized chunks, order preserved. */
export function chunkForBulk<T>(words: readonly T[], size = BULK_MAX_WORDS): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size));
  return out;
}

export interface CsvRow {
  word: string;
  romanization?: string;
  gloss: string;
  tamilMeaning?: string;
  register: string;
  registers?: string[];
  wordType?: string;
  lexicalStatus?: string;
  confidence?: string;
  usage: string;
  themes: string[];
  moods?: string[];
  synonyms?: string[];
  relatedWords?: string[];
  antonyms?: string[];
  etukai?: string[];
  monai?: string[];
  poeticUsage?: string;
  examples?: string[];
  notes?: string;
}

/**
 * CSV column order. The FIRST SIX are frozen in this order — an export is a
 * backup, and Raj has older files on disk that a re-import (or a spreadsheet
 * he already built) reads positionally. New columns are appended, never
 * inserted, so an old reader still finds word/gloss/register where it expects.
 */
const CSV_COLUMNS = [
  'word',
  'romanization',
  'gloss',
  'register',
  'usage',
  'themes',
  'tamil_meaning',
  'registers',
  'word_type',
  'lexical_status',
  'confidence',
  'moods',
  'synonyms',
  'related_words',
  'antonyms',
  'etukai',
  'monai',
  'poetic_usage',
  'examples',
  'notes',
] as const;

/**
 * Serialise rows to RFC-4180 CSV (header + quoted fields).
 *
 * Multi-value fields join with a space, EXCEPT the ones whose members can
 * themselves contain a space (examples are phrases): those join with ' | ',
 * because `வைகறைத் தென்றல் வைகறை வானம்` is unsplittable on re-read.
 */
export function lexiconToCsv(rows: CsvRow[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const words = (v?: string[]) => (v ?? []).join(' ');
  const phrases = (v?: string[]) => (v ?? []).join(' | ');

  const lines = rows.map((r) =>
    [
      r.word,
      r.romanization ?? '',
      r.gloss,
      r.register,
      r.usage,
      words(r.themes),
      r.tamilMeaning ?? '',
      words(r.registers),
      r.wordType ?? '',
      r.lexicalStatus ?? '',
      r.confidence ?? '',
      words(r.moods),
      words(r.synonyms),
      words(r.relatedWords),
      words(r.antonyms),
      words(r.etukai),
      words(r.monai),
      r.poeticUsage ?? '',
      phrases(r.examples),
      r.notes ?? '',
    ]
      .map(esc)
      .join(',')
  );
  return [CSV_COLUMNS.join(','), ...lines].join('\n');
}
