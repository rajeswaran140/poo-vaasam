import { sanitizeMasterTitle, sanitizeMasterFilename } from '@/lib/mastering-storage';

/**
 * sanitizeMasterTitle exists because the save route ran the FILENAME sanitiser
 * over a display title. Every master in the library ended up called
 * `ஈழத்து_மண்ணே_Tamilagaval.wav` — an extension baked into a human-facing name.
 * These tests pin the difference between the two.
 */
describe('sanitizeMasterTitle — a NAME, not a filename', () => {
  it('does NOT append .wav', () => {
    expect(sanitizeMasterTitle('ஈழத்து மண்ணே')).toBe('ஈழத்து மண்ணே');
  });

  it('differs from the filename sanitiser on exactly that point', () => {
    const input = 'ஈழத்து மண்ணே';
    expect(sanitizeMasterFilename(input)).toMatch(/\.wav$/);
    expect(sanitizeMasterTitle(input)).not.toMatch(/\.wav$/);
  });

  it('strips a .wav the operator typed, rather than doubling it', () => {
    expect(sanitizeMasterTitle('ஒத்த பனங்கீத்தே.wav')).toBe('ஒத்த பனங்கீத்தே');
    expect(sanitizeMasterTitle('song.wave')).toBe('song');
  });

  it('returns EMPTY for unusable input instead of inventing "master"', () => {
    // The filename sanitiser must invent a name; a title must refuse.
    expect(sanitizeMasterFilename('///')).toBe('master.wav');
    expect(sanitizeMasterTitle('///')).toBe('');
    expect(sanitizeMasterTitle('   ')).toBe('');
  });

  it('still removes path separators and quotes', () => {
    expect(sanitizeMasterTitle('a/b\\c"d')).toBe('a b c d');
  });

  it('strips control characters', () => {
    expect(sanitizeMasterTitle(`a${String.fromCharCode(1)}bc`)).toBe('abc');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeMasterTitle('  a   b  ')).toBe('a b');
  });

  it('preserves Tamil unchanged', () => {
    expect(sanitizeMasterTitle('நெஞ்சக் கூட்டினிலே')).toBe('நெஞ்சக் கூட்டினிலே');
  });

  it('caps the length at 120', () => {
    expect(sanitizeMasterTitle('x'.repeat(200))).toHaveLength(120);
  });

  it('handles null/undefined input without throwing', () => {
    expect(sanitizeMasterTitle(undefined as unknown as string)).toBe('');
  });
});
