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
  sanitizeMasterFilename,
} from '@/lib/mastering-storage';
import { isMasterKey } from '@/lib/loudness-measure';

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
  it('strips the timestamp_nonce storage prefix we add on upload', () => {
    expect(downloadFilename(`${MASTERING_PREFIX}1_a_song-master-14LUFS.wav`)).toBe('song-master-14LUFS.wav');
    expect(
      downloadFilename(`${MASTERING_PREFIX}1784838435834_c969e1c3_-_01_8-master-14LUFS.wav`)
    ).toBe('01_8-master-14LUFS.wav'); // leading "-_" punctuation from SUNO dropped too
  });

  it('never yields an empty or extension-only name', () => {
    expect(downloadFilename(`${MASTERING_PREFIX}1_a_.wav`)).toBe('master.wav');
    expect(downloadFilename(`${MASTERING_PREFIX}x.wav`)).toBe('x.wav');
  });
});

describe('sanitizeMasterFilename', () => {
  it('keeps a friendly title and appends a single .wav', () => {
    expect(sanitizeMasterFilename('Amma En Agame (Master -14 LUFS)')).toBe('Amma En Agame (Master -14 LUFS).wav');
    expect(sanitizeMasterFilename('song.wav')).toBe('song.wav'); // no doubled extension
  });

  it('preserves Tamil (Unicode letters survive)', () => {
    expect(sanitizeMasterFilename('அம்மம்மா என் அகமே')).toBe('அம்மம்மா என் அகமே.wav');
  });

  it('strips separators, quotes and control chars so it cannot inject header directives', () => {
    // This is a download filename, not an S3 key, so ".." is harmless — the
    // properties that matter are: no path separators, no quotes, no controls.
    expect(sanitizeMasterFilename('a/b\\c')).toBe('a b c.wav');
    expect(sanitizeMasterFilename('he said "hi"')).toBe('he said hi.wav');
    expect(sanitizeMasterFilename('line\nbreak\tinjection')).toBe('linebreakinjection.wav');
    expect(sanitizeMasterFilename('../../etc/passwd')).not.toMatch(/[\\/]/);
  });

  it('falls back rather than producing a bare .wav', () => {
    expect(sanitizeMasterFilename('   ')).toBe('master.wav');
    expect(sanitizeMasterFilename('///')).toBe('master.wav');
  });

  it('caps runaway length', () => {
    expect(sanitizeMasterFilename('x'.repeat(500)).length).toBeLessThanOrEqual(124); // 120 + ".wav"
  });
});

describe('generated source keys are never mistaken for mastering outputs', () => {
  // A source literally named "song-master.wav" used to upload in full and then
  // be rejected by the re-master guard — a dead end after a 500MB transfer.
  it('breaks the -master.wav pattern the re-master guard matches', () => {
    for (const name of ['song-master.wav', 'Song-Master.wav', 'x-master-14LUFS.wav']) {
      const key = masteringUploadKey(name, 1, 'n');
      expect(isMasterKey(key)).toBe(false);
      expect(isMasteringKey(key)).toBe(true);
    }
  });

  it('leaves ordinary names alone', () => {
    expect(masteringUploadKey('my-song.wav', 1, 'n')).toBe(`${MASTERING_PREFIX}1_n_my-song.wav`);
  });
});
