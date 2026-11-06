/** @jest-environment node */
import {
  refKey,
  candidateKey,
  refPrefix,
  isRefKeyFor,
  refExtensionFor,
  ACCEPTED_REF_TYPES,
  MAX_REF_BYTES,
  MAX_REFS_PER_CHARACTER,
  ACCEPTED_PICTURE_TYPES,
  pictureExtensionFor,
  parseUploadedPictureKey,
} from '@/lib/visual-story-storage';
import { isMasteringKey } from '@/lib/mastering-storage';

const VS = 'vs_1700000000000_abcdef12';
const CH = 'ch_1700000000000_abcdef12';
const CD = 'cd_1700000000000_abcdef12';

describe('constants', () => {
  it('match the brief', () => {
    expect(ACCEPTED_REF_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(MAX_REF_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_REFS_PER_CHARACTER).toBe(4);
  });
});

describe('refKey / candidateKey', () => {
  it('refKey sits under the story and the character, and is a mastering key', () => {
    const k = refKey(VS, CH, 'png');
    expect(k.startsWith(`audio/mastering/visual-story/${VS}/refs/${CH}/`)).toBe(true);
    expect(k.endsWith('.png')).toBe(true);
    expect(k).not.toContain('..');
    expect(isMasteringKey(k)).toBe(true);
    expect(isRefKeyFor(k, VS, CH)).toBe(true);
  });
  it('refKey is unique per call', () => {
    expect(refKey(VS, CH, 'jpg')).not.toBe(refKey(VS, CH, 'jpg'));
  });
  it('candidateKey sits under the story', () => {
    const k = candidateKey(VS, CD, 'jpg');
    expect(k).toBe(`audio/mastering/visual-story/${VS}/candidates/${CD}.jpg`);
    expect(isMasteringKey(k)).toBe(true);
  });
  it('refuses ids that are not shaped like ids', () => {
    expect(() => refKey('../x', CH, 'png')).toThrow();
    expect(() => refKey(VS, `${CH}/../..`, 'png')).toThrow();
    expect(() => refKey(VS, CH, 'gif')).toThrow();
    expect(() => refKey(VS, CH, '../png')).toThrow();
    expect(() => candidateKey(VS, '../cd', 'jpg')).toThrow();
    expect(() => candidateKey(VS, CD, 'exe')).toThrow();
  });
});

describe('isRefKeyFor', () => {
  const good = refKey(VS, CH, 'webp');
  it('accepts only the exact shape under the right story and character', () => {
    expect(isRefKeyFor(good, VS, CH)).toBe(true);
    expect(isRefKeyFor(good, VS, 'ch_1700000000001_zzzzzz99')).toBe(false);
    expect(isRefKeyFor(good, 'vs_1700000000001_zzzzzz99', CH)).toBe(false);
  });
  it('rejects traversal, other prefixes, extra segments and bad extensions', () => {
    const p = refPrefix(VS, CH);
    expect(isRefKeyFor(`${p}../x.png`, VS, CH)).toBe(false);
    expect(isRefKeyFor(`${p}a/b.png`, VS, CH)).toBe(false);
    expect(isRefKeyFor(`${p}x.png`, VS, CH)).toBe(false); // not a uuid
    expect(isRefKeyFor(good.replace(/\.webp$/, '.gif'), VS, CH)).toBe(false);
    expect(isRefKeyFor('audio/mastering/other.wav', VS, CH)).toBe(false);
    expect(isRefKeyFor(good + '/', VS, CH)).toBe(false);
    expect(isRefKeyFor(undefined as unknown as string, VS, CH)).toBe(false);
  });
});

describe('refExtensionFor', () => {
  it('maps the accepted types only', () => {
    expect(refExtensionFor('image/jpeg')).toBe('jpg');
    expect(refExtensionFor('image/png')).toBe('png');
    expect(refExtensionFor('image/webp')).toBe('webp');
    expect(refExtensionFor('image/gif')).toBeNull();
  });
});

describe('uploaded shot pictures', () => {
  it('accepts JPEG and PNG only (what Grok takes as a first frame)', () => {
    expect([...ACCEPTED_PICTURE_TYPES]).toEqual(['image/jpeg', 'image/png']);
    expect(pictureExtensionFor('image/jpeg')).toBe('jpg');
    expect(pictureExtensionFor('image/png')).toBe('png');
    expect(pictureExtensionFor('image/webp')).toBeNull();
    expect(pictureExtensionFor('image/gif')).toBeNull();
  });
  it('candidateKey builds a .png key', () => {
    expect(candidateKey(VS, CD, 'png')).toBe(`audio/mastering/visual-story/${VS}/candidates/${CD}.png`);
  });
  it('parses a candidate picture key of THIS story into its id and extension', () => {
    expect(parseUploadedPictureKey(candidateKey(VS, CD, 'jpg'), VS)).toEqual({ candId: CD, ext: 'jpg' });
    expect(parseUploadedPictureKey(candidateKey(VS, CD, 'png'), VS)).toEqual({ candId: CD, ext: 'png' });
  });
  it('refuses anything else', () => {
    const other = 'vs_1700000000001_zzzzzz99';
    for (const k of [
      candidateKey(VS, CD, 'mp4'),
      candidateKey(other, CD, 'jpg'),
      refKey(VS, CH, 'png'),
      `audio/mastering/visual-story/${VS}/candidates/../${CD}.jpg`,
      `audio/mastering/visual-story/${VS}/candidates/cd_x.jpg`,
      `audio/mastering/visual-story/${VS}/candidates/${CD}.jpg.png`,
      '',
      42,
    ]) {
      expect(parseUploadedPictureKey(k, VS)).toBeNull();
    }
    expect(parseUploadedPictureKey(candidateKey(VS, CD, 'jpg'), '../x')).toBeNull();
  });
});
