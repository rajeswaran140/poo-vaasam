/**
 * AI assistance for the lexicon: suggest new words, enrich existing ones, find
 * alternatives with their nuances, and read the concepts out of a lyric line.
 *
 * FOUR RULES THIS MODULE ENFORCES, because they are the difference between a
 * tool that helps Raj write and one that writes for him:
 *
 * 1. **It proposes; it never commits.** Every function returns candidates for
 *    review. Nothing here writes to the database, and enrichment output is a
 *    suggestion the poet edits, not a fact.
 * 2. **It never writes lyrics.** Vocabulary, meanings, relations, and SHORT
 *    original example phrases only. `analyzeLyricLine` explicitly does not
 *    rewrite the line it is given.
 * 3. **It never imitates existing songs.** Examples must be original; the
 *    prompt says so, and `looksLikeVerse` drops anything long enough to be one.
 * 4. **It is conservative about history.** `sangam` is a claim about Sangam-era
 *    literature, not a compliment. The prompt spells this out and the parser
 *    downgrades an unevidenced historical claim rather than trusting it.
 *
 * Never in a render path — explicit admin action only.
 */

import {
  lexiconWordInputSchema,
  normalizeWord,
  HISTORICAL_REGISTERS,
  type LexiconWordInput,
  type LexiconSuggestRequest,
} from '@/types/lexicon';
import { generateText, isTextEngineConfigured } from '@/services/ai/text-engine';

export function isLexiconAiConfigured(): boolean {
  // Engine-selectable: Anthropic default, Gemini opt-in via AUX_AI_ENGINE.
  return isTextEngineConfigured();
}

/**
 * The classification discipline, repeated into every prompt. Written as rules
 * about EVIDENCE rather than style, because "be careful" produces confident
 * mislabels and "only claim what you can point to" does not.
 */
const CLASSIFICATION_RULES = `REGISTER — be conservative. Historical claims need evidence:
- "sangam": ONLY for words/technical concepts demonstrably associated with Sangam-era literature (e.g. அகத்திணை, உரிப்பொருள்). NEVER label a word sangam because it sounds literary or beautiful.
- "classical": established older/literary Tamil with historical usage, not specifically Sangam.
- "literary": appropriate to formal literature, poetry, elevated writing.
- "modern-poetic": modern coinages and compounds for contemporary poems/lyrics (அன்பலை, நினைவலை, மனச்சோலை).
- "common", "colloquial", "regional", "archaic": as their names say.
A word may hold up to 3 registers (e.g. அன்பு is ["common","literary"]).

LEXICAL STATUS — say honestly whether it is an attested word or a construction:
"established", "established-literary", "historical", "modern-compound", "creative-poetic", "uncertain".
A compound you formed yourself is "creative-poetic" with confidence "experimental". This is not a criticism — it is the difference between a dictionary claim and a poetic one.

CONFIDENCE: "verified" only with real lexical/literary evidence. Otherwise "high", "medium", or "experimental".`;

const LANGUAGE_POLICY = `You support an original Tamil poet's own writing.
- Never write complete lyrics, verses, or songs.
- Never quote, reproduce, or closely imitate existing Tamil film songs, poems, or copyrighted lyrics.
- Example phrases must be SHORT (2-4 words) and ORIGINAL, showing natural usage only.
- Never invent a word and present it as established, and never fabricate a meaning.`;

const SYSTEM = `You are a Tamil lexicographer and prosody assistant helping a songwriter build a personal literary lexicon.

${LANGUAGE_POLICY}

${CLASSIFICATION_RULES}

Respond with ONLY valid JSON — no prose, no markdown fences.`;

/** The JSON shape asked of the model for a word entry. */
const ENTRY_FIELDS = `{
  "word": "<Tamil headword, ONE word>",
  "romanization": "<Latin>",
  "gloss": "<short English meaning>",
  "tamilMeaning": "<meaning written in Tamil>",
  "registers": ["<1-3 registers>"],
  "wordType": "<noun|verb|adjective|adverb|interjection|compound|poetic-compound|literary-term|proper-term|other>",
  "lexicalStatus": "<established|established-literary|historical|modern-compound|creative-poetic|uncertain>",
  "confidence": "<verified|high|medium|experimental>",
  "usage": "<fresh|normal|familiar|overused|avoid>",
  "themes": ["<theme>"],
  "moods": ["<mood>"],
  "synonyms": ["<Tamil>"],
  "relatedWords": ["<Tamil>"],
  "poeticUsage": "<one sentence, in Tamil, on how it works in a line>",
  "examples": ["<2-4 word original Tamil phrase>"]
}`;

export interface SuggestParams extends Partial<Omit<LexiconSuggestRequest, 'count'>> {
  count: number;
  /** Headwords already in the lexicon — the model is asked to avoid these. */
  avoid?: string[];
}

/**
 * Propose new lexicon entries.
 *
 * `relatedTo` is the interesting input: it asks for words from a SEMANTIC
 * FIELD, not words containing a substring. Given மழை the useful answers are
 * சாரல், தூறல், மண்வாசம், கார்முகில் — drizzle, wet earth, dark cloud — none of
 * which contain "மழை" at all, and none of which a substring search would ever
 * surface.
 */
export async function suggestLexiconWords({
  register,
  theme,
  wordType,
  usage,
  mood,
  relatedTo,
  count,
  avoid = [],
}: SuggestParams): Promise<LexiconWordInput[]> {
  const wants = [
    register && `register "${register}"`,
    wordType && `word type "${wordType}"`,
    theme && `theme "${theme}"`,
    mood && `mood "${mood}"`,
    usage && `songwriting freshness "${usage}"`,
  ].filter(Boolean);

  const anchor = relatedTo
    ? `\nAnchor them to the SEMANTIC FIELD of "${relatedTo}" — the imagery, causes, effects, sensations and companions of that idea, NOT words that merely contain its letters. ` +
      `For example, for மழை: drizzle, dark cloud, the scent of wet earth, coolness, longing.`
    : '';

  const prompt =
    `Propose ${count} Tamil words for use in song lyrics` +
    (wants.length ? ` matching: ${wants.join(', ')}.` : '.') +
    anchor +
    `\n\nReturn ONLY a JSON array. Each element: ${ENTRY_FIELDS}\n` +
    `Do NOT include any of these already-known words: ${avoid.length ? avoid.join(', ') : '(none)'}.`;

  const res = await generateText({ system: SYSTEM, prompt, maxTokens: 4000, temperature: 0.8 });
  if (!res.ok) return []; // suggestion is best-effort — a failed call yields no words, never throws
  return parseSuggestions(res.text, avoid, register);
}

/**
 * Extract the outermost JSON array/object from a model response, tolerating
 * markdown fences and surrounding prose.
 *
 * ⚠️ THE BRACKET TYPE IS DECIDED BY WHICHEVER OPENS FIRST, and that is not a
 * detail. Trying `[` before `{` looks harmless until the response is an OBJECT
 * containing an array: for `{"concepts":["மாலை"]}` the first `[` and the last
 * `]` bracket the INNER array, which parses cleanly — so the caller silently
 * receives `["மாலை"]` instead of the object, the schema rejects it, and the
 * lyric reader returns empty for a perfectly good answer.
 */
export function extractJson(raw: string): unknown {
  const cleaned = (raw ?? '').replace(/```json|```/gi, '').trim();

  const firstArray = cleaned.indexOf('[');
  const firstObject = cleaned.indexOf('{');
  if (firstArray === -1 && firstObject === -1) return null;

  const arrayOpensFirst = firstArray !== -1 && (firstObject === -1 || firstArray < firstObject);
  const ordered = arrayOpensFirst
    ? ([['[', ']'], ['{', '}']] as const)
    : ([['{', '}'], ['[', ']']] as const);

  for (const [open, close] of ordered) {
    const start = cleaned.indexOf(open);
    const end = cleaned.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* malformed for this bracket type — try the other */
      }
    }
  }
  return null;
}

/**
 * A phrase long enough to be a lyric rather than a usage example. Four words is
 * the documented limit; six is where we stop trusting it, leaving room for
 * short compounds without letting a whole line through.
 */
export function looksLikeVerse(phrase: string): boolean {
  return phrase.trim().split(/\s+/).length > 6 || /[\n।]/.test(phrase);
}

/**
 * Validate suggestions, drop invalid ones, dedupe by NFC headword.
 *
 * ⚠️ THE DOWNGRADE RULE. A model asked for beautiful Tamil will happily label a
 * coinage "sangam" — that is precisely the error that filled this table with
 * 1,046 false Sangam entries. So a historical register is only kept when the
 * model ALSO committed to a matching lexical status; otherwise the entry is
 * kept but the claim is softened to `literary` and its confidence lowered. We
 * lose nothing (the word is still suggested) and we stop laundering a guess
 * into a historical assertion.
 */
export function parseSuggestions(
  raw: string,
  avoid: string[] = [],
  requestedRegister?: string
): LexiconWordInput[] {
  const arr = extractJson(raw);
  if (!Array.isArray(arr)) return [];

  const seen = new Set(avoid.map((w) => normalizeWord(w)));
  const out: LexiconWordInput[] = [];

  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const candidate = { ...(item as Record<string, unknown>) };

    // Examples must stay examples.
    if (Array.isArray(candidate.examples)) {
      candidate.examples = candidate.examples.filter(
        (e): e is string => typeof e === 'string' && !looksLikeVerse(e)
      );
    }

    const parsed = lexiconWordInputSchema.safeParse(candidate);
    if (!parsed.success) continue;

    const entry = downgradeUnevidencedHistory(parsed.data, requestedRegister);
    const key = normalizeWord(entry.word);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * Soften a historical register the model did not back up with an attested
 * lexical status. Applied unless the admin explicitly ASKED for that register —
 * if Raj filters for "sangam", he wants the model's sangam candidates, and the
 * audit will still flag them as unreviewed.
 */
function downgradeUnevidencedHistory(entry: LexiconWordInput, requestedRegister?: string): LexiconWordInput {
  const registers = entry.registers;
  const claimsHistory = registers.some((r) => HISTORICAL_REGISTERS.includes(r));
  if (!claimsHistory) return entry;
  if (requestedRegister && HISTORICAL_REGISTERS.includes(requestedRegister as never)) return entry;

  const attested = entry.lexicalStatus === 'historical' || entry.lexicalStatus === 'established-literary';
  if (attested) return entry;

  const softened = registers.map((r) => (HISTORICAL_REGISTERS.includes(r) ? ('literary' as const) : r));
  return {
    ...entry,
    registers: [...new Set(softened)],
    register: softened[0],
    confidence: 'medium' as const,
  };
}
