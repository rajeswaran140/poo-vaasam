/** @jest-environment node */
/**
 * Legacy → current vocabulary mapping.
 *
 * The tests that matter here are the ones protecting the 1,047 rows already in
 * the table: that reading one never throws, never invents a historical claim,
 * and never quietly upgrades the old `sangam` default into an assertion.
 */

import {
  migrateRegister,
  migrateUsage,
  resolveRegisters,
  isLegacyDefaultedSangam,
} from '@/lib/lexicon-migrate';

describe('migrateRegister', () => {
  it('passes current values through untouched', () => {
    for (const r of ['sangam', 'classical', 'literary', 'modern-poetic', 'common', 'colloquial', 'regional', 'archaic']) {
      expect(migrateRegister(r)).toBe(r);
    }
  });

  it('maps the three retired values to their nearest equivalent', () => {
    expect(migrateRegister('village')).toBe('regional');
    expect(migrateRegister('modern')).toBe('common');
    expect(migrateRegister('devotional')).toBe('literary');
  });

  /**
   * ⚠️ The single most important assertion in this file. If an unknown value
   * fell back to `LEXICON_REGISTERS[0]` — the obvious implementation — every
   * unreadable row would become a Sangam claim, which is precisely the bug the
   * whole redesign exists to undo.
   */
  it('falls back to literary, never to a historical register', () => {
    for (const junk of ['', '   ', 'nonsense', null, undefined, 42, {}]) {
      const out = migrateRegister(junk);
      expect(out).toBe('literary');
      expect(['sangam', 'classical', 'archaic']).not.toContain(out);
    }
  });

  it('is case- and whitespace-insensitive', () => {
    expect(migrateRegister('  Village ')).toBe('regional');
  });
});

describe('migrateUsage', () => {
  it('maps the retired freshness values forward', () => {
    expect(migrateUsage('neutral')).toBe('normal');
    expect(migrateUsage('retire')).toBe('overused');
  });

  it('passes current values through and defaults the unknown to normal', () => {
    expect(migrateUsage('fresh')).toBe('fresh');
    expect(migrateUsage('avoid')).toBe('avoid');
    expect(migrateUsage(undefined)).toBe('normal');
  });
});

describe('resolveRegisters', () => {
  it('prefers the array when present', () => {
    expect(resolveRegisters(['common', 'literary'], 'sangam')).toEqual(['common', 'literary']);
  });

  it('falls back to the legacy scalar when the array is absent or empty', () => {
    expect(resolveRegisters(undefined, 'sangam')).toEqual(['sangam']);
    expect(resolveRegisters([], 'literary')).toEqual(['literary']);
  });

  it('dedupes while preserving order', () => {
    expect(resolveRegisters(['literary', 'village', 'regional'], undefined)).toEqual(['literary', 'regional']);
  });

  it('never returns an empty list', () => {
    expect(resolveRegisters(undefined, undefined)).toEqual(['literary']);
  });
});

describe('isLegacyDefaultedSangam', () => {
  it('flags a single-register sangam row nobody has reviewed', () => {
    expect(isLegacyDefaultedSangam({ register: 'sangam' })).toBe(true);
  });

  it('does NOT flag a sangam row someone recorded a confidence for', () => {
    expect(isLegacyDefaultedSangam({ register: 'sangam', confidence: 'verified' })).toBe(false);
  });

  it('does NOT flag a multi-register row — that took a deliberate choice', () => {
    expect(isLegacyDefaultedSangam({ registers: ['sangam', 'literary'] })).toBe(false);
  });

  it('does not flag rows that were never sangam', () => {
    expect(isLegacyDefaultedSangam({ register: 'literary' })).toBe(false);
  });
});
