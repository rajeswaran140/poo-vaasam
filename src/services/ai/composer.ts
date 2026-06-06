/**
 * AI Composer — turn Tamil lyrics into a production-ready brief:
 * emotion / mood / theme / key / BPM / instrumentation + SUNO prompts +
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

import Anthropic from '@anthropic-ai/sdk';
import {
  composerAnalysisSchema,
  composerAnalysisJsonSchema,
  type ComposerAnalysis,
} from './composerSchema';
import { instrumentPalette, canonicalInstrumentNames } from '@/data/instruments';
import { ragaPalette, canonicalRagaNames } from '@/data/ragas';

// Re-export the schema-derived types so existing importers
// (`@/services/ai/composer`) keep working unchanged.
export type { ComposerAnalysis, SunoVariant, ReelIdea } from './composerSchema';

// Haiku 4.5 (~18s) is the default because it completes well inside Amplify's
// managed-CloudFront ~30s origin timeout EVEN IF the heartbeat stream is
// buffered rather than flushed (the buffering question was never confirmed —
// see HARDENING #131). Sonnet 4.6 (~33s, and longer now that the brief includes
// ragas + raga/instrument-named SUNO prompts) sits past that timeout and was
// returning HTTP 500/504 in prod. The brief's structured fields (instruments,
// ragas, schema) are catalog-grounded, so Haiku stays accurate where it counts;
// pass { model: 'claude-sonnet-4-6' } to opt back into Sonnet once compose runs
// as an async job (the durable fix).
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_LYRICS_CHARS = 8000;
// Headroom for the full Brief v2 (ranked emotions, 3-5 SUNO paragraphs,
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
- suggested_key: the Western key that best approximates the chosen lead raga (so it can be set in SUNO/DAWs).
- BPM: ballad 60-80, mid 90-120, upbeat 130-160.
- Titles: evocative Tamil phrases drawn from or inspired by the lyrics — not generic.
- suno_prompts: provide 3-5 DISTINCT style variants. Draw styles from: Traditional Tamil (Carnatic), Tamil film ballad, Devotional, Village folk, Modern acoustic, Bharathiyar-inspired. Each prompt is one self-contained English paragraph and must NOT contain the lyrics. In EACH prompt, explicitly name (a) the raga it is built on (use an exact name from the raga palette) and (b) the specific instruments it features (use exact names from the instrument palette), choosing instruments that suit that particular style variant.
- thumbnail_prompt: vivid, cinematic, culturally Tamil imagery matching the song's emotion. Describe scene/lighting/composition for a 16:9 YouTube thumbnail. Do not request embedded text.
- youtube_description_tamil and youtube_description_english convey the SAME meaning in each language; end each with 5-8 relevant hashtags including #tamilagaval.
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
  /** Override the model (e.g. Haiku as a faster fallback). */
  model?: string;
  /** Abort signal — cancels the upstream call on client disconnect / supersede. */
  signal?: AbortSignal;
}

/**
 * Guarantee a SUNO prompt explicitly names its raga + instruments. The prompt
 * rule asks the model to do this naturally per-variant; this is the safety net
 * that appends a concise production tag only when a paragraph omits them, so
 * the SUNO text never drifts vague or off-catalog.
 */
function threadPaletteIntoSuno(prompt: string, instruments: string[], ragas: string[]): string {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  const mentionsInstrument = instruments.some((i) => lower.includes(i.toLowerCase()));
  const mentionsRaga = ragas.some((r) => lower.includes(r.toLowerCase()));

  const parts: string[] = [];
  if (!mentionsInstrument && instruments.length) parts.push(`featuring ${instruments.slice(0, 3).join(', ')}`);
  if (!mentionsRaga && ragas.length) parts.push(`set in raga ${ragas[0]}`);
  if (!parts.length) return text;

  const tail = parts.join(', ');
  const sep = /[.!?]$/.test(text) ? ' ' : '. ';
  return `${text}${sep}${tail.charAt(0).toUpperCase()}${tail.slice(1)}.`;
}

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'dummy-key-for-build') return null;
  return new Anthropic({ apiKey: key });
}

export async function composeFromLyrics(
  lyricsInput: string,
  options: ComposeOptions = {}
): Promise<ComposeResult> {
  const { model = DEFAULT_MODEL, signal } = options;

  const lyrics = String(lyricsInput ?? '').trim();
  if (!lyrics) return { ok: false, code: 'upstream', error: 'Lyrics are required' };
  if (lyrics.length > MAX_LYRICS_CHARS) {
    return { ok: false, code: 'upstream', error: `Lyrics exceed ${MAX_LYRICS_CHARS} characters` };
  }

  const client = getClient();
  if (!client) {
    return { ok: false, code: 'not_configured', error: 'AI is not configured (ANTHROPIC_API_KEY missing).' };
  }

  const startedAt = Date.now();
  let res: Anthropic.Messages.Message;
  try {
    res = await client.messages.create(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: TEMPERATURE,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: TOOL_NAME,
            description: 'Submit the complete production brief for the given Tamil lyrics.',
            input_schema: composerAnalysisJsonSchema as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        // Force the model to answer via the tool — guarantees structured args.
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: lyrics }],
      },
      { signal, timeout: REQUEST_TIMEOUT_MS }
    );
  } catch (err) {
    // Log the FULL upstream detail server-side; return a clean, user-safe
    // message to the caller (no request_ids / raw JSON leakage).
    const status = (err as { status?: number })?.status;
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[ai/composer] Anthropic call failed (status=${status ?? 'n/a'}, ms=${Date.now() - startedAt}):`, detail);

    if (status === 401 || status === 403) {
      return { ok: false, code: 'auth', error: 'The Claude API key is invalid, expired, or lacks access. Update ANTHROPIC_API_KEY.' };
    }
    if (status === 429) {
      return { ok: false, code: 'rate_limit', error: 'The AI service is rate-limited right now. Please retry in a moment.' };
    }
    return { ok: false, code: 'upstream', error: 'The AI service failed to respond. Please try again.' };
  }

  const elapsedMs = Date.now() - startedAt;
  const outputTokens = res.usage?.output_tokens ?? 0;
  // Observability: one structured line per compose so CloudWatch metric filters
  // can track p95 latency + token spend, and surface truncation.
  console.info('[ai/composer] complete', JSON.stringify({
    model,
    ms: elapsedMs,
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens,
    stopReason: res.stop_reason,
  }));

  // A max_tokens stop means the tool arguments were cut off mid-JSON — surface
  // it as a distinct, actionable failure rather than a vague schema error.
  if (res.stop_reason === 'max_tokens') {
    console.error(`[ai/composer] response truncated at max_tokens (${outputTokens}/${MAX_OUTPUT_TOKENS})`);
    return { ok: false, code: 'bad_response', error: 'The AI response was too long and got cut off. Please try again.' };
  }

  const toolUse = res.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME
  );
  if (!toolUse) {
    console.error('[ai/composer] no tool_use block in response; stop_reason:', res.stop_reason);
    return { ok: false, code: 'bad_response', error: 'The AI returned an unexpected format. Please try again.' };
  }

  const parsed = composerAnalysisSchema.safeParse(toolUse.input);
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

  const data: ComposerAnalysis = {
    ...parsed.data,
    suggested_instruments: finalInstruments,
    suggested_ragas: finalRagas,
    // Ensure each SUNO style paragraph explicitly names its raga + instruments.
    suno_prompts: parsed.data.suno_prompts.map((v) => ({
      ...v,
      prompt: threadPaletteIntoSuno(v.prompt, finalInstruments, finalRagas),
    })),
  };

  return { ok: true, data };
}
