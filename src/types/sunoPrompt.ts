/**
 * A saved SUNO prompt — the arrangement pack for one lyric, kept so it can be
 * reopened, copied and reused instead of being regenerated.
 *
 * WHY THIS EXISTS: the setup the compose flow produces lives only inside a
 * SunoSetupJob result. It is handed to the export pack and then lost — close the
 * page and the style box, exclude list and slider values are gone. This is the
 * durable record of that pack.
 *
 * ⚠️ AUDIO INFLUENCE IS CONDITIONAL, NOT A THIRD SLIDER. Suno only shows the
 * Audio Influence control "if you're using an Audio Upload"
 * (help.suno.com/en/articles/6141377). Weirdness and Style Influence are always
 * present in Custom mode; Audio Influence is not. So a lyrics-only prompt must
 * not carry an audioInfluence value — it would be a number with no control to
 * put it in. The schema below enforces that rather than trusting the UI.
 *
 * Unlike weirdness/styleInfluence, audioInfluence is NOT produced by the model:
 * sunoSetupSchema does not emit it. It is a value the writer sets by hand and
 * this record remembers.
 */

import { z } from 'zod';
import { SLIDER_MIN, SLIDER_MAX, EXCLUDE_MAX, WEIRDNESS_DEFAULT, STYLE_INFLUENCE_DEFAULT } from '@/lib/suno-setup';
import { PROMPT_LIMITS } from '@/lib/prompt-preflight';

export const TITLE_MAX = 120;
export const STYLE_NAME_MAX = 120;
export const STYLE_BOX_MAX = 1000;

export interface SunoPrompt {
  id: string;
  /** What the writer calls this pack, e.g. "Enna Idhu Kadhalā — folk take". */
  title: string;
  /** The lyric this pack was built for. Stored on the record: prompts stand alone. */
  lyrics: string;
  /** The style variant name fed to the generator, e.g. "Tamil village folk". */
  style: string;
  /** Comma-separated descriptors — pasted straight into Suno's Style box. */
  styleBox: string;
  /** Things to keep out. Suno's exclude field. */
  exclude: string[];
  /** The arranged lyric with [Kind - Detail] tags, for Suno's Lyrics box. */
  lyricsBlock: string;
  weirdness: number;
  styleInfluence: number;
  /** True when this pack is for a generation that uploads a reference track. */
  usesAudioUpload: boolean;
  /** Only ever set when usesAudioUpload is true. See the header note. */
  audioInfluence?: number;
  createdAt: Date;
  updatedAt: Date;
}

const slider = z.number().int().min(SLIDER_MIN).max(SLIDER_MAX);

/**
 * The audio-upload rule, applied to any shape carrying the two fields. Kept as
 * one function so create and update cannot drift apart on the rule that gives
 * the field its meaning.
 */
const audioInfluenceRule = <T extends { usesAudioUpload?: boolean; audioInfluence?: number }>(
  v: T,
  ctx: z.RefinementCtx
) => {
  if (!v.usesAudioUpload && v.audioInfluence !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['audioInfluence'],
      message: 'Suno only offers Audio Influence with an audio upload — set usesAudioUpload first.',
    });
  }
};

export const sunoPromptInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(TITLE_MAX),
    lyrics: z.string().trim().min(1, 'Lyrics are required').max(PROMPT_LIMITS.LYRICS_MAX_CHARS),
    style: z.string().trim().min(1, 'Style is required').max(STYLE_NAME_MAX),
    styleBox: z.string().trim().max(STYLE_BOX_MAX).default(''),
    exclude: z.array(z.string().trim().min(1)).max(EXCLUDE_MAX).default([]),
    lyricsBlock: z.string().trim().max(PROMPT_LIMITS.LYRICS_MAX_CHARS).default(''),
    weirdness: slider.default(WEIRDNESS_DEFAULT),
    styleInfluence: slider.default(STYLE_INFLUENCE_DEFAULT),
    usesAudioUpload: z.boolean().default(false),
    audioInfluence: slider.optional(),
  })
  .superRefine(audioInfluenceRule);

export const sunoPromptUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(TITLE_MAX).optional(),
    lyrics: z.string().trim().min(1).max(PROMPT_LIMITS.LYRICS_MAX_CHARS).optional(),
    style: z.string().trim().min(1).max(STYLE_NAME_MAX).optional(),
    styleBox: z.string().trim().max(STYLE_BOX_MAX).optional(),
    exclude: z.array(z.string().trim().min(1)).max(EXCLUDE_MAX).optional(),
    lyricsBlock: z.string().trim().max(PROMPT_LIMITS.LYRICS_MAX_CHARS).optional(),
    weirdness: slider.optional(),
    styleInfluence: slider.optional(),
    usesAudioUpload: z.boolean().optional(),
    audioInfluence: slider.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.usesAudioUpload === false && typeof v.audioInfluence === 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audioInfluence'],
        message: 'Cannot set Audio Influence while turning audio upload off.',
      });
    }
  });

export type SunoPromptInput = z.infer<typeof sunoPromptInputSchema>;
export type SunoPromptUpdate = z.infer<typeof sunoPromptUpdateSchema>;
