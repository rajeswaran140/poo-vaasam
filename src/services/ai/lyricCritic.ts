/**
 * AI Lyric Critic — turn a poet's own draft into structured FEEDBACK (draft →
 * critique). The augment-the-craft counterpart to lyricist.ts: it does not write
 * or rewrite lyrics, it helps an experienced Tamil poet see their own work more
 * clearly (meter, imagery, vocabulary, emotional arc, originality, structure).
 * See [[feedback_tamilagaval_ai_augments_craft]].
 *
 * Reliability model mirrors the Lyricist (the pattern that works):
 *  - Claude **tool use** with forced `tool_choice` → the model can only answer by
 *    calling `submit_critique` with arguments matching a JSON Schema (no markdown
 *    fences / prose preambles / malformed JSON).
 *  - The tool input is validated with the SAME Zod schema (lyricCriticSchema.ts
 *    is the single source of truth). Invalid output is a clean `bad_response`.
 *  - The call is cancellable (`signal`) and hard-timed.
 *
 * Runs INLINE on the Amplify route: critique is a single short call. NOTE: like
 * the Lyricist this shares the inline-timeout caveat (Amplify's ~30s ceiling) —
 * tracked as a follow-up to move both to the off-Amplify worker if needed.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  lyricCritiqueInputSchema,
  lyricCritiqueOutputSchema,
  lyricCritiqueOutputJsonSchema,
  type LyricCritiqueInput,
  type LyricCritique,
} from './lyricCriticSchema';

export type { LyricCritiqueInput, LyricCritique } from './lyricCriticSchema';

// Sonnet for the best Tamil/poetic nuance (matches the Lyricist / Composer).
export const DEFAULT_MODEL = 'claude-sonnet-4-5';
// Feedback is bounded prose over a song-length input; 4000 is ample headroom.
const MAX_OUTPUT_TOKENS = 4000;
// Analytical feedback, not generation — keep it grounded, low drift.
const TEMPERATURE = 0.4;
// Inline hard ceiling, kept under Amplify's ~30s execution limit.
const REQUEST_TIMEOUT_MS = 25_000;

const TOOL_NAME = 'submit_critique';

const SYSTEM_PROMPT = `You are a discerning Tamil poetry and lyric editor giving feedback to an EXPERIENCED Tamil poet with decades of craft. Provide your entire answer as the ${TOOL_NAME} tool's arguments — do not write any prose.

Your role is to help the poet see THEIR OWN work more clearly — a sparring partner, NOT a ghostwriter.

Rules:
- Read in Tamil (தமிழ்). The draft is the poet's original work; treat it with respect and hold it to a high bar.
- Give FEEDBACK, never a rewrite. Do NOT supply replacement lines or rewrite the lyric. When you flag a slack line, QUOTE it verbatim and explain WHY it weakens the song — the poet decides what to do with it.
- Be specific and honest: cite actual lines and words. Generic praise is useless; so is vague criticism.
- Cover meter/rhythm, imagery/concreteness, vocabulary (repetition, register), emotional arc, originality (cliché vs fresh), and structure — but ONLY where you genuinely have something to say. Empty sections are fine.
- wordIdeas: offer alternative Tamil words to CONSIDER (a thesaurus, not an edit). The poet chooses.
- questions: pose a few sharp questions that push the poet's own thinking.
- Stay strictly APOLITICAL — no parties, movements, regions framed politically, or partisan references.`;

export type LyricCritiqueErrorCode =
  | 'not_configured'
  | 'invalid_input'
  | 'auth'
  | 'rate_limit'
  | 'upstream'
  | 'bad_response';

export type LyricCritiqueResult =
  | { ok: true; data: LyricCritique }
  | { ok: false; code: LyricCritiqueErrorCode; error: string };

export interface LyricCritiqueOptions {
  /** Override the model (e.g. Haiku as a faster fallback). */
  model?: string;
  /** Abort signal — cancels the upstream call on client disconnect / supersede. */
  signal?: AbortSignal;
}

/** Render the submitted draft into a compact instruction message for the model. */
function buildCritiquePrompt(input: LyricCritiqueInput): string {
  const lines = ["Here is the poet's own draft lyric to critique:", '', input.lyrics, ''];
  if (input.focus.length) lines.push(`Weight your feedback toward these aspects: ${input.focus.join(', ')}.`);
  if (input.notes) lines.push(`The poet's note: ${input.notes}`);
  return lines.join('\n');
}

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'dummy-key-for-build') return null;
  return new Anthropic({ apiKey: key });
}

export async function critiqueLyric(
  input: unknown,
  options: LyricCritiqueOptions = {}
): Promise<LyricCritiqueResult> {
  const { model = DEFAULT_MODEL, signal } = options;

  // Validate here too (defence in depth — the route also validates), so the
  // service is safe to call standalone and never sends junk upstream.
  const parseInput = lyricCritiqueInputSchema.safeParse(input);
  if (!parseInput.success) {
    return {
      ok: false,
      code: 'invalid_input',
      error: parseInput.error.issues[0]?.message || 'Invalid input',
    };
  }
  const draft = parseInput.data;

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
            description: "Submit structured feedback on the poet's own draft lyric.",
            input_schema: lyricCritiqueOutputJsonSchema as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        // Force the model to answer via the tool — guarantees structured args.
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: buildCritiquePrompt(draft) }],
      },
      { signal, timeout: REQUEST_TIMEOUT_MS }
    );
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[ai/lyric-critic] Anthropic call failed (status=${status ?? 'n/a'}, ms=${Date.now() - startedAt}):`, detail);

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
  console.info('[ai/lyric-critic] complete', JSON.stringify({
    model,
    ms: elapsedMs,
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens,
    stopReason: res.stop_reason,
  }));

  if (res.stop_reason === 'max_tokens') {
    console.error(`[ai/lyric-critic] response truncated at max_tokens (${outputTokens}/${MAX_OUTPUT_TOKENS})`);
    return { ok: false, code: 'bad_response', error: 'The AI response was too long and got cut off. Please try again.' };
  }

  const toolUse = res.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME
  );
  if (!toolUse) {
    console.error('[ai/lyric-critic] no tool_use block in response; stop_reason:', res.stop_reason);
    return { ok: false, code: 'bad_response', error: 'The AI returned an unexpected format. Please try again.' };
  }

  const parsed = lyricCritiqueOutputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    console.error('[ai/lyric-critic] tool output failed schema validation:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return { ok: false, code: 'bad_response', error: 'The AI returned an incomplete critique. Please try again.' };
  }

  return { ok: true, data: parsed.data };
}
