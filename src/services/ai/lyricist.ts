/**
 * AI Lyricist — turn a creative brief into original Tamil song lyrics
 * (brief → lyrics). The inverse of composer.ts (lyrics → production brief); the
 * generated lyric is designed to flow straight INTO the Composer to close the
 * loop: brief → lyrics → production brief → SUNO → publish.
 *
 * Reliability model is identical to the Composer's (the pattern that works):
 *  - Claude **tool use** with a forced `tool_choice` → the model can only answer
 *    by calling `submit_lyrics` with arguments matching a JSON Schema (no
 *    markdown fences / prose preambles / malformed JSON).
 *  - The tool input is then validated with the SAME Zod schema
 *    (lyricistSchema.ts is the single source of truth). Invalid output is a
 *    clean `bad_response` — we never fabricate semantic fields.
 *  - The call is cancellable (`signal`) and hard-timed so a hung request can't
 *    keep a Lambda alive.
 *
 * Structure fidelity is best-effort: the system prompt asks for the exact shape,
 * and we deterministically enforce the UPPER bound (drop an unrequested
 * anupallavi, trim charanams beyond the requested count). We do NOT fabricate to
 * pad an under-produced section — an admin reviews every lyric before publish.
 *
 * Unlike the Composer this runs INLINE on the Amplify route: a lyric is a few
 * hundred output tokens (one short call, ~5-15s), comfortably under the ~30s
 * managed-compute ceiling — no worker Lambda needed.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  lyricBriefSchema,
  lyricsOutputSchema,
  lyricsOutputJsonSchema,
  type LyricBrief,
  type Lyrics,
} from './lyricistSchema';

export type { LyricBrief, Lyrics } from './lyricistSchema';

// Sonnet 4.6 — REQUIRED: the lyric schema has a doubly-nested array
// (charanams: string[][]), and 4.5 mis-serialises nested-array tool args as
// <parameter>-wrapped strings that fail schema validation (same reason the
// Composer and Lyric Critic run on 4.6). Do not downgrade.
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
// A full song (title + pallavi + anupallavi + up to 5 charanams) is pure Tamil
// script, which is token-dense — so we match the Composer's 6000 ceiling rather
// than risk truncating the largest legitimate briefs. Typical output is far
// smaller (a few hundred tokens) and completes well under the request timeout;
// this is only a safety ceiling. Hitting it → truncation, detected via
// stop_reason.
const MAX_OUTPUT_TOKENS = 6000;
// Higher than the Composer's 0.4 — this is generative/creative, not structured
// extraction, so we want lyrical variety while still steering by the brief.
const TEMPERATURE = 0.85;
// Inline hard ceiling, kept under Amplify's ~30s execution limit.
const REQUEST_TIMEOUT_MS = 25_000;

const TOOL_NAME = 'submit_lyrics';

const SYSTEM_PROMPT = `You are an expert Tamil songwriter and lyricist. Given a creative brief, you WRITE ORIGINAL Tamil song lyrics (பாடல்) by calling the ${TOOL_NAME} tool. Provide your entire answer as the tool's arguments — do not write any prose.

WRITE A SONG, NOT A STORY — this is the most important thing:
- A song circles ONE feeling through fresh images; it does NOT narrate a sequence of events. Never tell a timeline (avoid "in the morning… then you walked up… then we sat and talked…"). Do not let the charanams advance a plot from one to the next.
- Build a HOOK: the pallavi must carry a short, repeatable, hummable refrain — the emotional line the whole song keeps returning to. Echo a key word or phrase from the pallavi inside the anupallavi and charanams so the song comes home to it.
- Each charanam must re-approach the SAME emotional centre from a NEW angle or image — parallel, not sequential.
- Prefer present-tense immediacy and direct address (நீ / உன்) over past-tense recounting. Suggest and compress: one vivid image beats a full sentence of narration.

MAKE IT SOUND LIKE A SONG:
- Meter (சந்தம்): keep a steady, even beat — lines within a section should share a consistent syllable/beat count so they sit on a தாளம். Uneven, prose-length lines are not singable.
- Bind lines with Tamil sound devices — எதுகை (second-letter rhyme), மோனை (alliteration), இயைபு (end-rhyme). This is what makes it a பாடல் and not a paragraph.
- Leave room for gamaka (கமகம் — vocal ornamentation). The singer adds the ornament, but the WORD decides whether a note can be ornamented: place long/open vowels (நெடில் — ஆ, ஈ, ஊ, ஏ, ஓ) on the syllables meant to be held, especially at line and phrase endings where the voice glides. Avoid clipped consonant-cluster (மெய்) endings on those held notes — they cut the ornament short. Let the emotionally weighted word land on the sustained, ornamentable syllable.
- Keep lines short and roughly equal in length.

OTHER RULES:
- Write in Tamil script (தமிழ்), never transliteration.
- Honour the requested structure EXACTLY: always write a pallavi; include an anupallavi ONLY if requested; produce EXACTLY the requested number of charanams.
- Lead with the dominant emotion (first in the ranked list); let the remaining emotions colour the verses.
- Match the requested register (literary / village / sangam / modern / devotional) in word choice and imagery.
- If seed words are provided, weave them in ONLY where they fit naturally — never force all of them.
- title: an evocative Tamil phrase drawn from the lyric itself (ideally the hook), not a generic label.
- The lyrics MUST be original — do not reproduce existing film, folk, or devotional songs.
- Keep everything strictly APOLITICAL — no flags, no regions framed politically, no political movements, parties, or partisan references.`;

export type LyricGenErrorCode =
  | 'not_configured'
  | 'invalid_brief'
  | 'auth'
  | 'rate_limit'
  | 'upstream'
  | 'bad_response';

export type LyricGenResult =
  | { ok: true; data: Lyrics }
  | { ok: false; code: LyricGenErrorCode; error: string };

export interface LyricGenOptions {
  /** Override the model (e.g. Haiku as a faster fallback). */
  model?: string;
  /** Abort signal — cancels the upstream call on client disconnect / supersede. */
  signal?: AbortSignal;
}

/** Render the structured brief into a compact instruction message for the model. */
function buildBriefPrompt(b: LyricBrief): string {
  const lines = [
    `Theme: ${b.theme}`,
    `Emotions (ranked, most→least): ${b.emotions.join(', ')}`,
    `Register: ${b.register}`,
    `Structure: pallavi${b.structure.anupallavi ? ' + anupallavi' : ''} + ${b.structure.charanams} charanam(s)`,
  ];
  if (b.voice) lines.push(`Intended voice: ${b.voice}`);
  if (b.seedWords.length) lines.push(`Seed words to weave in where natural (do not force all): ${b.seedWords.join(', ')}`);
  if (b.titleHint) lines.push(`Title hint: ${b.titleHint}`);
  if (b.notes) lines.push(`Extra guidance: ${b.notes}`);
  return lines.join('\n');
}

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'dummy-key-for-build') return null;
  return new Anthropic({ apiKey: key });
}

export async function generateLyrics(
  briefInput: unknown,
  options: LyricGenOptions = {}
): Promise<LyricGenResult> {
  const { model = DEFAULT_MODEL, signal } = options;

  // Validate the brief here too (defence in depth — the route also validates),
  // so the service is safe to call standalone and never sends junk upstream.
  const briefParse = lyricBriefSchema.safeParse(briefInput);
  if (!briefParse.success) {
    return {
      ok: false,
      code: 'invalid_brief',
      error: briefParse.error.issues[0]?.message || 'Invalid brief',
    };
  }
  const brief = briefParse.data;

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
            description: 'Submit the original Tamil song lyrics for the given brief.',
            input_schema: lyricsOutputJsonSchema as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        // Force the model to answer via the tool — guarantees structured args.
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: buildBriefPrompt(brief) }],
      },
      { signal, timeout: REQUEST_TIMEOUT_MS }
    );
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[ai/lyricist] Anthropic call failed (status=${status ?? 'n/a'}, ms=${Date.now() - startedAt}):`, detail);

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
  console.info('[ai/lyricist] complete', JSON.stringify({
    model,
    ms: elapsedMs,
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens,
    stopReason: res.stop_reason,
  }));

  if (res.stop_reason === 'max_tokens') {
    console.error(`[ai/lyricist] response truncated at max_tokens (${outputTokens}/${MAX_OUTPUT_TOKENS})`);
    return { ok: false, code: 'bad_response', error: 'The AI response was too long and got cut off. Please try again.' };
  }

  const toolUse = res.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME
  );
  if (!toolUse) {
    console.error('[ai/lyricist] no tool_use block in response; stop_reason:', res.stop_reason);
    return { ok: false, code: 'bad_response', error: 'The AI returned an unexpected format. Please try again.' };
  }

  const parsed = lyricsOutputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    console.error('[ai/lyricist] tool output failed schema validation:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return { ok: false, code: 'bad_response', error: 'The AI returned an incomplete lyric. Please try again.' };
  }

  // Deterministic structure guards — the requested shape wins over model drift
  // on the upper bound (we never fabricate to pad an under-produced section):
  //  - drop an anupallavi the admin didn't ask for;
  //  - trim charanams beyond the requested count (the model can over-produce at
  //    this temperature; this also keeps output within the brief's 1-5 bound).
  const data: Lyrics = { ...parsed.data };
  if (!brief.structure.anupallavi) data.anupallavi = [];
  if (data.charanams.length > brief.structure.charanams) {
    data.charanams = data.charanams.slice(0, brief.structure.charanams);
  }

  return { ok: true, data };
}
