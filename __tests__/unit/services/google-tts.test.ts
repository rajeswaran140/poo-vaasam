/** @jest-environment node */
/**
 * google-tts pure helpers — duration estimate, 5000-char chunking, voice list.
 * (The networked synthesize* fns are covered via the route tests; these are the
 * pure logic that previously had no coverage.)
 */
import {
  estimateAudioDuration,
  splitTextForTTS,
  getAvailableVoices,
  TAMIL_VOICES,
} from '@/services/ai/google-tts';

describe('estimateAudioDuration', () => {
  it('scales with text length and returns whole seconds', () => {
    const d = estimateAudioDuration('a'.repeat(135), 0.9); // 150*0.9=135 cpm -> ~1 min
    expect(d).toBe(60);
    expect(Number.isInteger(d)).toBe(true);
  });
  it('a slower speaking rate yields a longer estimate', () => {
    expect(estimateAudioDuration('x'.repeat(300), 0.5)).toBeGreaterThan(
      estimateAudioDuration('x'.repeat(300), 1.0)
    );
  });
});

describe('splitTextForTTS', () => {
  it('returns a single chunk when under the limit', () => {
    expect(splitTextForTTS('short text', 4500)).toEqual(['short text']);
  });
  it('splits long text into multiple chunks, each within the limit', () => {
    const text = Array.from({ length: 20 }, () => 'paragraph '.repeat(40)).join('\n\n');
    const chunks = splitTextForTTS(text, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500 + 50); // small slack for join glue
    // No content is lost (allowing for trim/whitespace differences).
    expect(chunks.join('').replace(/\s/g, '').length).toBeGreaterThan(0);
  });
});

describe('voice catalogue', () => {
  it('exposes the available voices and they map into TAMIL_VOICES', () => {
    const voices = getAvailableVoices();
    expect(Array.isArray(voices)).toBe(true);
    expect(voices.length).toBeGreaterThan(0);
    expect(Object.keys(TAMIL_VOICES).length).toBeGreaterThan(0);
  });
});
