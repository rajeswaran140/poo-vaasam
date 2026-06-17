/** @jest-environment node */
/**
 * parseSuggestions (pure) + lexicon schema/normalize. The Anthropic call is not
 * exercised here — only the tolerant JSON parsing + validation + dedupe.
 */

import { parseSuggestions } from '@/services/ai/lexicon-suggest';
import { lexiconWordInputSchema, normalizeWord } from '@/types/lexicon';

const valid = JSON.stringify([
  { word: 'அலைகடல்', romanization: 'alaikadal', gloss: 'wavy sea', register: 'literary', themes: ['nature'], usage: 'fresh' },
  { word: 'நிலா', romanization: 'nila', gloss: 'moon', register: 'literary', themes: ['love'], usage: 'fresh' },
]);

describe('parseSuggestions', () => {
  it('parses a clean JSON array', () => {
    const out = parseSuggestions(valid, 'literary');
    expect(out).toHaveLength(2);
    expect(out[0].word).toBe('அலைகடல்');
  });

  it('tolerates markdown fences + surrounding prose', () => {
    const wrapped = 'Here are some words:\n```json\n' + valid + '\n```\nHope that helps!';
    expect(parseSuggestions(wrapped, 'literary')).toHaveLength(2);
  });

  it('forces the requested register regardless of what the model labels', () => {
    const mislabeled = JSON.stringify([{ word: 'கடல்', gloss: 'sea', register: 'village', themes: [], usage: 'fresh' }]);
    const out = parseSuggestions(mislabeled, 'sangam');
    expect(out[0].register).toBe('sangam');
  });

  it('drops invalid entries (missing gloss) but keeps valid ones', () => {
    const mixed = JSON.stringify([
      { word: 'நிலா', gloss: 'moon', register: 'literary', themes: [], usage: 'fresh' },
      { word: 'நட்சத்திரம்', register: 'literary' }, // no gloss → invalid
    ]);
    const out = parseSuggestions(mixed, 'literary');
    expect(out).toHaveLength(1);
    expect(out[0].word).toBe('நிலா');
  });

  it('dedupes against the avoid list and within the batch', () => {
    const dupes = JSON.stringify([
      { word: 'நிலா', gloss: 'moon', register: 'literary', themes: [], usage: 'fresh' },
      { word: 'நிலா', gloss: 'moon again', register: 'literary', themes: [], usage: 'fresh' },
      { word: 'கடல்', gloss: 'sea', register: 'literary', themes: [], usage: 'fresh' },
    ]);
    const out = parseSuggestions(dupes, 'literary', ['கடல்']);
    expect(out.map((w) => w.word)).toEqual(['நிலா']); // second நிலா deduped, கடல் avoided
  });

  it('returns [] for non-JSON / no array', () => {
    expect(parseSuggestions('sorry, I cannot help', 'literary')).toEqual([]);
    expect(parseSuggestions('{"not":"an array"}', 'literary')).toEqual([]);
  });
});

describe('lexicon schema', () => {
  it('defaults usage to fresh and themes to []', () => {
    const p = lexiconWordInputSchema.parse({ word: ' நிலா ', gloss: 'moon', register: 'literary' });
    expect(p.usage).toBe('fresh');
    expect(p.themes).toEqual([]);
    expect(p.word).toBe('நிலா'); // trimmed
  });

  it('rejects an unknown register', () => {
    expect(lexiconWordInputSchema.safeParse({ word: 'x', gloss: 'y', register: 'slang' }).success).toBe(false);
  });

  it('normalizeWord NFC-normalizes + trims', () => {
    expect(normalizeWord('  நிலா  ')).toBe('நிலா');
  });
});
