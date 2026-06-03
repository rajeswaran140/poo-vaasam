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

// Sonnet 4.6 for best Tamil/musical nuance. Its ~33s generation exceeds
// Amplify's managed-CloudFront ~30s origin timeout, so the /api/admin/compose
// route streams a heartbeat byte every few seconds to keep the connection
// alive (see route.ts). If a deploy ever shows the response is buffered (504
// returns), fall back to 'claude-haiku-4-5-20251001' (~18s, fits without
// streaming).
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_LYRICS_CHARS = 8000;

/** One style-tagged SUNO prompt variant (e.g. style "Devotional"). */
export interface SunoVariant {
  style: string;
  prompt: string;
}

/** A short-form (Reel/Short) idea drawn from the lyrics. */
export interface ReelIdea {
  hook: string;       // punchy Tamil line for the opening of a Short
  caption: string;    // short English caption
  hashtags: string[]; // 3-6 punchy hashtags
}

export interface ComposerAnalysis {
  emotion: string;                  // dominant Tamil emotion
  emotion_breakdown: string[];      // ranked Tamil emotions, dominant first (NO numbers — ranking only)
  mood: string;
  theme: string;
  suggested_key: string;
  suggested_bpm: number;
  suggested_instruments: string[];
  recommended_voice: string[];      // ranked voice fit, best first
  song_titles: string[];
  suno_prompts: SunoVariant[];      // 3-5 style-tagged SUNO prompts
  thumbnail_prompt: string;         // English image-gen prompt for the YouTube thumbnail
  youtube_description_tamil: string;
  youtube_description_english: string;
  reel: ReelIdea;
}

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'dummy-key-for-build') return null;
  return new Anthropic({ apiKey: key });
}

const SYSTEM_PROMPT = `You are an AI music director for a Tamil songwriter and lyricist. Given Tamil song lyrics, you analyse them and produce a complete production brief.

You respond with ONE JSON object and NOTHING else (no prose, no markdown fences). The JSON must match this exact schema:

{
  "emotion": "<one-word Tamil emotion that DOMINATES, e.g. காதல், அன்னை, துயரம், மகிழ்ச்சி>",
  "emotion_breakdown": ["<dominant Tamil emotion>", "<next>", "<next>", ...],
  "mood": "<2-4 English adjectives, e.g. Melancholic and reflective>",
  "theme": "<short English theme phrase, e.g. Homeland nostalgia>",
  "suggested_key": "<Western key, e.g. D Minor, A Major>",
  "suggested_bpm": <integer 40-200>,
  "suggested_instruments": ["<lead>", "<accompaniment 1>", "<accompaniment 2>", ...],
  "recommended_voice": ["<best-fit voice>", "<next>", ...],
  "song_titles": ["<title 1 in Tamil>", "<title 2>", "<title 3>"],
  "suno_prompts": [
    { "style": "<style name>", "prompt": "<one English paragraph for SUNO — style/instrumentation/tempo/mood, NO lyrics>" }
  ],
  "thumbnail_prompt": "<one English image-generation prompt for the YouTube thumbnail>",
  "youtube_description_tamil": "<3-5 sentence Tamil description, hashtags at the end>",
  "youtube_description_english": "<3-5 sentence English description, hashtags at the end>",
  "reel": {
    "hook": "<one punchy Tamil line (from or inspired by the lyrics) to open a Short>",
    "caption": "<short English caption>",
    "hashtags": ["<3-6 punchy hashtags>"]
  }
}

Rules:
- Output JSON ONLY. No introduction, no explanation, no markdown.
- emotion = the dominant emotion; emotion_breakdown = 3-5 emotions RANKED most→least present. Ranking only — DO NOT output numbers, percentages, or scores anywhere.
- Instruments: 4-6 items, lead first. Lean Tamil-classical (Veena, Flute, Nadaswaram, Mridangam, Tabla) when traditional; Western (Piano, Strings, Guitar) when contemporary.
- recommended_voice: 2-4 ranked, best fit first. Choose from: Male Baritone, Male Tenor, Female Adult, Young Female, Elder Male, Child, Duet.
- BPM: ballad 60-80, mid 90-120, upbeat 130-160.
- Titles: evocative phrases drawn from or inspired by the lyrics — not generic.
- suno_prompts: provide 3-5 DISTINCT style variants. Draw styles from: Traditional Tamil (Carnatic), Tamil film ballad, Devotional, Village folk, Modern acoustic, Bharathiyar-inspired. Each prompt is one self-contained English paragraph and must NOT contain the lyrics.
- thumbnail_prompt: vivid, cinematic, culturally Tamil imagery matching the song's emotion. Describe scene/lighting/composition for a 16:9 YouTube thumbnail. Do not request embedded text.
- youtube_description_tamil and youtube_description_english convey the SAME meaning in each language; end each with 5-8 relevant hashtags including #tamilagaval.
- Keep ALL copy and imagery strictly apolitical — no flags, political movements, parties, or partisan references.`;

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

  const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

  // SUNO variants: accept the structured array; tolerate a legacy single
  // `suno_prompt` string or an array of plain strings.
  const rawSuno = (parsed as { suno_prompts?: unknown; suno_prompt?: unknown }).suno_prompts
    ?? (parsed as { suno_prompt?: unknown }).suno_prompt;
  const suno_prompts: SunoVariant[] = Array.isArray(rawSuno)
    ? rawSuno
        .map((v) =>
          v && typeof v === 'object'
            ? { style: String((v as SunoVariant).style ?? 'Default'), prompt: String((v as SunoVariant).prompt ?? '') }
            : { style: 'Default', prompt: String(v) }
        )
        .filter((s) => s.prompt)
    : typeof rawSuno === 'string' && rawSuno
      ? [{ style: 'Default', prompt: rawSuno }]
      : [];

  const rawReel = (parsed.reel ?? {}) as Partial<ReelIdea>;

  // Light shape validation — fill defaults rather than throwing so a
  // partially-malformed response still gives the UI something useful.
  return {
    emotion: String(parsed.emotion ?? 'காதல்'),
    emotion_breakdown: strArray(parsed.emotion_breakdown).length
      ? strArray(parsed.emotion_breakdown)
      : [String(parsed.emotion ?? 'காதல்')],
    mood: String(parsed.mood ?? ''),
    theme: String(parsed.theme ?? ''),
    suggested_key: String(parsed.suggested_key ?? ''),
    suggested_bpm: Number.isFinite(parsed.suggested_bpm) ? Number(parsed.suggested_bpm) : 90,
    suggested_instruments: strArray(parsed.suggested_instruments),
    recommended_voice: strArray(parsed.recommended_voice),
    song_titles: strArray(parsed.song_titles),
    suno_prompts,
    thumbnail_prompt: String(parsed.thumbnail_prompt ?? ''),
    youtube_description_tamil: String(parsed.youtube_description_tamil ?? ''),
    youtube_description_english: String(parsed.youtube_description_english ?? ''),
    reel: {
      hook: String(rawReel.hook ?? ''),
      caption: String(rawReel.caption ?? ''),
      hashtags: strArray(rawReel.hashtags),
    },
  };
}

/**
 * Error classification so the API route can map failures to the right HTTP
 * status and a clean, user-safe message — without leaking raw upstream JSON
 * (status codes, request_ids) to the admin UI.
 *  - not_configured: key missing / placeholder
 *  - auth:           key present but rejected (invalid / expired / revoked)
 *  - rate_limit:     429 from Anthropic
 *  - upstream:       any other API / network failure
 *  - bad_response:   call succeeded but the model output wasn't parseable JSON
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

export async function composeFromLyrics(
  lyricsInput: string,
  model = DEFAULT_MODEL
): Promise<ComposeResult> {
  const lyrics = String(lyricsInput ?? '').trim();
  if (!lyrics) return { ok: false, code: 'upstream', error: 'Lyrics are required' };
  if (lyrics.length > MAX_LYRICS_CHARS) {
    return { ok: false, code: 'upstream', error: `Lyrics exceed ${MAX_LYRICS_CHARS} characters` };
  }

  const client = getClient();
  if (!client) {
    return { ok: false, code: 'not_configured', error: 'AI is not configured (ANTHROPIC_API_KEY missing).' };
  }

  let text: string;
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 3500, // larger brief: ranked emotions, 3-5 SUNO variants, bilingual desc, thumbnail, reel
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: lyrics }],
    });

    // Claude returns content as an array of blocks; we asked for plain text.
    text = res.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
  } catch (err) {
    // Log the FULL upstream detail server-side; return a clean, user-safe
    // message to the caller (no request_ids / raw JSON leakage).
    const status = (err as { status?: number })?.status;
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[ai/composer] Anthropic call failed (status=${status ?? 'n/a'}):`, detail);

    if (status === 401 || status === 403) {
      return { ok: false, code: 'auth', error: 'The Claude API key is invalid, expired, or lacks access. Update ANTHROPIC_API_KEY.' };
    }
    if (status === 429) {
      return { ok: false, code: 'rate_limit', error: 'The AI service is rate-limited right now. Please retry in a moment.' };
    }
    return { ok: false, code: 'upstream', error: 'The AI service failed to respond. Please try again.' };
  }

  try {
    return { ok: true, data: parseJson(text) };
  } catch (err) {
    console.error('[ai/composer] response parse failed:', err instanceof Error ? err.message : String(err), '\nraw:', text.slice(0, 500));
    return { ok: false, code: 'bad_response', error: 'The AI returned an unexpected format. Please try again.' };
  }
}
