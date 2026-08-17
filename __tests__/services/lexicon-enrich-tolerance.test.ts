/** @jest-environment node */
/**
 * ⚠️ One bad optional field must not discard a whole word.
 *
 * Measured 2026-08-17: a 12-word enrichment returned 12 good entries and only
 * TWO survived. Every loss was `moods.0: Invalid option` — the model proposed a
 * mood outside the vocabulary, and because `moods` was `z.array(z.enum(...))`
 * the failure rejected the ENTIRE object: correct Tamil meaning, register,
 * themes, all thrown away for one adjective. Engine-independent, and it had
 * been quietly gutting the feature.
 */

import { parseEnrichments } from '@/services/ai/lexicon-enrich';

const asked = [{ word: 'காற்றோசை' }, { word: 'செழுமை' }];

describe('an unknown enum value costs the field, not the word', () => {
  it('keeps the entry when a mood is out of vocabulary', () => {
    const raw = JSON.stringify([
      { word: 'காற்றோசை', tamilMeaning: 'காற்றின் ஒலி', gloss: 'sound of wind', moods: ['serene'] },
    ]);
    const out = parseEnrichments(raw, asked);
    expect(out).toHaveLength(1);
    expect(out[0].tamilMeaning).toBe('காற்றின் ஒலி');
    expect(out[0].moods ?? []).toEqual([]);   // the bad value is dropped…
  });

  it('keeps the good moods and drops only the unknown ones', () => {
    const raw = JSON.stringify([
      { word: 'செழுமை', moods: ['serene', 'joyful', 'reflective', 'tender'] },
    ]);
    const out = parseEnrichments(raw, [{ word: 'செழுமை' }]);
    expect(out[0].moods).toEqual(['joyful', 'tender']);
  });

  /**
   * ⚠️ Registers are NOT loosened. Register is the core classification claim —
   * a false one is what put 1,035 words under `sangam` — so a model inventing
   * a register discredits the entry rather than just that field. Every measured
   * drop was `moods`; none was `registers`.
   */
  it('still discards a word whose register is invented', () => {
    const raw = JSON.stringify([
      { word: 'செழுமை', registers: ['victorian'], tamilMeaning: 'நிறைவு' },
    ]);
    expect(parseEnrichments(raw, [{ word: 'செழுமை' }])).toEqual([]);
  });

  /** The guard that must survive the loosening. */
  it('still refuses a word nobody asked about', () => {
    const raw = JSON.stringify([{ word: 'வேறுசொல்', tamilMeaning: 'x' }]);
    expect(parseEnrichments(raw, asked)).toHaveLength(0);
  });
});

/**
 * ⚠️ Themes were a FREE STRING ARRAY, so the model could invent categories and
 * nothing stopped them. Measured on 1,047 words: 176 distinct themes proposed
 * against the 40 allowed, only 57% of tags valid, and 301 words carried no
 * valid theme at all. Applying that would have polluted the theme taxonomy with
 * `identity`, `art`, `nostalgia` and 134 others.
 */
describe('themes are held to the taxonomy', () => {
  it('drops an invented theme but keeps the word', () => {
    const raw = JSON.stringify([
      { word: 'செழுமை', tamilMeaning: 'நிறைவு', themes: ['identity', 'nature', 'nostalgia'] },
    ]);
    const out = parseEnrichments(raw, [{ word: 'செழுமை' }]);
    expect(out).toHaveLength(1);
    expect(out[0].themes).toEqual(['nature']);
    expect(out[0].tamilMeaning).toBe('நிறைவு');
  });

  it('yields an empty list when every theme is invented', () => {
    const raw = JSON.stringify([{ word: 'செழுமை', themes: ['art', 'literature'] }]);
    const out = parseEnrichments(raw, [{ word: 'செழுமை' }]);
    expect(out).toHaveLength(1);
    expect(out[0].themes ?? []).toEqual([]);
  });
});
