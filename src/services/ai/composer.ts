/**
 * AI Composer — turn Tamil lyrics into a production-ready brief:
 * emotion / mood / theme / key / BPM / instrumentation + SUNO prompt +
 * YouTube description + a few title candidates. Powers /admin/compose.
 *
 * Uses Claude (Anthropic) for Tamil-language fluency. The prompt asks for
 * a strict JSON object so the UI can render structured cards without
 * regex-scraping prose. JSON parsing is defensive — if Claude wraps the
 * output in markdown fences, we strip them before parsing.
 */

import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_LYRICS_CHARS = 8000;

export interface ComposerAnalysis {
  emotion: string;
  mood: string;
  theme: string;
  suggested_key: string;
  suggested_bpm: number;
  suggested_instruments: string[];
  song_titles: string[];
  suno_prompt: string;
  youtube_description: string;
}

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'dummy-key-for-build') return null;
  return new Anthropic({ apiKey: key });
}

const SYSTEM_PROMPT = `You are an AI music-production assistant for a Tamil songwriter and lyricist. Given Tamil song lyrics, you analyse them and produce a complete production brief.

You respond with ONE JSON object and NOTHING else (no prose, no markdown fences). The JSON must match this exact schema:

{
  "emotion": "<one-word Tamil emotion, e.g. காதல், அன்னை, துயரம், மகிழ்ச்சி>",
  "mood": "<2-4 English adjectives, e.g. Melancholic and reflective>",
  "theme": "<short English theme phrase, e.g. Homeland nostalgia>",
  "suggested_key": "<Western key, e.g. D Minor, A Major>",
  "suggested_bpm": <integer 40-200>,
  "suggested_instruments": ["<lead>", "<accompaniment 1>", "<accompaniment 2>", ...],
  "song_titles": ["<title 1 in Tamil>", "<title 2>", "<title 3>"],
  "suno_prompt": "<one paragraph, English, describes the style/instrumentation/tempo/mood for SUNO music-gen — DO NOT include the lyrics themselves>",
  "youtube_description": "<3-5 sentence English description with #tamil #tamilsong relevant hashtags at the end>"
}

Rules:
- Output JSON ONLY. No introduction, no explanation, no markdown.
- Pick the emotion that DOMINATES the lyrics. If unclear, default to "காதல்".
- Instruments should be 4-6 items, lead first. Lean Tamil-classical (Veena, Flute, Nadaswaram, Mridangam, Tabla) when the mood is traditional; Western (Piano, Strings, Guitar) when contemporary.
- BPM: ballad 60-80, mid 90-120, upbeat 130-160.
- Titles should be evocative phrases drawn from or inspired by the lyrics — not generic.
- Hashtags: 5-8 max, all relevant. Include #tamilagaval.`;

/**
 * Best-effort JSON extraction — Claude sometimes (rarely) wraps output in
 * a ```json fence even when asked not to. Strip then parse.
 */
function parseJson(raw: string): ComposerAnalysis {
  let cleaned = raw.trim();
  // Strip markdown fence if present.
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) cleaned = fence[1].trim();
  const parsed = JSON.parse(cleaned) as Partial<ComposerAnalysis>;

  // Light shape validation — fill defaults rather than throwing so a
  // partially-malformed response still gives the UI something useful.
  return {
    emotion: String(parsed.emotion ?? 'காதல்'),
    mood: String(parsed.mood ?? ''),
    theme: String(parsed.theme ?? ''),
    suggested_key: String(parsed.suggested_key ?? ''),
    suggested_bpm: Number.isFinite(parsed.suggested_bpm) ? Number(parsed.suggested_bpm) : 90,
    suggested_instruments: Array.isArray(parsed.suggested_instruments)
      ? parsed.suggested_instruments.map(String)
      : [],
    song_titles: Array.isArray(parsed.song_titles) ? parsed.song_titles.map(String) : [],
    suno_prompt: String(parsed.suno_prompt ?? ''),
    youtube_description: String(parsed.youtube_description ?? ''),
  };
}

export type ComposeResult =
  | { ok: true; data: ComposerAnalysis }
  | { ok: false; error: string };

export async function composeFromLyrics(
  lyricsInput: string,
  model = DEFAULT_MODEL
): Promise<ComposeResult> {
  const lyrics = String(lyricsInput ?? '').trim();
  if (!lyrics) return { ok: false, error: 'Lyrics are required' };
  if (lyrics.length > MAX_LYRICS_CHARS) {
    return { ok: false, error: `Lyrics exceed ${MAX_LYRICS_CHARS} characters` };
  }

  const client = getClient();
  if (!client) return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };

  try {
    const res = await client.messages.create({
      model,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: lyrics }],
    });

    // Claude returns content as an array of blocks; we asked for plain text.
    const text = res.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();

    return { ok: true, data: parseJson(text) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ai/composer] failed:', msg);
    return { ok: false, error: msg };
  }
}
