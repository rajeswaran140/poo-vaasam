/**
 * Poem emotion analysis (OpenAI gpt-4o-mini).
 *
 * Small structured-JSON classification: a Tamil poem → emotion + the background
 * music / TTS parameters the reader uses. Shared by the public
 * `/api/ai/analyze-poem` fallback and the admin precompute endpoint so both use
 * exactly one prompt + model (no drift).
 *
 * The result is stable per poem (fixed body, low temperature), so it's meant to
 * be computed ONCE at publish time and stored on the content record — keeping
 * the LLM out of the visitor interaction path entirely.
 */
import OpenAI from 'openai';

export interface PoemEmotionAnalysis {
  emotion: string;
  mood: string;
  themes: string[];
  musicRecommendation: string;
  ttsSpeed: number;
  ttsPitch: number;
  summary: string;
}

/** Gentle reflective fallback used when analysis is unavailable or degraded. */
export const DEFAULT_POEM_ANALYSIS: PoemEmotionAnalysis = {
  emotion: 'sad',
  mood: 'somber',
  themes: ['இழப்பு', 'நினைவுகள்'],
  musicRecommendation: 'sad_piano',
  ttsSpeed: 0.85,
  ttsPitch: 0.9,
  summary: 'உணர்ச்சிபூர்வமான கவிதை',
};

export interface PoemInput {
  title: string;
  body: string;
  author?: string;
}

const SYSTEM_PROMPT = `You are an expert Tamil literature analyst. Analyze Tamil poems and provide accurate emotional context.

Your response must be valid JSON with this exact structure:
{
  "emotion": "one of: sad, joyful, reflective, longing, devotional, patriotic, romantic, melancholic, hopeful",
  "mood": "one of: somber, uplifting, peaceful, intense, gentle, powerful",
  "themes": ["array", "of", "themes"],
  "musicRecommendation": "sad_piano | uplifting_strings | peaceful_ambient | emotional_piano | devotional_instrumental",
  "ttsSpeed": "number between 0.7 and 1.2 (slower for sad, faster for joyful)",
  "ttsPitch": "number between 0.8 and 1.2 (lower for somber, higher for joyful)",
  "summary": "brief Tamil summary of emotional essence"
}`;

/** True when a usable OpenAI key is configured (i.e. analysis will be attempted). */
export function isPoemAnalysisConfigured(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return !!key && key !== 'your-openai-api-key-here';
}

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

/**
 * Analyze a Tamil poem's emotional context.
 * @throws if the OpenAI key is missing, the API errors, or the response can't be
 *         parsed — callers decide the fallback (a `degraded` default, usually).
 */
export async function analyzePoemEmotion({ title, body, author }: PoemInput): Promise<PoemEmotionAnalysis> {
  if (!isPoemAnalysisConfigured()) {
    throw new Error('OpenAI API key not configured');
  }

  const completion = await openai().chat.completions.create({
    // gpt-4o-mini is ~99% cheaper than the legacy gpt-4 with equal/better
    // quality on a task this constrained.
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Analyze this Tamil poem:

Title: ${title}
Author: ${author || 'Unknown'}

Poem:
${body}

Provide emotional analysis in JSON format.`,
      },
    ],
    temperature: 0.3,
    max_tokens: 500,
    // Guarantee valid JSON back so the parse below doesn't fall through.
    response_format: { type: 'json_object' },
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('No analysis received from OpenAI');

  return JSON.parse(text) as PoemEmotionAnalysis;
}
