/**
 * AI Composer — turn Tamil lyrics into a production-ready brief:
 * emotion / mood / theme / key / BPM / instrumentation + style prompts +
 * bilingual YouTube descriptions + thumbnail + reel. Powers /admin/compose.
 *
 * Reliability model (was: "ask for JSON, hope, then defensively scrape"):
 *  - We use Claude **tool use** with a forced `tool_choice`, so the model can
 *    only answer by calling `submit_brief` with arguments that match a JSON
 *    Schema. That eliminates markdown fences, prose preambles, and most
 *    malformed-JSON failures at the source.
 *  - The tool's input is then validated with the SAME Zod schema (the schema is
 *    the single source of truth — see composerSchema.ts). Invalid output is a
 *    clean `bad_response`; we never silently fabricate semantic fields (e.g.
 *    inventing காதல்) and persist them as a "source of truth".
 *  - The Anthropic call is cancellable (`signal`) so an abandoned/superseded
 *    request stops billing instead of running to completion server-side.
 */

import {
  composerAnalysisSchema,
  composerAnalysisJsonSchema,
  type ComposerAnalysis,
} from './composerSchema';
import { getEngine, DEFAULT_ANTHROPIC_MODEL, type BriefRequest } from './engines';
import { instrumentPalette, canonicalInstrumentNames } from '@/data/instruments';
import { ragaPalette, canonicalRagaNames, checkKeyRagaConsistency } from '@/data/ragas';

// Re-export the schema-derived types so existing importers
// (`@/services/ai/composer`) keep working unchanged.
export type { ComposerAnalysis, SunoVariant, ReelIdea } from './composerSchema';

// The brief takes ~33s, exceeding Amplify's managed-compute ~30s execution
// ceiling (a probe confirmed even `after()` background work is dropped there —
// see HARDENING), so compose runs OFF the Amplify SSR Lambda: the
// /api/admin/compose route enqueues a job and a dedicated worker Lambda
// (tamilagaval-compose-worker, 120s timeout) runs THIS `composeFromLyrics` and
// writes the brief to DynamoDB for the client to poll. The worker bundles this
// exact module, so grounding/threading stay identical.
//
// The model call itself is delegated to a pluggable engine (see ./engines):
// Anthropic (current-gen Sonnet 4.6, the default) or Gemini Flash. This module
// owns the engine-independent pipeline — system prompt, schema validation,
// palette grounding, SUNO threading — so every engine produces the same brief.
// Re-exported as the brief's "model produced by" stamp (BriefRepository).
export const DEFAULT_MODEL = DEFAULT_ANTHROPIC_MODEL;
const MAX_LYRICS_CHARS = 8000;
// Headroom for the full Brief v2 (ranked emotions, 3-5 style paragraphs,
// BILINGUAL YouTube descriptions, thumbnail prompt, reel). Tamil is token-dense,
// so we keep comfortable margin; if output_tokens ever lands at this ceiling the
// JSON truncates → bad_response, which we now detect explicitly (stop_reason).
const MAX_OUTPUT_TOKENS = 6000;
// Lower than the API default (1.0): this is structured extraction, so we want
// steadier JSON and tighter adherence to rules (ranked-only, apolitical) over
// creative variance.
const TEMPERATURE = 0.4;
// Hard server-side ceiling on the upstream call so a hung Anthropic request
// can't keep a Lambda (and the heartbeat) alive indefinitely.
const REQUEST_TIMEOUT_MS = 60_000;

const TOOL_NAME = 'submit_brief';

// The instrument + raga palettes are injected so the model can only choose from
// our curated Indian & Sri Lankan catalogs (see src/data/*). Output is also
// validated against the catalogs after the call, so the brief never names an
// instrument or raga that doesn't exist.
const SYSTEM_PROMPT = `You are an AI music director for a Tamil songwriter and lyricist. Given Tamil song lyrics, you analyse them and produce a complete production brief by calling the ${TOOL_NAME} tool. Provide your entire answer as the tool's arguments — do not write any prose.

Rules:
- emotion = the single dominant emotion; emotion_breakdown = 3-5 emotions RANKED most→least present. Ranking only — DO NOT output numbers, percentages, or scores anywhere.
- suggested_instruments: 4-6 items, lead first. Choose ONLY from this palette of Indian & Sri Lankan instruments, using the EXACT names — do not invent or substitute (no generic "Strings"/"Percussion", no Western instruments):
${instrumentPalette()}
- suggested_ragas: 2-4 ragas, ranked best-fit first. Choose ONLY from this raga palette, using the EXACT names. Match each raga's rasa (in parentheses) to the song's dominant emotion:
${ragaPalette()}
- recommended_voice: 2-4 ranked, best fit first. Choose from: Male Baritone, Male Tenor, Female Adult, Young Female, Elder Male, Child, Duet.
- suggested_key: the Western key that best approximates the chosen lead raga (so it can be set in music-generator/DAWs).
- BPM: ballad 60-80, mid 90-120, upbeat 130-160.
- Titles: evocative Tamil phrases drawn from or inspired by the lyrics — not generic.
- suno_prompts: provide 3-5 DISTINCT style variants. Draw styles from: Traditional Tamil (Carnatic), Tamil film ballad, Devotional, Village folk, Modern acoustic, Bharathiyar-inspired. Each prompt is one self-contained English paragraph and must NOT contain the lyrics. In EACH prompt, explicitly name (a) the raga it is built on (use an exact name from the raga palette) and (b) the specific instruments it features (use exact names from the instrument palette), choosing instruments that suit that particular style variant.
- thumbnail_prompt: vivid, cinematic, culturally Tamil imagery matching the song's emotion. Describe scene/lighting/composition for a 16:9 YouTube thumbnail. Do not request embedded text.
- youtube_description_tamil and youtube_description_english convey the SAME meaning in each language; end each with 5-8 relevant hashtags including #tamilagaval.
- Do NOT add any credit, attribution, copyright, subscribe, or link lines to the descriptions (e.g. "Lyrics:", "Music composition", "100% original", writer's name, "Subscribe", playlist/URLs). Those are appended from a fixed template downstream. Write only the song's evocative description + hashtags.
- Keep ALL copy and imagery strictly apolitical — no flags, political movements, parties, or partisan references.`;

/**
 * Error classification so the API route can map failures to the right HTTP
 * status and a clean, user-safe message — without leaking raw upstream JSON
 * (status codes, request_ids) to the admin UI.
 *  - not_configured: key missing / placeholder
 *  - auth:           key present but rejected (invalid / expired / revoked)
 *  - rate_limit:     429 from Anthropic
 *  - upstream:       any other API / network failure (incl. abort/timeout)
 *  - bad_response:   call succeeded but the model output didn't match the schema
 */
export type ComposeErrorCode =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'upstream'
  | 'bad_response';

export type ComposeResult =
  | { ok: true; data: ComposerAnalysis }
  | { ok: false; code: ComposeErrorCode; error: string };

export interface ComposeOptions {
  /** Override the engine's model (e.g. Haiku as a faster Anthropic fallback). */
  model?: string;
  /** Engine to use ('anthropic' | 'gemini'). Defaults to COMPOSER_ENGINE / 'anthropic'. */
  engine?: string;
  /** Abort signal — cancels the upstream call on client disconnect / supersede. */
  signal?: AbortSignal;
}

/**
 * Guarantee a style prompt explicitly names its raga + instruments. The prompt
 * rule asks the model to do this naturally per-variant; this is the safety net
 * that appends a concise production tag only when a paragraph omits them, so
 * the the generator text never drifts vague or off-catalog.
 */
function threadPaletteIntoSuno(prompt: string, instruments: string[], ragas: string[], keyScale: string): string {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  const mentionsInstrument = instruments.some((i) => lower.includes(i.toLowerCase()));
  const mentionsRaga = ragas.some((r) => lower.includes(r.toLowerCase()));

  // Key/scale is its own clause so it threads in even when the model already
  // named the raga; skip it only if the scale descriptor is already present.
  const scaleNeedle = keyScale.toLowerCase().replace(/^[a-g][#b]?\s*/, '');
  const mentionsScale = !!keyScale && (lower.includes(keyScale.toLowerCase()) || (!!scaleNeedle && lower.includes(scaleNeedle)));

  const parts: string[] = [];
  if (!mentionsInstrument && instruments.length) parts.push(`featuring ${instruments.slice(0, 3).join(', ')}`);
  if (!mentionsRaga && ragas.length) parts.push(`in raga ${ragas[0]}`);
  if (!mentionsScale && keyScale) parts.push(`in the key of ${keyScale}`);
  if (!parts.length) return text;

  const tail = parts.join(', ');
  const sep = /[.!?]$/.test(text) ? ' ' : '. ';
  return `${text}${sep}${tail.charAt(0).toUpperCase()}${tail.slice(1)}.`;
}

/**
 * Assemble the engine-agnostic BriefRequest (system prompt + JSON Schema +
 * tuning) for a set of lyrics. Shared by the production path and the offline
 * engine benchmark so both feed engines an identical request.
 */
export function buildBriefRequest(lyrics: string, signal?: AbortSignal): BriefRequest {
  return {
    system: SYSTEM_PROMPT,
    lyrics,
    jsonSchema: composerAnalysisJsonSchema,
    toolName: TOOL_NAME,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: TEMPERATURE,
    timeoutMs: REQUEST_TIMEOUT_MS,
    signal,
  };
}

export async function composeFromLyrics(
  lyricsInput: string,
  options: ComposeOptions = {}
): Promise<ComposeResult> {
  const { model, engine: engineId, signal } = options;

  const lyrics = String(lyricsInput ?? '').trim();
  if (!lyrics) return { ok: false, code: 'upstream', error: 'Lyrics are required' };
  if (lyrics.length > MAX_LYRICS_CHARS) {
    return { ok: false, code: 'upstream', error: `Lyrics exceed ${MAX_LYRICS_CHARS} characters` };
  }

  // Select the engine (Anthropic default). An unknown id is a caller error, not
  // an outage — map it to a clean upstream failure rather than throwing.
  let engine;
  try {
    engine = getEngine(engineId, model);
  } catch (err) {
    console.error('[ai/composer] engine selection failed:', err instanceof Error ? err.message : String(err));
    return { ok: false, code: 'upstream', error: 'The AI service is misconfigured. Please try again.' };
  }

  const startedAt = Date.now();
  const result = await engine.generateBrief(buildBriefRequest(lyrics, signal));

  // Transport / shape failures already carry the right code (the engine error
  // taxonomy matches ComposeErrorCode 1:1) — pass them straight through.
  if (!result.ok) {
    return { ok: false, code: result.code, error: result.error };
  }

  const elapsedMs = Date.now() - startedAt;
  // Observability: one structured line per compose so CloudWatch metric filters
  // can track p95 latency + token spend per engine, and surface truncation.
  console.info('[ai/composer] complete', JSON.stringify({
    engine: engine.id,
    model: engine.model,
    ms: elapsedMs,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    stopReason: result.stopReason,
  }));

  const parsed = composerAnalysisSchema.safeParse(result.raw);
  if (!parsed.success) {
    // Validation failure = a genuinely incomplete/degraded brief. We do NOT
    // fabricate defaults for semantic fields and pass it off as a real brief.
    console.error('[ai/composer] tool output failed schema validation:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return { ok: false, code: 'bad_response', error: 'The AI returned an incomplete brief. Please try again.' };
  }

  // Ground the instrument & raga lists against the curated India/Sri Lanka
  // catalogs: canonicalise spellings and DROP anything not in a catalog, so the
  // brief only ever names real instruments/ragas. If grounding would empty a
  // list (model went fully off-palette), keep the model's originals rather than
  // return zero — the prompt makes this rare; we log it for visibility.
  const groundedInstruments = canonicalInstrumentNames(parsed.data.suggested_instruments);
  const groundedRagas = canonicalRagaNames(parsed.data.suggested_ragas);
  if (groundedInstruments.length < parsed.data.suggested_instruments.length || groundedRagas.length < parsed.data.suggested_ragas.length) {
    console.info('[ai/composer] grounded palette', JSON.stringify({
      instrumentsIn: parsed.data.suggested_instruments.length,
      instrumentsKept: groundedInstruments.length,
      ragasIn: parsed.data.suggested_ragas.length,
      ragasKept: groundedRagas.length,
    }));
  }

  const finalInstruments = groundedInstruments.length ? groundedInstruments : parsed.data.suggested_instruments;
  const finalRagas = groundedRagas.length ? groundedRagas : parsed.data.suggested_ragas;
  // Raga/scale compatibility guard: reconcile the model's suggested_key against
  // the lead raga's scale (e.g. a Dorian key under the major-pentatonic Mohanam
  // is a genuine tonal conflict). Produces the DAW-friendly key threaded below,
  // plus a note we surface so a corrected contradiction is never silent.
  const keyConsistency = checkKeyRagaConsistency(parsed.data.suggested_key, finalRagas[0]);
  const keyScale = keyConsistency.reconciledKey;
  if (keyConsistency.note) {
    console.info('[ai/composer] tonal-consistency', JSON.stringify({ note: keyConsistency.note }));
  }

  const data: ComposerAnalysis = {
    ...parsed.data,
    suggested_instruments: finalInstruments,
    suggested_ragas: finalRagas,
    suggested_key: keyScale,
    // Ensure each style paragraph explicitly names its raga + instruments + key/scale.
    suno_prompts: parsed.data.suno_prompts.map((v) => ({
      ...v,
      prompt: threadPaletteIntoSuno(v.prompt, finalInstruments, finalRagas, keyScale),
    })),
    musical_consistency: keyConsistency.note ? [keyConsistency.note] : [],
  };

  return { ok: true, data };
}
