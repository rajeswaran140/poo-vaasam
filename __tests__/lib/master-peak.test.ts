/** @jest-environment node */
/**
 * Peak-only normalisation, for a karaoke bed.
 *
 * WHY IT EXISTS, measured on the real Sevvanthi bed 2026-09-16: ffmpeg's
 * `loudnorm` reports `Normalization Type: Dynamic` at -14, -18 and -20 alike —
 * even with `linear=true` requested — and misses the target it was given by
 * ~0.7 LU. There is no integrated target at which the existing pipeline leaves
 * a bed's dynamics alone. Peak-only was the only option tested that preserved
 * -20.2 LUFS / 6.4 LU exactly.
 *
 * See docs/superpowers/specs/2026-09-16-karaoke-master-target-design.md.
 */
import {
  karaokeMasterKeyFor, isKaraokeMasterKey, planPeakGain, buildPeakArgs,
  isValidNormalizationMode, peakRefusalMessage,
  PEAK_CEILING_DBTP, MAX_PEAK_GAIN_DB, KARAOKE_MP3_BITRATE,
} from '@/lib/master-peak';
import { isMasterKey } from '@/lib/loudness-measure';

describe('karaoke keys', () => {
  it('names the bed beside its source', () => {
    expect(karaokeMasterKeyFor('audio/mastering/1_a_song.wav'))
      .toBe('audio/mastering/1_a_song-karaoke-1dBTP.wav');
  });

  it('replaces the extension rather than appending to it', () => {
    expect(karaokeMasterKeyFor('audio/mastering/x.WAV')).toBe('audio/mastering/x-karaoke-1dBTP.wav');
  });

  it('recognises its own output and nothing else', () => {
    expect(isKaraokeMasterKey('audio/mastering/x-karaoke-1dBTP.wav')).toBe(true);
    expect(isKaraokeMasterKey('audio/mastering/x-master-14LUFS.wav')).toBe(false);
    expect(isKaraokeMasterKey('audio/mastering/x.wav')).toBe(false);
  });

  /**
   * ⚠️ `isMasterKey` answers TWO questions: "is this already a mastering
   * output?" (the re-master guard) and "is this a valid source for a video,
   * short or YouTube upload?" (a positive requirement). If it starts matching
   * karaoke keys, beds become eligible for YouTube renders — the opposite of
   * what this mode is for. The re-master guards compose the two predicates
   * instead; this test is what stops someone widening the shared one.
   */
  it('is NOT matched by isMasterKey', () => {
    expect(isMasterKey(karaokeMasterKeyFor('audio/mastering/x.wav'))).toBe(false);
  });

  it('and a loudness master is not mistaken for a bed', () => {
    expect(isKaraokeMasterKey('audio/mastering/x-master-14LUFS.wav')).toBe(false);
    expect(isMasterKey('audio/mastering/x-master-14LUFS.wav')).toBe(true);
  });
});

describe('the gain', () => {
  it('lifts a quiet bed to the ceiling', () => {
    expect(planPeakGain(-7.5)).toEqual({ ok: true, gainDb: 6.5 });
  });

  it('attenuates one that is over it', () => {
    expect(planPeakGain(0.5)).toEqual({ ok: true, gainDb: -1.5 });
  });

  /**
   * The Sevvanthi bed measured exactly -1.0 dBTP. A no-op pass still RUNS, so
   * the output is a real 24-bit file this pipeline wrote rather than a copy,
   * and the job record describes something that actually happened.
   */
  it('applies 0.00 dB rather than refusing a bed already at the ceiling', () => {
    expect(planPeakGain(PEAK_CEILING_DBTP)).toEqual({ ok: true, gainDb: 0 });
  });

  it('refuses a boost that means the wrong file was uploaded', () => {
    const r = planPeakGain(PEAK_CEILING_DBTP - MAX_PEAK_GAIN_DB - 0.1);
    expect(r).toMatchObject({ ok: false, reason: 'needs-too-much-gain' });
    expect(peakRefusalMessage('needs-too-much-gain', 12.1)).toMatch(/12\.1/);
  });

  it('allows exactly the maximum boost', () => {
    expect(planPeakGain(PEAK_CEILING_DBTP - MAX_PEAK_GAIN_DB)).toEqual({ ok: true, gainDb: MAX_PEAK_GAIN_DB });
  });

  it('refuses an unreadable peak rather than assuming one', () => {
    expect(planPeakGain(null)).toEqual({ ok: false, reason: 'unreadable-peak' });
    expect(planPeakGain(Number.NaN)).toEqual({ ok: false, reason: 'unreadable-peak' });
  });

  it('every refusal has wording', () => {
    for (const r of ['unreadable-peak', 'needs-too-much-gain'] as const) {
      expect(peakRefusalMessage(r, 20).trim().length).toBeGreaterThan(0);
    }
  });
});

describe('the ffmpeg args', () => {
  const args = buildPeakArgs({ inPath: '/tmp/in.wav', outPath: '/tmp/out.wav', gainDb: 6.5 });

  /** The whole promise of the mode: level moves, nothing else does. */
  it('is ONE gain change and nothing else', () => {
    expect(args[args.indexOf('-af') + 1]).toBe('volume=6.50dB');
    expect(args.join(' ')).not.toContain('loudnorm');
    expect(args.join(' ')).not.toContain('alimiter');
    expect(args.join(' ')).not.toContain('acompressor');
    expect(args.join(' ')).not.toContain('dynaudnorm');
  });

  it('writes the same format as the loudness path', () => {
    expect(args[args.indexOf('-ar') + 1]).toBe('48000');
    expect(args[args.indexOf('-c:a') + 1]).toBe('pcm_s24le');
  });

  it('renders a no-op gain explicitly, so the pass is not optimised away', () => {
    const a = buildPeakArgs({ inPath: '/i', outPath: '/o', gainDb: 0 });
    expect(a[a.indexOf('-af') + 1]).toBe('volume=0.00dB');
  });

  it('renders attenuation with its sign', () => {
    const a = buildPeakArgs({ inPath: '/i', outPath: '/o', gainDb: -1.5 });
    expect(a[a.indexOf('-af') + 1]).toBe('volume=-1.50dB');
  });
});

describe('the mode', () => {
  it('accepts only the two real values', () => {
    expect(isValidNormalizationMode('loudness')).toBe(true);
    expect(isValidNormalizationMode('peak')).toBe(true);
    for (const v of ['karaoke', 'Peak', '', null, undefined, 0, {}]) {
      expect(isValidNormalizationMode(v)).toBe(false);
    }
  });

  it('promises buyers the bitrate the karaoke page advertises', () => {
    expect(KARAOKE_MP3_BITRATE).toBe('320k');
  });
});
