/** @jest-environment node */
/**
 * Instrument catalog (India + Sri Lanka) — integrity, lookup/normalisation,
 * filtering, canonicalisation, and the composer palette.
 */

import {
  INSTRUMENTS,
  findInstrument,
  getInstruments,
  canonicalInstrumentNames,
  instrumentPalette,
} from '@/data/instruments';

it('has a non-trivial catalog with unique ids and required fields', () => {
  expect(INSTRUMENTS.length).toBeGreaterThanOrEqual(25);
  const ids = INSTRUMENTS.map((i) => i.id);
  expect(new Set(ids).size).toBe(ids.length); // unique
  for (const i of INSTRUMENTS) {
    expect(i.name).toBeTruthy();
    expect(['India', 'Sri Lanka', 'Both']).toContain(i.region);
    expect(['string', 'wind', 'percussion', 'drone', 'keyboard']).toContain(i.category);
    expect(i.traditions.length).toBeGreaterThan(0);
  }
});

it('includes Sri Lankan instruments (not only Indian)', () => {
  expect(getInstruments({ region: 'Sri Lanka' }).length).toBeGreaterThan(0);
  expect(findInstrument('Geta Bera')).toBeTruthy();
});

it('resolves aliases, diacritics, and Tamil names to the canonical entry', () => {
  expect(findInstrument('mrudangam')?.name).toBe('Mridangam'); // alias
  expect(findInstrument('NAGASWARAM')?.name).toBe('Nadaswaram'); // alias + case
  expect(findInstrument('மிருதங்கம்')?.name).toBe('Mridangam'); // tamil name
  expect(findInstrument('bansuri')?.name).toBe('Flute'); // alias
});

it('returns undefined for an unknown / generic name', () => {
  expect(findInstrument('Strings')).toBeUndefined();
  expect(findInstrument('Synthesizer')).toBeUndefined();
});

it('filters by region, category, tradition and free text', () => {
  expect(getInstruments({ category: 'percussion' }).every((i) => i.category === 'percussion')).toBe(true);
  expect(getInstruments({ tradition: 'Carnatic' }).length).toBeGreaterThan(0);
  expect(getInstruments({ q: 'drum' }).length).toBeGreaterThan(0);
  // region 'India' also surfaces 'Both' instruments (e.g. Conch).
  expect(getInstruments({ region: 'India' }).some((i) => i.region === 'Both')).toBe(true);
});

it('canonicalises a list, dropping non-catalog names and deduping', () => {
  const out = canonicalInstrumentNames(['veena', 'Strings', 'mrudangam', 'Veena', 'Tabla']);
  expect(out).toEqual(['Veena', 'Mridangam', 'Tabla']); // Strings dropped, Veena deduped, order kept
});

it('builds a grouped palette string for the composer prompt', () => {
  const palette = instrumentPalette();
  expect(palette).toContain('string:');
  expect(palette).toContain('percussion:');
  expect(palette).toContain('Veena');
  expect(palette).toContain('Mridangam');
});
