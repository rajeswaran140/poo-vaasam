/** @jest-environment node */
/**
 * mastering-storage — the prefix boundary that stops an admin session presigning
 * arbitrary bucket objects, plus collision-proof upload keys.
 */

import {
  MASTERING_PREFIX,
  isMasteringKey,
  masteringUploadKey,
  downloadFilename,
} from '@/lib/mastering-storage';

describe('isMasteringKey', () => {
  it('accepts keys inside the workspace', () => {
    expect(isMasteringKey(`${MASTERING_PREFIX}123_ab_song.wav`)).toBe(true);
    expect(isMasteringKey(`${MASTERING_PREFIX}123_ab_song-master-14LUFS.wav`)).toBe(true);
  });

  it('refuses anything outside it — this is the security boundary', () => {
    // Without this the download route would presign ANY object in the bucket.
    expect(isMasteringKey('audio/poem-music/song.mp3')).toBe(false);
    expect(isMasteringKey('images/secret.png')).toBe(false);
    expect(isMasteringKey('')).toBe(false);
    expect(isMasteringKey(MASTERING_PREFIX)).toBe(false); // the bare prefix is not an object
  });

  it('refuses traversal and lookalike prefixes', () => {
    expect(isMasteringKey(`${MASTERING_PREFIX}../poem-music/song.mp3`)).toBe(false);
    expect(isMasteringKey('audio/mastering-other/song.wav')).toBe(false);
    expect(isMasteringKey(`x/${MASTERING_PREFIX}song.wav`)).toBe(false);
  });

  it('refuses absurdly long keys', () => {
    expect(isMasteringKey(MASTERING_PREFIX + 'a'.repeat(1100))).toBe(false);
  });
});

describe('masteringUploadKey', () => {
  it('lands in the workspace with a .wav extension', () => {
    const k = masteringUploadKey('My Song.wav', 1700000000000, 'abcd1234');
    expect(k).toBe(`${MASTERING_PREFIX}1700000000000_abcd1234_My_Song.wav`);
    expect(isMasteringKey(k)).toBe(true);
  });

  it('never collides for the same filename', () => {
    const a = masteringUploadKey('song.wav', 1, 'aaaa');
    const b = masteringUploadKey('song.wav', 2, 'bbbb');
    expect(a).not.toBe(b);
  });

  it('sanitises Tamil and punctuation without producing an empty name', () => {
    const k = masteringUploadKey('செவ்விழி ஓவியமே.wav', 1, 'n');
    expect(isMasteringKey(k)).toBe(true);
    expect(k.endsWith('.wav')).toBe(true);
    // An all-Tamil name sanitises to nothing — must fall back, not yield "..wav".
    expect(k).toBe(`${MASTERING_PREFIX}1_n_source.wav`);
  });

  it('cannot be steered out of the prefix by a hostile filename', () => {
    // Must stay downloadable too: a stem keeping ".." would pass upload and then
    // fail isMasteringKey() on the way back out.
    const k = masteringUploadKey('../../etc/passwd.wav', 1, 'n');
    expect(k).toBe(`${MASTERING_PREFIX}1_n_etc_passwd.wav`);
    expect(k).not.toContain('..');
    expect(isMasteringKey(k)).toBe(true);
  });

  it('every sanitised name round-trips back through isMasteringKey', () => {
    for (const name of ['..wav', 'a/b/c.wav', '   .wav', 'x..y.wav', 'ñ°.wav', 'a'.repeat(300) + '.wav']) {
      expect(isMasteringKey(masteringUploadKey(name, 1, 'n'))).toBe(true);
    }
  });
});

describe('downloadFilename', () => {
  it('is the last path segment', () => {
    expect(downloadFilename(`${MASTERING_PREFIX}1_a_song-master-14LUFS.wav`)).toBe('1_a_song-master-14LUFS.wav');
  });
});
