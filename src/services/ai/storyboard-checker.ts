/**
 * Storyboard check — reads a story's characters, scenes and shots (and the
 * lyrics, when pasted) and lists what would waste a paid picture or clip:
 * a character drawn differently from shot to shot, a person in a prompt who
 * is not tagged (so Grok never sees their photo), shots too alike, prompts
 * that invite written words, a prompt fighting the story's style, and — with
 * lyrics — a scene that does not fit its words.
 *
 * Advice only: the result is a list for the owner to read. Nothing here edits
 * a shot. Same reliability model as the storyboarder: one forced tool call,
 * validated with zod, no SDK retries, hard-timed.
 *
 * Bundled into worker/compose-worker.ts by esbuild: keep Next.js out of here.
 */

import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { DEFAULT_MODEL } from './storyboarder';
import { CHECK_MAX_OUTPUT_TOKENS } from '@/services/video/cost';
import { CHECK_ISSUE_KINDS, type CheckIssue } from '@/types/visualStory';
import { MAX_CHECK_ISSUES, buildCheckMessage, keepKnownIssues, type CheckInput } from '@/lib/visual-story-check';

const TOOL_NAME = 'submit_check';


/** Fingerprint of what a check looked at; a changed storyboard gets a different one. */
export function storyboardHash(input: CheckInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

const issueSchema = z.object({
  kind: z.enum(CHECK_ISSUE_KINDS),
  sceneOrder: z.number().int().min(1),
  shotOrder: z.number().int().min(1).nullable().describe('null when the issue is about the whole scene.'),
  problem: z.string().trim().min(1).max(400).describe('What is wrong, in one or two plain sentences.'),
  suggestion: z.string().trim().min(1).max(400).describe('A concrete fix, e.g. a rewritten phrase for the prompt.'),
});

export const checkOutputSchema = z.object({
  summary: z.string().trim().min(1).max(600).describe('One to three sentences: overall, is this storyboard ready to generate?'),
  issues: z.array(issueSchema).max(MAX_CHECK_ISSUES),
});
export type CheckOutput = z.infer<typeof checkOutputSchema>;
const checkOutputJsonSchema = z.toJSONSchema(checkOutputSchema) as Record<string, unknown>;

export const CHECK_SYSTEM_PROMPT = `You review a music-video storyboard BEFORE any picture or clip is paid for, and report the problems by calling the ${TOOL_NAME} tool. Provide your entire answer as the tool's arguments — no prose.

Each shot's visualPrompt is sent to an image/video model on its own, with the story's style line added and the reference photos of the characters listed on that shot. The model sees nothing else: not the scene, not other shots, not the lyrics. Judge every prompt with that in mind.

Report only real problems that would waste a generation or break the video, most important first. Kinds:
- character: a character described differently between shots (age, clothing, hair, build) with no story reason; a person a prompt describes who is not in that shot's characters list (their photo will not be sent); a listed character the prompt never shows; a prompt that relies on a name alone where the model needs a visible description.
- lyrics: only when lyrics are given — a scene or shot that does not fit the words at that point. The lyrics run through the scenes in order; judge by order, not exact timing. Do not judge the lyrics themselves.
- repeat: shots back to back that would come out nearly the same picture.
- text: anything that invites written words, signs, captions, logos, numbers or watermarks in the frame.
- style: a prompt that fights the story's style line, or framing that does not suit the aspect ratio (9:16 is tall: close and medium framing; 16:9 is wide).
- other: real people or celebrities, political symbols or flags, or something image models handle badly in a way that matters here.

Rules:
- sceneOrder and shotOrder must be ones that exist in the storyboard; shotOrder null means the whole scene.
- Plain, simple English. The suggestion is concrete: a phrase to add, remove or replace in the prompt.
- Never comment on music, instruments or arrangement.
- If the storyboard is ready, say so in the summary and return an empty issues list. Do not invent problems or nitpick wording.
- At most ${MAX_CHECK_ISSUES} issues.`;

export type CheckErrorCode = 'not_configured' | 'auth' | 'billing' | 'rate_limit' | 'upstream' | 'bad_response';
type Usage = { inputTokens: number; outputTokens: number };

export type CheckResult =
  | { ok: true; summary: string; issues: CheckIssue[]; usage: Usage }
  // `usage` only when a response arrived (its tokens were billed).
  | { ok: false; code: CheckErrorCode; error: string; usage?: Usage };

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'dummy-key-for-build') return null;
  // One call per job: a retry would bill twice and could outrun the worker.
  return new Anthropic({ apiKey: key, maxRetries: 0 });
}

export async function checkStoryboard(
  input: CheckInput,
  opts: { lyrics?: string; timeoutMs: number }
): Promise<CheckResult> {
  const client = getClient();
  if (!client) return { ok: false, code: 'not_configured', error: 'AI is not configured (ANTHROPIC_API_KEY missing).' };

  const startedAt = Date.now();
  let res: Anthropic.Messages.Message;
  try {
    res = await client.messages.create(
      {
        model: DEFAULT_MODEL,
        max_tokens: CHECK_MAX_OUTPUT_TOKENS,
        system: CHECK_SYSTEM_PROMPT,
        tools: [
          {
            name: TOOL_NAME,
            description: 'Submit the storyboard check: a short summary and the list of problems.',
            input_schema: checkOutputJsonSchema as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: buildCheckMessage(input, opts.lyrics) }],
      },
      { timeout: opts.timeoutMs }
    );
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const detail = err instanceof Error ? err.message : String(err);
    // Status only: the message can echo the request, which may hold the lyrics.
    console.error(`[ai/storyboard-checker] Anthropic call failed (status=${status ?? 'n/a'}, ms=${Date.now() - startedAt})`);
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
        error: 'The Anthropic account is out of credit. Add credits in the Anthropic Console (Plans & Billing), then check again.',
      };
    }
    return { ok: false, code: 'upstream', error: 'The AI service failed to respond. Please try again.' };
  }

  const usage = { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 };
  console.info('[ai/storyboard-checker] complete', JSON.stringify({ ms: Date.now() - startedAt, ...usage, stopReason: res.stop_reason }));

  if (res.stop_reason === 'max_tokens') {
    return { ok: false, code: 'bad_response', error: 'The check ran out of room before it finished. Please try again.', usage };
  }
  const toolUse = res.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME
  );
  const parsed = toolUse ? checkOutputSchema.safeParse(toolUse.input) : null;
  if (!parsed?.success) {
    return { ok: false, code: 'bad_response', error: 'The AI returned an incomplete check. Please try again.', usage };
  }
  return { ok: true, summary: parsed.data.summary, issues: keepKnownIssues(input, parsed.data.issues), usage };
}
