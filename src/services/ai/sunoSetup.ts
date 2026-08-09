/**
 * SUNO setup generator — a finished lyric becomes a pasteable generation.
 *
 * This replaces a manual step: today the lyric goes into a general chat
 * assistant to be broken into sections and dressed with a style string. That
 * works, but it is untracked, inconsistent between songs, and the result is
 * pasted without anything checking it against the generator's actual rules.
 *
 * Same reliability model as the lyricist and composer: Claude tool use with a
 * forced `tool_choice`, so the model can only answer as structured arguments —
 * no prose parsing. Output is then run through `checkSetup`, which owns every
 * rule; this module must never re-implement a check, or the two will drift and
 * the caller will not know which one lied.
 *
 * TEMPERATURE IS LOW HERE, unlike the lyricist. Arranging a lyric into sections
 * and naming instrumentation is a craft judgement, not an act of invention —
 * the creativity already happened in the words. A high temperature produces
 * arrangements that differ run to run for no reason, which makes the tool
 * impossible to trust or compare against itself.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  sunoSetupInputSchema,
  sunoSetupOutputSchema,
  type SunoSetupInput,
  type SunoSetupOutput,
} from '@/services/ai/sunoSetupSchema';
import { checkSetup, isReady, EXCLUDE_MAX, STYLE_TARGET_MIN, STYLE_TARGET_MAX, type SetupFinding } from '@/lib/suno-setup';
import { PROMPT_LIMITS } from '@/lib/prompt-preflight';

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_OUTPUT_TOKENS = 8000;
/** Low: arrangement should be reproducible, not surprising. See header. */
const TEMPERATURE = 0.3;
const REQUEST_TIMEOUT_MS = 120_000;
const TOOL_NAME = 'submit_suno_setup';

let cached: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  cached = apiKey && apiKey !== 'dummy-key-for-build' ? new Anthropic({ apiKey }) : null;
  return cached;
}

export function isSunoSetupConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'dummy-key-for-build');
}

const SYSTEM_PROMPT = `You are a Tamil music arranger preparing a finished lyric for an AI music generator. You produce the exact four inputs the generator takes, by calling the ${TOOL_NAME} tool. Provide your entire answer as the tool's arguments — do not write any prose.

THE LYRICS BLOCK — this is an ARRANGEMENT, not a reformat:
- Reproduce the poet's Tamil lines EXACTLY. Never reword, translate, add, remove or reorder a lyric line. You are placing markers around words that are already finished.
- Put a section tag on its OWN line, in the form [Kind - Detail]:
  · sung sections name the VOICE — e.g. [Chorus - Male Lead], [Verse - Female Lead], [Chorus - Male and Female Together]
  · instrumental sections name the INSTRUMENT doing the work — e.g. [Break - Flute Phrase], [Interlude - Solo Violin], [Break - Full Band Lift]
- Kinds available: Intro, Verse, Chorus, Bridge, Break, Interlude, Outro.
- Open with an instrumental Intro and close with an instrumental Outro.
- Place instrumental breaks BETWEEN sung sections so the song breathes. A real arrangement is roughly half instrumental tags; do not simply tag the verses and stop.
- EVERY instrument you name in a break MUST be one of the instruments given for this variant. Never introduce an instrument the style prompt does not carry — the generator receives both and cannot reconcile them.
- If the lyric has a repeating chorus, vary WHO sings it across repeats when more than one voice is available; that is what makes a duet a duet.

THE STYLE BOX:
- Comma-separated descriptors, NOT sentences. Group them with " | " in this order: genre/era/tempo | vocals | instruments | production | mood | performance.
- Front-load genre and lead vocal — later text carries less weight.
- Include the BPM and the time feel in the first group.
- Aim for ${STYLE_TARGET_MIN}-${STYLE_TARGET_MAX} characters. Hard limit ${PROMPT_LIMITS.STYLE_MAX}. Under ${STYLE_TARGET_MIN} leaves the arrangement to chance; most people under-fill this box.
- NEVER put the lyrics in it. NEVER write a negative in it ("no synth", "avoid drums") — negatives belong in the exclude field only.

EXCLUDE:
- At most ${EXCLUDE_MAX} items. Negatives are attention-priced exactly like positives; a long list dilutes every item in it.
- Exclude only what genuinely threatens THIS song, and only where the style prompt already names a positive replacement. Never exclude something the style prompt asks for.
- If nothing genuinely threatens the song, return an empty list. An empty exclude is a valid and common answer.

SLIDERS:
- weirdness: 0-100, 50 is the generator's normal. Lower for a conventional, polished idiom; higher only when the song genuinely wants the unexpected.
- style_influence: 0-100, how strictly the style prompt is followed. Go HIGH (75-95) when the style prompt is dense and specific about voices and instruments — that detail is the thing worth enforcing. Go lower only when the lyric, not the arrangement, should drive the feel.
- slider_rationale: one line saying why these two values, so the choice can be argued with.

Keep everything strictly apolitical.`;

const outputJsonSchema = z.toJSONSchema(sunoSetupOutputSchema);

export type SunoSetupErrorCode =
  | 'not_configured'
  | 'invalid_input'
  | 'auth'
  | 'rate_limit'
  | 'upstream'
  | 'bad_response';

export interface SunoSetupSuccess {
  ok: true;
  data: SunoSetupOutput;
  /** Deterministic checks on what the model returned. */
  findings: SetupFinding[];
  /** False when a finding would waste a credit. */
  ready: boolean;
}

export type SunoSetupResult = SunoSetupSuccess | { ok: false; code: SunoSetupErrorCode; error: string };

function buildUserPrompt(i: SunoSetupInput): string {
  const lines = [
    `STYLE VARIANT: ${i.style}`,
    i.styleBrief ? `BRIEF: ${i.styleBrief}` : '',
    i.instruments.length ? `INSTRUMENTS AVAILABLE (breaks must use only these): ${i.instruments.join(', ')}` : '',
    i.voices.length ? `VOICES AVAILABLE: ${i.voices.join(', ')}` : '',
    i.ragas.length ? `RAGAS: ${i.ragas.join(', ')}` : '',
    i.bpm ? `BPM: ${i.bpm}` : '',
    i.key ? `KEY: ${i.key}` : '',
    i.mood ? `MOOD: ${i.mood}` : '',
    i.notes ? `NOTES: ${i.notes}` : '',
    '',
    'LYRIC (reproduce these lines exactly, adding only section tags):',
    i.lyrics,
  ];
  return lines.filter(Boolean).join('\n');
}

export interface GenerateOptions {
  model?: string;
  signal?: AbortSignal;
}

export async function generateSunoSetup(
  input: unknown,
  options: GenerateOptions = {}
): Promise<SunoSetupResult> {
  const parsed = sunoSetupInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input', error: parsed.error.issues[0]?.message || 'Invalid input' };
  }
  const client = getClient();
  if (!client) {
    return { ok: false, code: 'not_configured', error: 'AI is not configured (ANTHROPIC_API_KEY missing).' };
  }

  let res: Anthropic.Messages.Message;
  try {
    res = await client.messages.create(
      {
        model: options.model ?? DEFAULT_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: TEMPERATURE,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: TOOL_NAME,
            description: 'Submit the four generator inputs for this lyric and style variant.',
            input_schema: outputJsonSchema as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: buildUserPrompt(parsed.data) }],
      },
      { signal: options.signal, timeout: REQUEST_TIMEOUT_MS }
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) return { ok: false, code: 'auth', error: 'AI credentials rejected.' };
    if (status === 429) return { ok: false, code: 'rate_limit', error: 'AI rate limit reached — try again shortly.' };
    return { ok: false, code: 'upstream', error: 'The AI service did not respond.' };
  }

  if (res.stop_reason === 'max_tokens') {
    // A truncated arrangement loses the tail of the song silently — the block
    // would look complete and simply end early.
    console.error('[ai/sunoSetup] response truncated at max_tokens');
    return { ok: false, code: 'bad_response', error: 'The arrangement was cut short — try a shorter lyric.' };
  }

  const block = res.content.find((c): c is Anthropic.Messages.ToolUseBlock => c.type === 'tool_use');
  if (!block) return { ok: false, code: 'bad_response', error: 'The AI did not return a structured setup.' };

  const out = sunoSetupOutputSchema.safeParse(block.input);
  if (!out.success) {
    return { ok: false, code: 'bad_response', error: 'The AI returned a setup in an unexpected shape.' };
  }

  // Every rule lives in checkSetup. Findings are RETURNED, not thrown: a
  // warning is information for the writer, and even an error is worth showing
  // beside the output so it can be fixed by hand rather than regenerated blind.
  const findings = checkSetup({
    lyricsBlock: out.data.lyrics_block,
    style: out.data.style,
    weirdness: out.data.weirdness,
    styleInfluence: out.data.style_influence,
    exclude: out.data.exclude,
  });

  return { ok: true, data: out.data, findings, ready: isReady(findings) };
}
