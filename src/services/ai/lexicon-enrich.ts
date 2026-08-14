/**
 * The three "help me think" lexicon tools: enrich existing entries, find
 * alternatives with their nuances, and read the concepts out of a lyric line.
 *
 * All three are PROPOSALS. Nothing here writes; the admin reviews and saves.
 * They share the classification discipline and language policy in
 * `lexicon-suggest.ts` — see the four rules at the top of that file.
 *
 * The shape of the interaction is deliberately *discover → compare →
 * understand → select*, never *prompt → generate song*: alternatives come with
 * the DIFFERENCE between them rather than a list of interchangeable synonyms,
 * and the lyric reader suggests imagery without touching the line.
 */

import { z } from 'zod';
import {
  LEXICON_REGISTERS,
  LEXICAL_STATUSES,
  LEXICON_WORD_TYPES,
  LEXICON_CONFIDENCE,
  LEXICON_MOODS,
} from '@/types/lexicon';
import { generateText } from '@/services/ai/text-engine';
import { extractJson, looksLikeVerse } from '@/services/ai/lexicon-suggest';

const LANGUAGE_POLICY = `You support an original Tamil poet's own writing.
- Never write complete lyrics, verses, or songs.
- Never quote, reproduce, or closely imitate existing Tamil film songs, poems, or copyrighted lyrics.
- Example phrases must be SHORT (2-4 words) and ORIGINAL.
- Never fabricate a meaning, and never present a coined compound as an established dictionary word.`;

const REGISTER_RULE = `"sangam" means demonstrably associated with Sangam-era literature — NEVER a word that merely sounds literary. Prefer "literary" or "modern-poetic" when unsure. A compound the poet coined is lexicalStatus "creative-poetic" with confidence "experimental".`;

// ---------------------------------------------------------------------------
// 1. Enrichment — propose the metadata a bare word is missing.
// ---------------------------------------------------------------------------

const enrichmentSchema = z.object({
  word: z.string().trim().min(1).max(60),
  gloss: z.string().trim().max(400).optional(),
  tamilMeaning: z.string().trim().max(400).optional(),
  registers: z.array(z.enum(LEXICON_REGISTERS)).min(1).max(3).optional(),
  wordType: z.enum(LEXICON_WORD_TYPES).optional(),
  lexicalStatus: z.enum(LEXICAL_STATUSES).optional(),
  confidence: z.enum(LEXICON_CONFIDENCE).optional(),
  themes: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  moods: z.array(z.enum(LEXICON_MOODS)).max(4).optional(),
  synonyms: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  relatedWords: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  poeticUsage: z.string().trim().max(600).optional(),
  examples: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
});

export type LexiconEnrichment = z.infer<typeof enrichmentSchema>;

/** A word handed to the enricher: what we already know about it. */
export interface EnrichCandidate {
  word: string;
  gloss?: string;
}

/**
 * Propose metadata for words that have little or none — the follow-up to a bulk
 * paste, where 50 headwords arrive with a shared gloss and nothing else.
 *
 * Batched deliberately: one call for up to `MAX_ENRICH_BATCH` words gives the
 * model the whole set at once, so it assigns consistent themes across a family
 * instead of drifting between calls.
 */
export const MAX_ENRICH_BATCH = 20;

export async function enrichWords(candidates: readonly EnrichCandidate[]): Promise<LexiconEnrichment[]> {
  const batch = candidates.slice(0, MAX_ENRICH_BATCH);
  if (!batch.length) return [];

  const list = batch
    .map((c) => (c.gloss && c.gloss !== '—' ? `${c.word} — ${c.gloss}` : c.word))
    .join('\n');

  const system = `You are a Tamil lexicographer completing dictionary entries for a songwriter's personal lexicon.

${LANGUAGE_POLICY}

${REGISTER_RULE}

Respond with ONLY a JSON array — no prose, no markdown fences.`;

  const prompt =
    `For each Tamil word below, propose the missing metadata. Keep any meaning already given unless it is plainly wrong.\n\n${list}\n\n` +
    `Return ONLY a JSON array, one object per word, in the same order:\n` +
    `{"word":"<the same headword>","gloss":"<English>","tamilMeaning":"<Tamil>","registers":["<1-3>"],` +
    `"wordType":"<type>","lexicalStatus":"<status>","confidence":"<confidence>","themes":["<theme>"],` +
    `"moods":["<mood>"],"synonyms":["<Tamil>"],"relatedWords":["<Tamil>"],` +
    `"poeticUsage":"<one sentence in Tamil>","examples":["<2-4 word original phrase>"]}\n` +
    `If you are unsure of a field, omit it rather than guessing.`;

  const res = await generateText({ system, prompt, maxTokens: 6000, temperature: 0.4 });
  if (!res.ok) return [];
  return parseEnrichments(res.text, batch);
}

/**
 * Validate enrichment output and keep only entries for words we actually asked
 * about — a model that renames the headword, or invents an extra one, must not
 * be able to smuggle a new entry into a review list labelled "your words".
 */
export function parseEnrichments(raw: string, asked: readonly EnrichCandidate[]): LexiconEnrichment[] {
  const arr = extractJson(raw);
  if (!Array.isArray(arr)) return [];

  const wanted = new Map(asked.map((c) => [c.word.normalize('NFC').trim(), c.word]));
  const seen = new Set<string>();
  const out: LexiconEnrichment[] = [];

  for (const item of arr) {
    const parsed = enrichmentSchema.safeParse(item);
    if (!parsed.success) continue;

    const key = parsed.data.word.normalize('NFC').trim();
    const original = wanted.get(key);
    if (!original || seen.has(key)) continue;
    seen.add(key);

    const examples = (parsed.data.examples ?? []).filter((e) => !looksLikeVerse(e));
    out.push({ ...parsed.data, word: original, examples });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Alternatives — near-synonyms WITH the difference between them.
// ---------------------------------------------------------------------------

const alternativeSchema = z.object({
  word: z.string().trim().min(1).max(60),
  gloss: z.string().trim().min(1).max(200),
  /** How this differs from the word asked about. The point of the feature. */
  nuance: z.string().trim().min(1).max(300),
  register: z.enum(LEXICON_REGISTERS).optional(),
  lexicalStatus: z.enum(LEXICAL_STATUSES).optional(),
  /** True when it can stand in the same slot without changing the sense. */
  interchangeable: z.boolean().optional(),
});
export type LexiconAlternative = z.infer<typeof alternativeSchema>;

/**
 * Find alternatives for a word, each with its nuance.
 *
 * ⚠️ The prompt is explicit that these are NOT interchangeable. அழகு / எழில் /
 * வனப்பு / பொலிவு / நளினம் all gloss as "beauty" in English and are not the
 * same word in Tamil — வனப்பு is bodily comeliness, பொலிவு is radiance or
 * thriving, நளினம் is grace of movement. A list without those distinctions
 * would actively mislead, which is worse than returning nothing.
 */
export async function findAlternatives(word: string, gloss?: string, count = 6): Promise<LexiconAlternative[]> {
  if (!word.trim()) return [];

  const system = `You are a Tamil lexicographer explaining fine distinctions between near-synonyms to a poet.

${LANGUAGE_POLICY}

${REGISTER_RULE}

CRITICAL: near-synonyms are NOT interchangeable. For every candidate, state what makes it DIFFERENT from the original — the shade of meaning, the register, the kind of subject it suits. Never imply that all synonyms can be swapped freely. If a word genuinely can substitute without changing the sense, mark interchangeable true; otherwise false.

Respond with ONLY a JSON array — no prose, no markdown fences.`;

  const prompt =
    `Tamil word: ${word}${gloss ? ` (${gloss})` : ''}\n\n` +
    `Give up to ${count} alternatives a poet could consider in its place.\n` +
    `Return ONLY a JSON array: {"word":"<Tamil>","gloss":"<English>","nuance":"<how it differs from ${word}>","register":"<register>","lexicalStatus":"<status>","interchangeable":<true|false>}`;

  const res = await generateText({ system, prompt, maxTokens: 2500, temperature: 0.6 });
  if (!res.ok) return [];
  return parseAlternatives(res.text, word);
}

/** Validate alternatives; drop the word itself and anything without a nuance. */
export function parseAlternatives(raw: string, original: string): LexiconAlternative[] {
  const arr = extractJson(raw);
  if (!Array.isArray(arr)) return [];

  const self = original.normalize('NFC').trim();
  const seen = new Set<string>();
  const out: LexiconAlternative[] = [];

  for (const item of arr) {
    const parsed = alternativeSchema.safeParse(item);
    if (!parsed.success) continue;
    const key = parsed.data.word.normalize('NFC').trim();
    if (key === self || seen.has(key)) continue;
    seen.add(key);
    out.push(parsed.data);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Lyric context — read the concepts, suggest imagery, DO NOT rewrite.
// ---------------------------------------------------------------------------

const lyricContextSchema = z.object({
  /** The major concepts present in the line, as Tamil words. */
  concepts: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  suggestions: z
    .array(
      z.object({
        word: z.string().trim().min(1).max(60),
        gloss: z.string().trim().max(200).optional(),
        /** Which concept it serves, and what it would bring to the line. */
        note: z.string().trim().max(300).optional(),
        register: z.enum(LEXICON_REGISTERS).optional(),
      })
    )
    .max(24)
    .default([]),
});
export type LyricContextResult = z.infer<typeof lyricContextSchema>;

/**
 * Identify the concepts in a pasted lyric line and offer related vocabulary.
 *
 * ⚠️ IT MUST NOT REWRITE THE LINE. Raj's instruction: suggest alternatives and
 * related imagery "WITHOUT rewriting the lyric unless explicitly requested".
 * The prompt forbids it and `parseLyricContext` drops any suggestion long
 * enough to be a rewritten line rather than a word.
 */
export async function analyzeLyricLine(line: string): Promise<LyricContextResult> {
  const text = (line ?? '').trim();
  if (!text) return { concepts: [], suggestions: [] };

  const system = `You are a Tamil vocabulary assistant for a poet who is writing his own lyrics.

${LANGUAGE_POLICY}

${REGISTER_RULE}

ABSOLUTE RULE: do NOT rewrite, improve, complete, or restate the poet's line. Do not offer a corrected version. Identify the concepts in it and offer individual WORDS he might explore. The line is his.

Respond with ONLY a JSON object — no prose, no markdown fences.`;

  const prompt =
    `Line: ${text}\n\n` +
    `1. List the major concepts in it as Tamil words (e.g. மாலை, வானம், நிறம், இயற்கை).\n` +
    `2. For those concepts, suggest related Tamil vocabulary and imagery he could explore — individual words, not lines.\n\n` +
    `Return ONLY: {"concepts":["<Tamil>"],"suggestions":[{"word":"<Tamil>","gloss":"<English>","note":"<what it brings>","register":"<register>"}]}`;

  const res = await generateText({ system, prompt, maxTokens: 2500, temperature: 0.7 });
  if (!res.ok) return { concepts: [], suggestions: [] };
  return parseLyricContext(res.text);
}

/**
 * The most words a headword or concept may contain.
 *
 * ⚠️ `looksLikeVerse` is the wrong test for THIS field. It allows up to six
 * words, which is fine for an example phrase and far too generous for a word:
 * "மாலை வானம் செக்கச் சிவந்து எரிகிறது இன்று" is six words, passes that check,
 * and is plainly a rewritten line wearing a `word` label. A Tamil headword is
 * one word — occasionally two, rarely three.
 */
const MAX_HEADWORD_WORDS = 3;

const isWordNotLine = (s: string): boolean =>
  !looksLikeVerse(s) && s.trim().split(/\s+/).length <= MAX_HEADWORD_WORDS;

/** Validate the lyric reading, dropping anything that is a line rather than a word. */
export function parseLyricContext(raw: string): LyricContextResult {
  const obj = extractJson(raw);
  const parsed = lyricContextSchema.safeParse(obj);
  if (!parsed.success) return { concepts: [], suggestions: [] };

  return {
    concepts: parsed.data.concepts.filter(isWordNotLine),
    suggestions: parsed.data.suggestions.filter((s) => isWordNotLine(s.word)),
  };
}
