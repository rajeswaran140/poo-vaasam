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
 * Runs in the OFF-Amplify worker Lambda: a full-ballad critique is ~50-70s on
 * Sonnet, far over Amplify's ~30s SSR ceiling. The critique route enqueues a job
 * and the shared worker calls this; the form polls. Sonnet 4.6 (NOT 4.5) is
 * required — 4.5 mis-serialises the nested-array tool args (strengths/slackLines/
 * …) as <parameter>-wrapped strings that fail schema validation; 4.6 returns
 * clean arrays.
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildLyricProfile, profileGrounding } from "@/lib/lyric-profile";
import {
  lyricCritiqueInputSchema,
  lyricCritiqueOutputSchema,
  lyricCritiqueOutputJsonSchema,
  type LyricCritiqueInput,
  type LyricCritique,
} from "./lyricCriticSchema";

export type { LyricCritiqueInput, LyricCritique } from "./lyricCriticSchema";

// Sonnet 4.6 — REQUIRED: 4.5 mis-serialises the nested-array tool args as
// <parameter>-wrapped strings (→ schema-validation failure); 4.6 returns clean
// arrays. Empirically confirmed on a full Tamil ballad critique.
export const DEFAULT_MODEL = "claude-sonnet-4-6";
// A rich Tamil critique (strengths + observations + slack lines + word ideas +
// questions) is token-dense; match the Composer's 6000 ceiling for headroom.
const MAX_OUTPUT_TOKENS = 6000;
// Analytical feedback, not generation — keep it grounded, low drift.
const TEMPERATURE = 0.4;
// Runs in the worker Lambda (120s budget). A full-ballad critique is ~50-70s, so
// give a generous ceiling; getClient() disables retries so a near-timeout call
// can't double and blow the Lambda budget.
const REQUEST_TIMEOUT_MS = 110_000;

const TOOL_NAME = "submit_critique";

const SYSTEM_PROMPT = `You are a discerning Tamil poetry and lyric editor giving feedback to an EXPERIENCED Tamil poet with decades of craft. Provide your entire answer as the ${TOOL_NAME} tool's arguments — do not write any prose.

Your role is to help the poet see THEIR OWN work more clearly — a sparring partner, NOT a ghostwriter.

THE RULE THAT OVERRIDES THE OTHERS — WRITER INTENT.
Before you call anything weak, ask yourself: *is this actually wrong, or do I simply not yet understand why the poet chose it?* This poet has written Tamil for decades and bends grammar, register and imagery ON PURPOSE. Intentional ambiguity, colloquial forms and unusual word-pairings are craft, not error. When a line could be deliberate, classify it \`artistic_choice\` and — if its meaning genuinely turns on intent — ask via \`questionForWriter\` instead of downgrading it. A critic that sands the strangeness off a line has damaged the song.

Rules:
- Read in Tamil (தமிழ்). The draft is the poet's original work; treat it with respect and hold it to a high bar.
- Give FEEDBACK, never a rewrite. Do NOT supply replacement lines or rewrite the lyric. When you flag a line, QUOTE it verbatim and explain WHY — the poet decides what to do with it.
- **The MEASURED FACTS block is ground truth. Do not re-derive, dispute or re-count it.** எதுகை/மோனை/இயைபு families, repeated words, root motifs and the register signal are computed from the text, not guessed.
- ⚠️ **METRE IS THE ONE EXCEPTION — DO NOT TREAT LINE LENGTH AS A METRE READING.** An எழுத்து count is NOT Tamil metre. Tamil rhythm runs on அசை (நேர்/நிரை), சீர் and மாத்திரை; குறில்/நெடில், ஒற்று and diphthongs change a line's real weight without changing its count. So:
  · Compare lines to EACH OTHER in relative terms — "runs longer than the surrounding lines" — never as a verdict.
  · NEVER state a modal/target syllable number as the song's metre, and never quote per-line counts as if they settled the rhythm.
  · NEVER predict a melodic outcome ("the melody will rush", "this will not sing") from counts alone. Only the sung melody can settle that. If a rhythmic concern genuinely needs the tune to resolve it, set \`requiresMelodyValidation: true\` and say so plainly instead of asserting.
- ⚠️ **NO UNSUPPORTED LINGUISTIC OR HISTORICAL LABELS.** Do not date a word or assign it to a period or corpus — no "Sangam-register term", no "classical-era usage", no etymological claims. You are doing LITERARY criticism, not historical linguistics, and a confident period label is a claim you cannot support from the draft. Describe the EFFECT instead: "markedly literary register", "philosophical weight", "formal against the surrounding lines". That is both safer and more useful to the poet.
- INFER THE SONG'S OWN REGISTER FIRST, then judge deviation from it. A rural/colloquial song using \`உன்னோட\` or \`வரப்பில\` is consistent, not inconsistent. Only flag register when a form breaks the song's own established level.
- Read the lyric at THREE levels and say which you are working at: the LINE, the SECTION, and the WHOLE SONG. Long-range architecture matters — a motif answered many sections later, or a chain of images that develops across the song, is a structural strength that line-by-line reading misses entirely.
- ROOT MOTIFS are not mere repetition. When the facts show one root re-inflected across the song, treat it as a possible deliberate device and say what it is doing.
- Every slackLines entry MUST carry \`issueType\` and \`confidence\`. Reserve high confidence for things you can point at in the text; be honestly uncertain about intent.
- wordIdeas: alternatives to CONSIDER (a thesaurus, not an edit) — and every one MUST carry a \`tradeoff\` naming what the swap gains AND what it loses. If you cannot name the loss, do not offer the word.
- ⚠️ **FILTER YOUR OWN SUGGESTIONS. If the alternative would lose the line's central semantic function, DO NOT OFFER IT AT ALL.** Reasoning your way to "…but the body's hunger is the point, not a metaphor for it" and then presenting the swap anyway wastes the poet's attention. Quality over quantity: an EMPTY wordIdeas list is a perfectly good answer and often the right one.
- ORIGINALITY: separate a familiar IMAGE from a familiar EXPRESSION. குயில், மயில், தென்றல் are common nouns; an unusual combination of them is still original. Only call something cliché when the PHRASING is worn, not because the noun is well known. And cliché is not phrase-FREQUENCY: judge where the phrase sits, what precedes it, and how it closes the section — a familiar image in a new structural position can be the strongest line in the song.
- ⚠️ **A ONE-OFF IMAGE IS NOT AN INCONSISTENCY.** Uniqueness alone is no evidence of a tonal gap. When a song's grief is otherwise abstract, a single concrete household object can be exactly the anchor the listener remembers — that is craft, not drift. Never flag an image merely for appearing once.
- ⚠️ **NO CORPUS CLAIMS YOU CANNOT SUPPORT.** You have no corpus and no search. So never write "appears often in grief lyrics", "well-worn pairing", or any frequency claim about Tamil poetry at large. Say what you can actually stand behind: "belongs to a familiar semantic field", "reads idiomatic". If you still want to flag it, mark the confidence LOW and say the judgement is your impression.
- ⚠️ **SEPARATE WHAT THE TEXT SAYS FROM WHAT YOU INFER.** Use \`readingLevel\` on any interpretive observation: text_supported / strong_inference / possible_reading / speculative. A reading that is one of several possible must NEVER appear in \`overall\` phrased as the song's settled meaning — attribute it ("this can be read as…") or leave it out.
- ⚠️ **SOUND IS NOT ETYMOLOGY.** Never infer a shared root, derivation or word-family from phonetic similarity alone. அகம் and அகப்பை open with the same sound and share NO root. Say "a phonetic echo" or "an opening-sound correspondence" — never "share a root". If you cannot demonstrate the derivation from the words themselves, you do not know it.
- ⚠️ **USE TAMIL LITERARY TERMS ONLY WHEN THE DEFINITION ACTUALLY HOLDS.** அந்தாதி means the END of one unit begins the next. A set of words merely ending alike (யுகம் / முகம் / அகம்) is an END-RHYME CHAIN, not அந்தாதி. Do not reach for a classical term as ornament — a plain accurate description ("இறுதியொலி சங்கிலி", "rhyme chain") is better than an impressive wrong one. The same applies to எதுகை, மோனை, இயைபு, வெண்பா and every other term.
- ⚠️ **BEFORE offering ANY word alternative, list every job the original word is doing** — meaning, rhyme, எதுகை/மோனை/இயைபு, motif membership, register, line weight, imagery, structural role. **If the replacement improves one of those while damaging a stronger deliberate device, DO NOT OUTPUT IT.** Naming the trade-off is not enough; the weak suggestion must never reach the poet. Worked example: in சன்னல் / மின்னல் / இன்னல், swapping இன்னல் for துன்பம் buys a little plainness and destroys a three-word sound chain that is also a progression — object, then natural force, then human suffering. That suggestion should never have been written.
- ⚠️ **THEN ASK: IF THE POET CHANGES NOTHING HERE, WHAT ACTUALLY GOES WRONG?** If the honest answer is "nothing", say nothing. **Do not manufacture criticism to fill a section.** Empty strengths, empty slackLines, empty wordIdeas are all valid and often correct. A critic who finds something wrong in every section will, over enough passes, edit a good song into a flat one. Silence beats a weak note.
- ⚠️ **A QUESTION MUST CLARIFY THE POET'S MEANING, NOT SUPPLY ONE.** Ask "what did you intend by X here?" — do not invent a backstory and ask him to confirm it. "I never learned right from wrong without you?" puts words in his mouth; "அறிந்ததில்லை here carries more than one reading — check the one you meant is what reaches the listener" does not.
- questions: pose a few sharp questions that push the poet's own thinking.
- BE CONCISE — surface the most valuable few points, not an exhaustive audit. Keep each note to one or two sentences; at most ~5 strengths, ~6 slack lines, ~5 word ideas, ~4 questions. A tight, sharp critique is more useful (and faster) than a long one.
- Stay strictly APOLITICAL — no parties, movements, regions framed politically, or partisan references.`;

export type LyricCritiqueErrorCode =
  | "not_configured"
  | "invalid_input"
  | "auth"
  | "rate_limit"
  | "upstream"
  | "bad_response";

export type LyricCritiqueResult =
  | { ok: true; data: LyricCritique }
  | { ok: false; code: LyricCritiqueErrorCode; error: string };

export interface LyricCritiqueOptions {
  /** Override the model (e.g. Haiku as a faster fallback). */
  model?: string;
  /** Abort signal — cancels the upstream call on client disconnect / supersede. */
  signal?: AbortSignal;
  /**
   * The poet's personal lexicon as compact hint lines (see lexicon-hints.ts).
   * When present, the model is told to PREFER these words for wordIdeas — so the
   * suggested alternatives come from the poet's own vocabulary, not generic AI
   * synonyms. Server-provided (the route fetches it); never from the client.
   */
  lexicon?: string[];
}

/** Render the submitted draft into a compact instruction message for the model. */
export function buildCritiquePrompt(input: LyricCritiqueInput, lexicon?: string[]): string {
  // Grounding FIRST, then the lyric. The model reads the measurements, then the
  // poem — so by the time it forms an opinion about rhythm it already has the
  // syllable counts and cannot invent a different set.
  const profile = buildLyricProfile(input.lyrics);
  const lines = [
    ...profileGrounding(profile),
    "",
    "Here is the poet's own draft lyric to critique:",
    "",
    input.lyrics,
    "",
  ];
  if (input.focus.length)
    lines.push(
      `Weight your feedback toward these aspects: ${input.focus.join(", ")}.`,
    );
  if (input.notes) lines.push(`The poet's note: ${input.notes}`);
  if (lexicon && lexicon.length) {
    // ⚠️ THE OLD WORDING SAID "PREFER … wherever they genuinely fit" AND CAUSED
    // OVERFITTING. The critic began proposing the same lexicon word (உயிர்த்தமிழே)
    // against unrelated lines, in one run reaching for it twice in a single
    // critique. Left alone that narrows the poet's vocabulary toward whatever he
    // already recorded — the opposite of augmenting the craft. The lexicon is
    // evidence of VOICE, not a shortlist of replacements.
    lines.push(
      "",
      "For reference, words the poet has recorded in their own lexicon:",
      lexicon.join("\n"),
      "",
      "⚠️ This list is EVIDENCE OF THE POET'S VOICE, NOT a set of replacement candidates. Do NOT reach for a word merely because it appears here. Suggest one only when it is genuinely the best fit for that specific line, and NEVER propose the same lexicon word for more than one line in a single critique — repeating it is a sign you are pattern-matching on the list rather than reading the line.",
    );
  }
  return lines.join("\n");
}

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === "dummy-key-for-build") return null;
  // maxRetries: 0 — the critique call is long (~50-70s); the SDK's default
  // retries on a near-timeout call would exceed the 120s worker Lambda budget.
  return new Anthropic({ apiKey: key, maxRetries: 0 });
}

export async function critiqueLyric(
  input: unknown,
  options: LyricCritiqueOptions = {},
): Promise<LyricCritiqueResult> {
  const { model = DEFAULT_MODEL, signal, lexicon } = options;

  // Validate here too (defence in depth — the route also validates), so the
  // service is safe to call standalone and never sends junk upstream.
  const parseInput = lyricCritiqueInputSchema.safeParse(input);
  if (!parseInput.success) {
    return {
      ok: false,
      code: "invalid_input",
      error: parseInput.error.issues[0]?.message || "Invalid input",
    };
  }
  const draft = parseInput.data;

  const client = getClient();
  if (!client) {
    return {
      ok: false,
      code: "not_configured",
      error: "AI is not configured (ANTHROPIC_API_KEY missing).",
    };
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
            description:
              "Submit structured feedback on the poet's own draft lyric.",
            input_schema:
              lyricCritiqueOutputJsonSchema as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        // Force the model to answer via the tool — guarantees structured args.
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content: buildCritiquePrompt(draft, lexicon) }],
      },
      { signal, timeout: REQUEST_TIMEOUT_MS },
    );
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const detail = err instanceof Error ? err.message : String(err);
    console.error(
      `[ai/lyric-critic] Anthropic call failed (status=${status ?? "n/a"}, ms=${Date.now() - startedAt}):`,
      detail,
    );

    if (status === 401 || status === 403) {
      return {
        ok: false,
        code: "auth",
        error:
          "The Claude API key is invalid, expired, or lacks access. Update ANTHROPIC_API_KEY.",
      };
    }
    if (status === 429) {
      return {
        ok: false,
        code: "rate_limit",
        error:
          "The AI service is rate-limited right now. Please retry in a moment.",
      };
    }
    return {
      ok: false,
      code: "upstream",
      error: "The AI service failed to respond. Please try again.",
    };
  }

  const elapsedMs = Date.now() - startedAt;
  const outputTokens = res.usage?.output_tokens ?? 0;
  console.info(
    "[ai/lyric-critic] complete",
    JSON.stringify({
      model,
      ms: elapsedMs,
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens,
      stopReason: res.stop_reason,
    }),
  );

  if (res.stop_reason === "max_tokens") {
    console.error(
      `[ai/lyric-critic] response truncated at max_tokens (${outputTokens}/${MAX_OUTPUT_TOKENS})`,
    );
    return {
      ok: false,
      code: "bad_response",
      error: "The AI response was too long and got cut off. Please try again.",
    };
  }

  const toolUse = res.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === "tool_use" && block.name === TOOL_NAME,
  );
  if (!toolUse) {
    console.error(
      "[ai/lyric-critic] no tool_use block in response; stop_reason:",
      res.stop_reason,
    );
    return {
      ok: false,
      code: "bad_response",
      error: "The AI returned an unexpected format. Please try again.",
    };
  }

  const parsed = lyricCritiqueOutputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    console.error(
      "[ai/lyric-critic] tool output failed schema validation:",
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
    return {
      ok: false,
      code: "bad_response",
      error: "The AI returned an incomplete critique. Please try again.",
    };
  }

  return { ok: true, data: parsed.data };
}
