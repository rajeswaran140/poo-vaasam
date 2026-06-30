/**
 * AI-assisted lexicon seeding. Proposes Tamil word entries (headword, gloss,
 * register, themes) for the admin to review/curate — NOT an autonomous writer
 * and NEVER in a render path (explicit admin action only). Output is validated
 * against the same schema the manual-create endpoint uses, so a suggestion is
 * just a pre-filled create.
 */

import {
  lexiconWordInputSchema,
  normalizeWord,
  type LexiconWordInput,
  type LexiconRegister,
} from '@/types/lexicon';
import { generateText, isTextEngineConfigured } from '@/services/ai/text-engine';

export function isLexiconAiConfigured(): boolean {
  // Engine-selectable: Anthropic default, Gemini opt-in via AUX_AI_ENGINE.
  return isTextEngineConfigured();
}

interface SuggestParams {
  register: LexiconRegister;
  theme?: string;
  count: number;
  /** Headwords already in the lexicon — the model is asked to avoid these. */
  avoid?: string[];
}

const SYSTEM = `You are a Tamil lexicographer helping a songwriter build a personal lyric dictionary.
You suggest authentic Tamil words with accurate meanings, suitable for song lyrics.
Prefer evocative, singable words. Never invent words or fabricate meanings.
Respond with ONLY a JSON array — no prose, no markdown fences.`;

export async function suggestLexiconWords({
  register,
  theme,
  count,
  avoid = [],
}: SuggestParams): Promise<LexiconWordInput[]> {
  const prompt =
    `Propose ${count} Tamil "${register}"-register words` +
    (theme ? ` that evoke the theme "${theme}"` : '') +
    ` for use in song lyrics.\n` +
    `Return ONLY a JSON array. Each element: {"word": "<Tamil>", "romanization": "<Latin>", ` +
    `"gloss": "<short English meaning>", "register": "${register}", "themes": ${theme ? `["${theme}"]` : '[]'}, "usage": "fresh"}.\n` +
    `Do NOT include any of these already-known words: ${avoid.length ? avoid.join(', ') : '(none)'}.`;

  const res = await generateText({ system: SYSTEM, prompt, maxTokens: 2000, temperature: 0.8 });
  if (!res.ok) return []; // suggestion is best-effort — a failed call yields no words, never throws
  return parseSuggestions(res.text, register, avoid);
}

/**
 * Pure parser (unit-testable): extract the JSON array, validate each entry
 * against the create schema, drop invalid ones, and dedupe by NFC headword
 * (also against `avoid`). Tolerant of stray prose / code fences around the JSON.
 */
export function parseSuggestions(raw: string, register: string, avoid: string[] = []): LexiconWordInput[] {
  const cleaned = raw.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  let arr: unknown;
  try {
    arr = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const seen = new Set(avoid.map((w) => normalizeWord(w)));
  const out: LexiconWordInput[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    // The requested register is authoritative — a "suggest sangam" batch is all
    // sangam regardless of how the model labels each item.
    const withReg = { ...(item as Record<string, unknown>), register };
    const parsed = lexiconWordInputSchema.safeParse(withReg);
    if (!parsed.success) continue;
    const key = normalizeWord(parsed.data.word);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed.data);
  }
  return out;
}
