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
    const out = parseSuggestions(valid);
    expect(out).toHaveLength(2);
    expect(out[0].word).toBe('அலைகடல்');
  });

  it('tolerates markdown fences + surrounding prose', () => {
    const wrapped = 'Here are some words:\n```json\n' + valid + '\n```\nHope that helps!';
    expect(parseSuggestions(wrapped)).toHaveLength(2);
  });

  /**
   * ⚠️ BEHAVIOUR CHANGE, AND THE POINT OF THE WHOLE REDESIGN. The old parser
   * overwrote every suggestion's register with the one that was REQUESTED
   * ("a 'suggest sangam' batch is all sangam regardless of how the model
   * labels each item"). That is the mechanism that manufactures false history:
   * ask for sangam, receive a modern coinage, store it as sangam. The model's
   * own classification is now kept, and the audit flags what needs review.
   */
  it('does NOT force the requested register onto a suggestion', () => {
    const labeled = JSON.stringify([
      { word: 'கடல்', gloss: 'sea', register: 'common', themes: [], usage: 'fresh' },
    ]);
    const out = parseSuggestions(labeled, [], 'sangam');
    expect(out[0].register).toBe('common');
  });

  it('migrates a retired register value forward instead of rejecting it', () => {
    const legacy = JSON.stringify([{ word: 'கடல்', gloss: 'sea', register: 'village', themes: [], usage: 'fresh' }]);
    expect(parseSuggestions(legacy)[0].register).toBe('regional');
  });

  /**
   * A model asked for beautiful Tamil will label a coinage "sangam". Unless it
   * also committed to an attested lexical status, the claim is softened rather
   * than trusted — we keep the word and drop the unevidenced history.
   */
  it('downgrades an unevidenced historical claim to literary', () => {
    const overclaimed = JSON.stringify([
      { word: 'நினைவலை', gloss: 'wave of memories', registers: ['sangam'], lexicalStatus: 'creative-poetic', usage: 'fresh' },
    ]);
    const out = parseSuggestions(overclaimed);
    expect(out[0].registers).toEqual(['literary']);
    expect(out[0].confidence).toBe('medium');
  });

  it('keeps a historical claim the model backed with an attested status', () => {
    const evidenced = JSON.stringify([
      { word: 'அகத்திணை', gloss: 'interior genre', registers: ['sangam'], lexicalStatus: 'historical', usage: 'fresh' },
    ]);
    expect(parseSuggestions(evidenced)[0].registers).toEqual(['sangam']);
  });

  it('keeps a historical claim when that register was explicitly requested', () => {
    const asked = JSON.stringify([
      { word: 'உரிப்பொருள்', gloss: 'the essential matter', registers: ['sangam'], usage: 'fresh' },
    ]);
    expect(parseSuggestions(asked, [], 'sangam')[0].registers).toEqual(['sangam']);
  });

  /** Examples are examples. A whole line is a lyric, and we do not write those. */
  it('drops an "example" long enough to be a lyric line', () => {
    const versey = JSON.stringify([
      {
        word: 'வைகறை',
        gloss: 'dawn',
        register: 'literary',
        usage: 'fresh',
        examples: ['வைகறைத் தென்றல்', 'வைகறையில் மலரும் நினைவுகள் என்னை அள்ளிச் செல்கின்றன இன்று'],
      },
    ]);
    expect(parseSuggestions(versey)[0].examples).toEqual(['வைகறைத் தென்றல்']);
  });

  it('drops invalid entries (missing gloss) but keeps valid ones', () => {
    const mixed = JSON.stringify([
      { word: 'நிலா', gloss: 'moon', register: 'literary', themes: [], usage: 'fresh' },
      { word: 'நட்சத்திரம்', register: 'literary' }, // no gloss → invalid
    ]);
    const out = parseSuggestions(mixed);
    expect(out).toHaveLength(1);
    expect(out[0].word).toBe('நிலா');
  });

  it('dedupes against the avoid list and within the batch', () => {
    const dupes = JSON.stringify([
      { word: 'நிலா', gloss: 'moon', register: 'literary', themes: [], usage: 'fresh' },
      { word: 'நிலா', gloss: 'moon again', register: 'literary', themes: [], usage: 'fresh' },
      { word: 'கடல்', gloss: 'sea', register: 'literary', themes: [], usage: 'fresh' },
    ]);
    const out = parseSuggestions(dupes, ['கடல்']);
    expect(out.map((w) => w.word)).toEqual(['நிலா']); // second நிலா deduped, கடல் avoided
  });

  it('returns [] for non-JSON / no array', () => {
    expect(parseSuggestions('sorry, I cannot help')).toEqual([]);
    expect(parseSuggestions('{"not":"an array"}')).toEqual([]);
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
