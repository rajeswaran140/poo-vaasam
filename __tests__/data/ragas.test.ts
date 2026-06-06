/** @jest-environment node */
/**
 * Raga catalog — integrity, lookup/normalisation (incl. cross-system
 * equivalents), mood filtering, canonicalisation, and the composer palette.
 */

import {
  RAGAS,
  findRaga,
  getRagas,
  canonicalRagaNames,
  ragaPalette,
  ragaScaleKey,
} from '@/data/ragas';

it('has a non-trivial catalog with unique ids, moods, and a scale', () => {
  expect(RAGAS.length).toBeGreaterThanOrEqual(20);
  const ids = RAGAS.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const r of RAGAS) {
    expect(r.name).toBeTruthy();
    expect(['Carnatic', 'Hindustani']).toContain(r.tradition);
    expect(r.moods.length).toBeGreaterThan(0);
    expect(r.scale).toBeTruthy(); // every raga carries a Western scale hint
  }
});

describe('ragaScaleKey', () => {
  it('combines the tonic with the lead raga scale', () => {
    expect(ragaScaleKey('D Minor', 'Keeravani')).toBe('D harmonic minor');
    expect(ragaScaleKey('A Major', 'Mohanam')).toBe('A major pentatonic');
    expect(ragaScaleKey('C# Minor', 'kirwani')).toBe('C# harmonic minor'); // alias resolves
  });
  it('falls back to the original key when raga/tonic is unresolved', () => {
    expect(ragaScaleKey('D Minor', 'Not A Raga')).toBe('D Minor');
    expect(ragaScaleKey('', 'Keeravani')).toBe('');
  });
});

it('resolves aliases, case and cross-system equivalents', () => {
  expect(findRaga('mohana')?.name).toBe('Mohanam'); // alias
  expect(findRaga('KALYANI')?.name).toBe('Kalyani'); // case
  expect(findRaga('kirwani')?.name).toBe('Keeravani'); // alias
  // A primary name wins over the same word used as another raga's equivalent alias.
  expect(findRaga('yaman')?.name).toBe('Yaman');
});

it('returns undefined for an unknown raga', () => {
  expect(findRaga('Totally Made Up Raga')).toBeUndefined();
});

it('filters by tradition and mood', () => {
  expect(getRagas({ tradition: 'Hindustani' }).every((r) => r.tradition === 'Hindustani')).toBe(true);
  const devotional = getRagas({ mood: 'devotional' });
  expect(devotional.length).toBeGreaterThan(0);
  expect(devotional.every((r) => r.moods.includes('devotional'))).toBe(true);
});

it('canonicalises a list, dropping unknown ragas and deduping', () => {
  const out = canonicalRagaNames(['mohana', 'Not A Raga', 'Kalyani', 'mohanam']);
  expect(out).toEqual(['Mohanam', 'Kalyani']); // unknown dropped, Mohanam deduped
});

it('builds a palette string annotated with each raga\'s rasa', () => {
  const palette = ragaPalette();
  expect(palette).toMatch(/Mohanam \(/);
  expect(palette).toContain('Kalyani');
});
