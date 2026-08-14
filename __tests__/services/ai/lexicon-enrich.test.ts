/** @jest-environment node */
/**
 * The enrich / alternatives / lyric-context PARSERS. No model call is made —
 * these are the pure validation layers, and they are where the language policy
 * is actually enforced rather than merely requested in a prompt.
 *
 * The prompts ask the model not to write lyrics, not to rename headwords, and
 * not to imply that synonyms are interchangeable. A prompt is a request; these
 * parsers are the guarantee.
 */

import { parseEnrichments, parseAlternatives, parseLyricContext } from '@/services/ai/lexicon-enrich';
import { looksLikeVerse, extractJson } from '@/services/ai/lexicon-suggest';

describe('looksLikeVerse', () => {
  it('accepts short original phrases', () => {
    expect(looksLikeVerse('வைகறைத் தென்றல்')).toBe(false);
    expect(looksLikeVerse('முறுவல் பூத்த முகம்')).toBe(false);
  });

  it('rejects anything long enough to be a lyric line', () => {
    expect(looksLikeVerse('வைகறையில் மலரும் நினைவுகள் என்னை அள்ளிச் செல்கின்றன இன்று காலை')).toBe(true);
  });

  it('rejects a multi-line block outright', () => {
    expect(looksLikeVerse('வைகறை வானம்\nமலரும் நினைவு')).toBe(true);
  });
});

describe('extractJson', () => {
  it('pulls an array out of surrounding prose and fences', () => {
    expect(extractJson('Sure!\n```json\n[{"a":1}]\n```\nHope that helps')).toEqual([{ a: 1 }]);
  });

  it('pulls an object when there is no array', () => {
    expect(extractJson('{"concepts":[]}')).toEqual({ concepts: [] });
  });

  /**
   * ⚠️ REGRESSION GUARD. Preferring `[` would bracket the INNER array here and
   * hand back ["மாலை"] instead of the object — silently emptying every
   * lyric-context reading whose response happened to have one array in it.
   */
  it('returns the OBJECT, not its inner array, when the object opens first', () => {
    expect(extractJson('{"concepts":["மாலை"]}')).toEqual({ concepts: ['மாலை'] });
  });

  it('returns null for unparseable output', () => {
    expect(extractJson('I cannot help with that')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});

describe('parseEnrichments', () => {
  const asked = [{ word: 'வைகறை', gloss: 'dawn' }, { word: 'முறுவல்' }];

  it('keeps proposals for the words we asked about', () => {
    const raw = JSON.stringify([
      { word: 'வைகறை', tamilMeaning: 'பொழுது புலரும் அதிகாலை நேரம்', registers: ['literary', 'classical'], wordType: 'noun' },
    ]);
    const out = parseEnrichments(raw, asked);
    expect(out).toHaveLength(1);
    expect(out[0].tamilMeaning).toBe('பொழுது புலரும் அதிகாலை நேரம்');
    expect(out[0].registers).toEqual(['literary', 'classical']);
  });

  /**
   * ⚠️ A model that invents an extra headword must not be able to smuggle it
   * into a review list the poet reads as "your words".
   */
  it('drops a word we never asked about', () => {
    const raw = JSON.stringify([
      { word: 'வைகறை', wordType: 'noun' },
      { word: 'புலரி', wordType: 'noun' }, // never asked for
    ]);
    expect(parseEnrichments(raw, asked).map((e) => e.word)).toEqual(['வைகறை']);
  });

  it('drops an entry whose register is not in the taxonomy', () => {
    const raw = JSON.stringify([{ word: 'வைகறை', registers: ['gorgeous'] }]);
    expect(parseEnrichments(raw, asked)).toEqual([]);
  });

  it('strips an example that is really a lyric line', () => {
    const raw = JSON.stringify([
      { word: 'வைகறை', examples: ['வைகறைத் தென்றல்', 'வைகறையில் மலரும் நினைவுகள் என்னை அள்ளிச் செல்கின்றன இன்று'] },
    ]);
    expect(parseEnrichments(raw, asked)[0].examples).toEqual(['வைகறைத் தென்றல்']);
  });

  it('dedupes repeated proposals for the same word', () => {
    const raw = JSON.stringify([{ word: 'வைகறை', wordType: 'noun' }, { word: 'வைகறை', wordType: 'verb' }]);
    expect(parseEnrichments(raw, asked)).toHaveLength(1);
  });

  it('returns [] rather than throwing on junk', () => {
    expect(parseEnrichments('sorry', asked)).toEqual([]);
  });
});

describe('parseAlternatives', () => {
  /** The nuance is the feature. An alternative without one is not useful. */
  it('drops a candidate that carries no nuance', () => {
    const raw = JSON.stringify([
      { word: 'எழில்', gloss: 'beauty', nuance: 'more elevated and literary than அழகு' },
      { word: 'வனப்பு', gloss: 'beauty' }, // no nuance → dropped
    ]);
    expect(parseAlternatives(raw, 'அழகு').map((a) => a.word)).toEqual(['எழில்']);
  });

  it('keeps the interchangeable flag so the UI can warn', () => {
    const raw = JSON.stringify([
      { word: 'வனப்பு', gloss: 'comeliness', nuance: 'bodily comeliness, not beauty in general', interchangeable: false },
    ]);
    expect(parseAlternatives(raw, 'அழகு')[0].interchangeable).toBe(false);
  });

  it('never returns the word itself as its own alternative', () => {
    const raw = JSON.stringify([{ word: 'அழகு', gloss: 'beauty', nuance: 'the same word' }]);
    expect(parseAlternatives(raw, 'அழகு')).toEqual([]);
  });

  it('dedupes', () => {
    const raw = JSON.stringify([
      { word: 'எழில்', gloss: 'beauty', nuance: 'elevated' },
      { word: 'எழில்', gloss: 'beauty', nuance: 'elevated again' },
    ]);
    expect(parseAlternatives(raw, 'அழகு')).toHaveLength(1);
  });
});

describe('parseLyricContext', () => {
  const raw = JSON.stringify({
    concepts: ['மாலை', 'வானம்', 'நிறம்'],
    suggestions: [
      { word: 'அந்தி', gloss: 'dusk', note: 'a softer word for evening' },
      { word: 'செவ்வானம்', gloss: 'red sky' },
    ],
  });

  it('returns the concepts and word suggestions', () => {
    const out = parseLyricContext(raw);
    expect(out.concepts).toEqual(['மாலை', 'வானம்', 'நிறம்']);
    expect(out.suggestions.map((s) => s.word)).toEqual(['அந்தி', 'செவ்வானம்']);
  });

  /**
   * ⚠️ THE RULE THAT MATTERS. Raj's line is his. If the model answers with a
   * rewritten line dressed up as a "suggestion", it must not reach the UI.
   */
  it('drops a "suggestion" that is actually a rewritten line', () => {
    const sneaky = JSON.stringify({
      concepts: [],
      suggestions: [
        { word: 'அந்தி', gloss: 'dusk' },
        { word: 'மாலை வானம் செக்கச் சிவந்து எரிகிறது இன்று', gloss: 'a better version' },
      ],
    });
    expect(parseLyricContext(sneaky).suggestions.map((s) => s.word)).toEqual(['அந்தி']);
  });

  it('returns an empty reading rather than throwing on junk', () => {
    expect(parseLyricContext('nope')).toEqual({ concepts: [], suggestions: [] });
  });

  it('tolerates a missing suggestions array', () => {
    expect(parseLyricContext('{"concepts":["மாலை"]}')).toEqual({ concepts: ['மாலை'], suggestions: [] });
  });
});
