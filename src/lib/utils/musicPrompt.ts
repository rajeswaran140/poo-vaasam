/**
 * Maps a poem's emotion/mood to a Lyria text-to-music prompt.
 *
 * Lyria generates INSTRUMENTAL music only, so prompts describe instrumentation
 * and mood and explicitly request no vocals.
 */

const EMOTION_PROMPTS: Record<string, string> = {
  sad: 'slow, melancholic South Indian instrumental with soft bansuri flute and gentle strings, sparse and somber',
  melancholic: 'slow, melancholic South Indian instrumental with soft bansuri flute and gentle strings, sparse and somber',
  joyful: 'bright, uplifting Tamil folk instrumental with light percussion and flute, warm and cheerful',
  hopeful: 'gentle, hopeful instrumental with veena and soft strings, warm and uplifting',
  reflective: 'calm, contemplative instrumental with veena and ambient strings, slow and meditative',
  longing: 'tender, yearning instrumental with bansuri flute and soft strings, slow and emotive',
  devotional: 'serene devotional instrumental with veena, tanpura drone and temple bells, meditative',
  patriotic: 'stirring, dignified instrumental with nadaswaram and percussion, proud and uplifting',
  romantic: 'soft, romantic instrumental with bansuri flute and mellow strings, tender and warm',
};

const MOOD_FALLBACK: Record<string, string> = {
  somber: 'slow, somber South Indian instrumental with soft flute and strings, sparse',
  uplifting: 'bright, uplifting Tamil instrumental with light percussion, warm',
  peaceful: 'calm, peaceful ambient instrumental with veena, slow and soothing',
};

const DEFAULT_PROMPT =
  'calm, gentle South Indian instrumental with veena and soft flute, slow and reflective';

export function buildMusicPrompt(emotion?: string | null, mood?: string | null): string {
  const base =
    (emotion && EMOTION_PROMPTS[emotion]) ||
    (mood && MOOD_FALLBACK[mood]) ||
    DEFAULT_PROMPT;
  return `${base}. Purely instrumental, no vocals, gentle looping background music for reading Tamil poetry.`;
}
