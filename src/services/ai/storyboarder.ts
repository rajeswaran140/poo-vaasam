/**
 * Storyboard drafter — pasted lyrics + window length + aspect ratio →
 * characters, scenes and shots whose durations fill the window exactly.
 *
 * Same reliability model as the Lyricist: Claude tool use with a forced
 * `submit_storyboard` call, validated with the SAME zod schema, cancellable and
 * hard-timed. Models are poor at arithmetic, so after parsing a deterministic
 * tiling repair nudges small duration errors; large ones are refused.
 */

import Anthropic from '@anthropic-ai/sdk';
import { storyboardOutputSchema, storyboardOutputJsonSchema, type StoryboardOutput } from './storyboarderSchema';
import type { AspectRatio } from '@/types/visualStory';
import { draftMaxOutputTokens } from '@/services/video/cost';

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
const REQUEST_TIMEOUT_MS = 25_000;
const TOOL_NAME = 'submit_storyboard';
const MIN_SHOT_SEC = 1;
const MAX_SHOT_SEC = 15;

/** About one shot per 7 s of window: keeps a whole song's draft inside its output ceiling. */
export function targetShotCount(windowSec: number): number {
  return Math.max(1, Math.round(windowSec / 7));
}

export const SYSTEM_PROMPT = `You are a film storyboard artist. Given song lyrics, a window length in seconds and an aspect ratio, you design a visual storyboard by calling the ${TOOL_NAME} tool. Provide your entire answer as the tool's arguments — do not write any prose.

EVERY SONG IS ITS OWN WORLD:
- Draw imagery specific to THESE lyrics: their places, seasons, weather, objects and people. Reuse nothing generic.
- Avoid stock clichés (silhouette on a hill at sunset, hands releasing a bird, slow-motion rain on a window, generic city skylines) unless the lyrics themselves name them.
- Invent characters for this song only — never real people, celebrities or existing fictional characters. At most 6; describe each visually (age, build, clothing, distinguishing features) so they can be drawn consistently. Refer to them in shots by exactly the same name.

SHOTS:
- Use shots averaging about 7 seconds (5-10 s); a long window gets more shots, not longer ones. Aim for the shot count the request gives.
- Keep each visual prompt under 50 words: one clear picture, not a paragraph.
- Group shots into 1-12 scenes, each with a short heading and a one-or-two sentence summary, following the emotional arc of the lyrics.
- Each shot has an integer durationSec between 1 and 15, a mode (STILL by default; MOTION only where movement carries the moment; HERO sparingly for the single most important shot), a concrete visualPrompt describing what the camera sees, and the names of the characters present.
- The durations of ALL shots, across all scenes, MUST add up to exactly the window length in seconds. Check your arithmetic before answering.
- Compose every shot for the requested aspect ratio (9:16 is tall and vertical: stack subjects, favour close and medium framing; 16:9 is wide: use depth and horizontal composition).
- There must be no text, lettering, captions, signs with readable words, logos or watermarks in any frame — describe visuals only, never written words.
- Keep everything strictly APOLITICAL — no flags, no regions framed politically, no political movements, parties, or partisan references.`;

export type StoryboardErrorCode =
  | 'not_configured'
  | 'auth'
  | 'billing'
  | 'rate_limit'
  | 'upstream'
  | 'bad_response';

export type StoryboardResult =
  | { ok: true; data: StoryboardOutput; usage: { inputTokens: number; outputTokens: number } }
  // `usage` is present only when an Anthropic response was actually received
  // (so its tokens were billed): bad_response cases. Absent for unbilled failures.
  | {
      ok: false;
      code: StoryboardErrorCode;
      error: string;
      usage?: { inputTokens: number; outputTokens: number };
    };

export interface StoryboardRequest {
  lyrics: string;
  windowSec: number;
  aspectRatio: AspectRatio;
  /** The story's Style; '' or absent ⇒ none. */
  style?: string;
  signal?: AbortSignal;
}

const DOES_NOT_FIT = "The draft's shots did not fit the chosen length. Please draft again.";

export interface StoryboardOptions {
  /** Hard per-call timeout. The background worker passes 600 s (a whole song); the default suits an inline caller. */
  timeoutMs?: number;
}

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'dummy-key-for-build') return null;
  // maxRetries: 0 — a full storyboard takes ~45-65 s (measured 2026-11-04). The
  // SDK's default 2 retries turned one slow call into three billed attempts and
  // ~77 s; a retry also cannot fit the worker Lambda's budget. One call per job.
  return new Anthropic({ apiKey: key, maxRetries: 0 });
}

/**
 * Deterministic tiling repair. Adjusts shots from the last backwards, each kept
 * within 1-15 s, until the total equals windowSec. Returns false (data left
 * untouched) when |diff| > 15 or the shots cannot absorb the difference.
 */
function repairTiling(data: StoryboardOutput, windowSec: number): boolean {
  const shots = data.scenes.flatMap((s) => s.shots);
  let diff = windowSec - shots.reduce((n, s) => n + s.durationSec, 0);
  if (Math.abs(diff) > MAX_SHOT_SEC) return false;
  const next = shots.map((s) => s.durationSec);
  for (let i = next.length - 1; i >= 0 && diff !== 0; i--) {
    const target = Math.min(MAX_SHOT_SEC, Math.max(MIN_SHOT_SEC, next[i] + diff));
    diff -= target - next[i];
    next[i] = target;
  }
  if (diff !== 0) return false;
  shots.forEach((s, i) => {
    s.durationSec = next[i];
  });
  return true;
}

export async function generateStoryboard(
  req: StoryboardRequest,
  options: StoryboardOptions = {}
): Promise<StoryboardResult> {
  const { lyrics, windowSec, aspectRatio, signal } = req;
  const style = (req.style ?? '').trim();

  const client = getClient();
  if (!client) {
    return { ok: false, code: 'not_configured', error: 'AI is not configured (ANTHROPIC_API_KEY missing).' };
  }

  const userMessage = [
    `Window length: ${windowSec} seconds (shot durations must sum to exactly ${windowSec}).`,
    // Bounds the output: ~250 tokens a shot must fit draftMaxOutputTokens.
    `Aim for about ${targetShotCount(windowSec)} shots.`,
    `Aspect ratio: ${aspectRatio}`,
    // The style is appended to every picture and clip request by the studio,
    // so the prompts should suit it without spending tokens repeating it.
    ...(style
      ? [`Visual style for every shot: ${style}. Write each visualPrompt to suit this look; do not repeat the style words — they are added to every shot automatically.`]
      : []),
    '',
    'Lyrics:',
    lyrics,
  ].join('\n');

  const startedAt = Date.now();
  let res: Anthropic.Messages.Message;
  try {
    res = await client.messages.create(
      {
        model: DEFAULT_MODEL,
        // Shared with the reservation bound (draftReserveUsd), so the two cannot drift.
        max_tokens: draftMaxOutputTokens(windowSec),
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: TOOL_NAME,
            description: 'Submit the storyboard (characters, scenes and shots) for the lyrics.',
            input_schema: storyboardOutputJsonSchema as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: userMessage }],
      },
      { signal, timeout: options.timeoutMs ?? REQUEST_TIMEOUT_MS }
    );
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[ai/storyboarder] Anthropic call failed (status=${status ?? 'n/a'}, ms=${Date.now() - startedAt}):`, detail);

    if (status === 401 || status === 403) {
      return { ok: false, code: 'auth', error: 'The Claude API key is invalid, expired, or lacks access. Update ANTHROPIC_API_KEY.' };
    }
    if (status === 429) {
      return { ok: false, code: 'rate_limit', error: 'The AI service is rate-limited right now. Please retry in a moment.' };
    }
    if (status === 400 && /credit balance is too low/i.test(detail)) {
      return {
        ok: false,
        code: 'billing',
        error: 'The Anthropic account is out of credit. Add credits in the Anthropic Console (Plans & Billing), then generate again.',
      };
    }
    return { ok: false, code: 'upstream', error: 'The AI service failed to respond. Please try again.' };
  }

  const usage = { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 };
  console.info('[ai/storyboarder] complete', JSON.stringify({ model: DEFAULT_MODEL, ms: Date.now() - startedAt, ...usage, stopReason: res.stop_reason }));

  if (res.stop_reason === 'max_tokens') {
    return {
      ok: false,
      code: 'bad_response',
      error: 'The storyboard was too long to finish. Draft a shorter part of the song, or try once more.',
      usage,
    };
  }

  const toolUse = res.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME
  );
  if (!toolUse) {
    return { ok: false, code: 'bad_response', error: 'The AI returned an unexpected format. Please try again.', usage };
  }

  const parsed = storyboardOutputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    console.error('[ai/storyboarder] tool output failed schema validation:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return { ok: false, code: 'bad_response', error: 'The AI returned an incomplete storyboard. Please try again.', usage };
  }

  if (!repairTiling(parsed.data, windowSec)) {
    return { ok: false, code: 'bad_response', error: DOES_NOT_FIT, usage };
  }

  return { ok: true, data: parsed.data, usage };
}
