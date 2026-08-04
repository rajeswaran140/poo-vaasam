/** @jest-environment node */
/**
 * Web MP3 export and its peak verdict.
 *
 * The verdict is the part with teeth: it decides whether a peak violation sends
 * you to re-master or to re-encode, and only one of those ever fixes anything.
 * The attribution rule comes from measurement, not intuition — see the module
 * header for the 13-song encode-delta study.
 */
import {
  mp3KeyFor,
  isMasterMp3Key,
  buildMp3Args,
  mp3PeakVerdict,
  MP3_BITRATE,
  TRUE_PEAK_CEILING_DBTP,
  MAX_OBSERVED_ENCODE_RISE_DB,
} from '@/lib/master-mp3';
import { masterKeyFor, isMasterKey } from '@/lib/loudness-measure';
import { extensionFor, downloadFilename, sanitizeMasterFilename } from '@/lib/mastering-storage';

describe('mp3KeyFor', () => {
  it('sits beside the master it came from, differing only in extension', () => {
    const master = masterKeyFor('audio/mastering/1700_ab_take.wav', -14);
    expect(master).toMatch(/\.wav$/);
    expect(mp3KeyFor(master)).toBe(master.replace(/\.wav$/, '.mp3'));
  });

  it('keeps the target in the name, so -14 and -16 do not overwrite each other', () => {
    const a = mp3KeyFor(masterKeyFor('audio/mastering/x_take.wav', -14));
    const b = mp3KeyFor(masterKeyFor('audio/mastering/x_take.wav', -16));
    expect(a).not.toBe(b);
    expect(a).toContain('14LUFS');
    expect(b).toContain('16LUFS');
  });

  it('is case-insensitive about the source extension', () => {
    expect(mp3KeyFor('a/b-master-14LUFS.WAV')).toBe('a/b-master-14LUFS.mp3');
  });
});

describe('isMasterMp3Key', () => {
  it('recognises this module\'s own MP3 outputs', () => {
    expect(isMasterMp3Key('audio/mastering/x-master-14LUFS.mp3')).toBe(true);
    expect(isMasterMp3Key('audio/mastering/x-master.mp3')).toBe(true);
  });

  it('does not claim an arbitrary MP3, nor the WAV master', () => {
    expect(isMasterMp3Key('audio/poem-music/song.mp3')).toBe(false);
    expect(isMasterMp3Key('audio/mastering/x-master-14LUFS.wav')).toBe(false);
  });

  it('never overlaps with isMasterKey — the re-master guard must not catch the MP3', () => {
    const mp3 = mp3KeyFor(masterKeyFor('audio/mastering/x_take.wav', -14));
    expect(isMasterMp3Key(mp3)).toBe(true);
    expect(isMasterKey(mp3)).toBe(false);
  });
});

describe('buildMp3Args', () => {
  it('encodes at the bitrate the site already serves', () => {
    const args = buildMp3Args('/tmp/in.wav', '/tmp/out.mp3');
    expect(MP3_BITRATE).toBe('192k');
    expect(args).toContain('-b:a');
    expect(args[args.indexOf('-b:a') + 1]).toBe('192k');
    expect(args).toContain('libmp3lame');
  });

  it('applies NO filters — trim and fade already happened in the pre-pass', () => {
    // Re-applying a fade here would double it, and the doubling would be
    // audible only in the MP3, which is the copy nobody auditions.
    const args = buildMp3Args('/tmp/in.wav', '/tmp/out.mp3');
    expect(args).not.toContain('-af');
    expect(args).not.toContain('-filter:a');
  });

  it('drops any inherited cover art', () => {
    expect(buildMp3Args('/tmp/in.wav', '/tmp/out.mp3')).toContain('-vn');
  });

  it('reads the input and writes the output it was given', () => {
    const args = buildMp3Args('/tmp/master.wav', '/tmp/web.mp3');
    expect(args[args.indexOf('-i') + 1]).toBe('/tmp/master.wav');
    expect(args[args.length - 1]).toBe('/tmp/web.mp3');
  });
});

describe('mp3PeakVerdict', () => {
  it('passes a compliant MP3 and reports the encode delta', () => {
    const v = mp3PeakVerdict({ mp3Tp: -3.7, wavTp: -3.55 });
    expect(v.status).toBe('ok');
    expect(v.encodeDeltaDb).toBeCloseTo(-0.15, 2);
    expect(v.message).toMatch(/within the -1 dBTP ceiling/);
  });

  it('treats exactly the ceiling as compliant, not as a violation', () => {
    expect(mp3PeakVerdict({ mp3Tp: TRUE_PEAK_CEILING_DBTP, wavTp: -2 }).status).toBe('ok');
    expect(mp3PeakVerdict({ mp3Tp: -0.99, wavTp: -2 }).status).toBe('hot');
  });

  it('blames the MASTER when both are hot, and says re-encoding will not help', () => {
    // This is the real catalogue case: யாழ்ப்பாண வீதி-வாசம் at -0.08 dBTP came
    // from a source that was never peak limited.
    const v = mp3PeakVerdict({ mp3Tp: -0.08, wavTp: -0.2 });
    expect(v.status).toBe('hot');
    expect(v.message).toMatch(/so is the master/);
    expect(v.message).toMatch(/Re-master/);
    expect(v.message).not.toMatch(/encoder/i);
  });

  it('flags a hot MP3 from a clean master as UNEXPECTED, citing the measured bound', () => {
    const v = mp3PeakVerdict({ mp3Tp: -0.5, wavTp: -3.0 });
    expect(v.status).toBe('hot');
    expect(v.message).toMatch(/even though the master is not/);
    expect(v.message).toContain(String(MAX_OBSERVED_ENCODE_RISE_DB));
  });

  it('is honest when the MP3 could not be measured', () => {
    for (const bad of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const v = mp3PeakVerdict({ mp3Tp: bad as number | null, wavTp: -3 });
      expect(v.status).toBe('unknown');
      expect(v.encodeDeltaDb).toBeNull();
      expect(v.message).toMatch(/unverified/);
    }
  });

  it('still judges the MP3 when the master peak is unknown', () => {
    // Older jobs predate the stored true peak; the delivered file can still be
    // checked, it just cannot be attributed.
    const ok = mp3PeakVerdict({ mp3Tp: -3.4, wavTp: null });
    expect(ok.status).toBe('ok');
    expect(ok.encodeDeltaDb).toBeNull();
    const hot = mp3PeakVerdict({ mp3Tp: -0.4, wavTp: null });
    expect(hot.status).toBe('hot');
  });
});

describe('download filenames follow the KEY, not a hardcoded extension', () => {
  it('an MP3 key downloads as .mp3, a WAV key as .wav', () => {
    // Hardcoding .wav was harmless while the module produced only WAVs. It
    // would now hand back an MP3 named .wav — refused by most players, and
    // wrong the moment it is uploaded anywhere.
    expect(extensionFor('audio/mastering/x-master-14LUFS.mp3')).toBe('.mp3');
    expect(extensionFor('audio/mastering/x-master-14LUFS.wav')).toBe('.wav');
  });

  it('falls back to .wav for anything unrecognised — every legacy key is a WAV', () => {
    expect(extensionFor('audio/mastering/no-extension')).toBe('.wav');
    expect(extensionFor('audio/mastering/x.flac')).toBe('.wav');
  });

  it('the de-noised default carries the right extension', () => {
    expect(downloadFilename('audio/mastering/1700_ab_song-master-14LUFS.mp3')).toMatch(/\.mp3$/);
    expect(downloadFilename('audio/mastering/1700_ab_song-master-14LUFS.wav')).toMatch(/\.wav$/);
  });

  it('a titled download keeps Tamil and takes the extension it is given', () => {
    const wav = sanitizeMasterFilename('அம்மம்மா என் அகமே (Master -14 LUFS)', '.wav');
    const mp3 = sanitizeMasterFilename('அம்மம்மா என் அகமே (Master -14 LUFS)', '.mp3');
    expect(wav).toBe('அம்மம்மா என் அகமே (Master -14 LUFS).wav');
    expect(mp3).toBe('அம்மம்மா என் அகமே (Master -14 LUFS).mp3');
  });

  it('still defaults to .wav when no extension is passed (existing callers)', () => {
    expect(sanitizeMasterFilename('Song')).toBe('Song.wav');
  });

  it('does not leave a doubled extension when the title already ends in one', () => {
    expect(sanitizeMasterFilename('Song.mp3', '.mp3')).toBe('Song.mp3');
    expect(sanitizeMasterFilename('Song.wav', '.mp3')).toBe('Song.mp3');
  });
});
