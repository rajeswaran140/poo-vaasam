/** @jest-environment node */
/**
 * loudness-measure — parses real ffmpeg ebur128+astats / loudnorm output.
 * The embedded fixtures are REAL ffmpeg stderr shapes; the live test re-validates
 * end-to-end against ffmpeg when it's on PATH (auto-skips in CI).
 */

import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseMeasurement, badgeAndVerdict, parseLoudnormStats, buildPass2Loudnorm,
  isValidTarget, masterKeyFor, isMasterKey, parseSourceInfo,
  parseNormalizationType,
} from '@/lib/loudness-measure';

const hasFfmpeg = (() => {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true; } catch { return false; }
})();

// Real ebur128 shape: per-frame lines (with I:/LRA:/TPK:) THEN a Summary block.
const STDERR = `
[Parsed_ebur128_0 @ 0x1] t: 0.1  TARGET:-23 LUFS  M:-120.7 S:-120.7  I: -70.0 LUFS  LRA:  0.0 LU  TPK: -3.0 -3.0 dBFS
[Parsed_ebur128_0 @ 0x1] t: 2.0  TARGET:-23 LUFS  M: -9.0 S: -9.0    I:  -9.0 LUFS  LRA:  2.0 LU  TPK: -0.5 -0.5 dBFS
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:          -9.0 LUFS
    Threshold: -19.0 LUFS

  Loudness range:
    LRA:         3.2 LU

  True peak:
    Peak:       -0.4 dBFS
[Parsed_astats_1 @ 0x2] Peak level dB: -0.400000
[Parsed_astats_1 @ 0x2] RMS level dB: -7.900000
[Parsed_astats_1 @ 0x2] Flat factor: 0.000000
`;

describe('parseMeasurement', () => {
  it('reads the SUMMARY values, not the per-frame spam', () => {
    const r = parseMeasurement(STDERR, -14);
    expect(r.metrics.lufs).toBe(-9.0);      // NOT -70 (the first per-frame I:)
    expect(r.metrics.lra).toBe(3.2);
    expect(r.metrics.truePeak).toBe(-0.4);
    expect(r.metrics.crest).toBe(7.5);      // -0.4 − (-7.9)
    expect(r.metrics.flatFactor).toBe(0);
  });

  it('classifies the hot + clip-risk take (true-peak above -1)', () => {
    const r = parseMeasurement(STDERR, -14);
    expect(r.badge).toBe('+5 LU hot');      // -9 − (-14) = +5
    expect(r.verdict).toBe('clip-risk');    // truePeak -0.4 > -1
  });
});

describe('badgeAndVerdict precedence', () => {
  const base = { lufs: -14, truePeak: -2, flatFactor: 0, crest: 9 };
  it('on-target within ±1 LU', () => {
    expect(badgeAndVerdict({ ...base, lufs: -13.5 }).badge).toBe('on-target (-14)');
    expect(badgeAndVerdict({ ...base, lufs: -13.5 }).verdict).toBe('ok');
  });
  it('hot / quiet badges', () => {
    expect(badgeAndVerdict({ ...base, lufs: -11 }).badge).toBe('+3 LU hot');
    expect(badgeAndVerdict({ ...base, lufs: -18 }).badge).toBe('4 LU quiet');
  });
  it('clip-risk wins over hot/quiet (true-peak or flat factor)', () => {
    expect(badgeAndVerdict({ ...base, lufs: -11, truePeak: -0.5 }).verdict).toBe('clip-risk');
    expect(badgeAndVerdict({ ...base, lufs: -11, flatFactor: 1.2 }).verdict).toBe('clip-risk');
  });
  it('squashed when crest < 6 and not clipping', () => {
    expect(badgeAndVerdict({ ...base, lufs: -14, crest: 4 }).verdict).toBe('squashed');
  });
});

describe('loudnorm pass-1 parsing', () => {
  const json = `[Parsed_loudnorm_0 @ 0x1]
{
\t"input_i" : "-22.05",
\t"input_tp" : "-21.99",
\t"input_lra" : "0.00",
\t"input_thresh" : "-32.05",
\t"target_offset" : "-0.05"
}`;
  it('extracts the measured values', () => {
    const s = parseLoudnormStats(json)!;
    expect(s).toMatchObject({ input_i: -22.05, input_tp: -21.99, input_lra: 0, input_thresh: -32.05, target_offset: -0.05 });
  });
  it('builds a linear pass-2 filter from them', () => {
    const f = buildPass2Loudnorm(parseLoudnormStats(json)!, -14);
    expect(f).toContain('loudnorm=I=-14:TP=-1:LRA=11');
    expect(f).toContain('measured_I=-22.05');
    expect(f).toContain('offset=-0.05');
    expect(f).toContain('linear=true');
  });
  it('returns null on junk', () => {
    expect(parseLoudnormStats('no json here')).toBeNull();
  });
});

// REAL ffmpeg stderr for `-i in.wav -af loudnorm=…`. Note the TWO "Stream #0:0:
// Audio:" lines — the input's 44100 Hz and, after "Stream mapping:", loudnorm's
// internal 192000 Hz working rate. This fixture exists to keep that trap covered.
const HEADER_STDERR = `Guessed Channel Layout for Input Stream #0.0 : stereo
Input #0, wav, from '/tmp/master-x/in.wav':
  Metadata:
    encoder         : Lavf58.76.100
  Duration: 00:03:42.10, bitrate: 1411 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, stereo, s16, 1411 kb/s
Stream mapping:
  Stream #0:0 -> #0:0 (pcm_s16le (native) -> pcm_s16le (native))
Output #0, null, to 'pipe:':
  Stream #0:0: Audio: pcm_s16le, 192000 Hz, stereo, s16, 6144 kb/s
[Parsed_loudnorm_0 @ 0x1]
{
	"input_i" : "-9.75"
}
`;

describe('parseSourceInfo', () => {
  it('reads the INPUT header, not loudnorm\'s 192 kHz output line', () => {
    // The whole reason this parser is region-scoped: a naive search of the log
    // finds the output stream first/last and reports every source as 192 kHz.
    const info = parseSourceInfo(HEADER_STDERR)!;
    expect(info.sampleRate).toBe(44100);
    expect(info.channels).toBe(2);
    expect(info.channelLayout).toBe('stereo');
    expect(info.bitDepth).toBe(16);
    expect(info.codec).toBe('pcm_s16le');
    expect(info.durationSec).toBe(222.1); // 00:03:42.10
  });

  it('takes bit depth from the codec, not the decoded sample format', () => {
    // ffmpeg decodes 24-bit PCM into an s32 container and prints "s32 (24 bit)";
    // reading the sample format would report a 24-bit WAV as 32-bit.
    const info = parseSourceInfo(
      HEADER_STDERR.replace(
        'pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, stereo, s16, 1411 kb/s',
        'pcm_s24le ([1][0][0][0] / 0x0001), 48000 Hz, mono, s32 (24 bit), 1152 kb/s'
      )
    )!;
    expect(info.bitDepth).toBe(24);
    expect(info.sampleRate).toBe(48000);
    expect(info.channels).toBe(1);
  });

  it('maps surround layouts and ffmpeg\'s unnamed "N channels" fallback', () => {
    const of = (stream: string) =>
      parseSourceInfo(HEADER_STDERR.replace(/pcm_s16le \(\[1\]\[0\]\[0\]\[0\] \/ 0x0001\), 44100 Hz, stereo, s16, 1411 kb\/s/, stream))!;
    expect(of('pcm_s24le ([1][0][0][0] / 0x0001), 48000 Hz, 5.1, s32 (24 bit), 6912 kb/s').channels).toBe(6);
    expect(of('pcm_s16le, 48000 Hz, 3 channels, s16, 2304 kb/s').channels).toBe(3);
    // An unknown layout name must read as "unknown", never as a wrong number.
    expect(of('pcm_s16le, 48000 Hz, hexadecagonal, s16, 2304 kb/s').channels).toBeNull();
  });

  it('returns null when there is no input header, and survives a partial one', () => {
    expect(parseSourceInfo('')).toBeNull();
    expect(parseSourceInfo(STDERR)).toBeNull(); // a filter-only log
    const noDuration = parseSourceInfo(HEADER_STDERR.replace(/ +Duration:.*\n/, ''))!;
    expect(noDuration.durationSec).toBeNull();
    expect(noDuration.sampleRate).toBe(44100); // the rest still reads
  });
});

(hasFfmpeg ? describe : describe.skip)('live ffmpeg end-to-end', () => {
  function run(filter: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'lm-'));
    try {
      const r = spawnSync('ffmpeg', [
        '-hide_banner', '-nostats', '-f', 'lavfi',
        '-i', 'sine=frequency=1000:duration=4:sample_rate=48000,volume=0.5,aformat=channel_layouts=stereo',
        '-af', filter, '-f', 'null', '-',
      ], { encoding: 'utf8' });
      return `${r.stdout ?? ''}${r.stderr ?? ''}`;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('parses a real measurement pass', () => {
    const r = parseMeasurement(run('ebur128=peak=true,astats=metadata=1:measure_perchannel=0'), -14);
    expect(Number.isFinite(r.metrics.lufs)).toBe(true);
    expect(r.metrics.lufs).toBeLessThan(0);
    expect(Number.isFinite(r.metrics.truePeak)).toBe(true);
    expect(r.metrics.lufs).toBeGreaterThan(-40); // a -6 dBFS tone is nowhere near silence
  });

  it('parses a real loudnorm pass-1 JSON', () => {
    const s = parseLoudnormStats(run('loudnorm=I=-14:TP=-1:LRA=11:print_format=json'));
    expect(s).not.toBeNull();
    expect(Number.isFinite(s!.input_i)).toBe(true);
  });

  it('reads a real 24-bit/48k WAV header off the worker\'s own pass-1 command', () => {
    // Exercises exactly what master-worker does: write a WAV, run pass 1 against
    // the FILE (not lavfi), parse the header out of that same stderr. This is
    // the test that would catch loudnorm's 192 kHz output line against a real
    // ffmpeg build rather than a fixture.
    const dir = mkdtempSync(join(tmpdir(), 'lm-src-'));
    try {
      const wav = join(dir, 'in.wav');
      spawnSync('ffmpeg', [
        '-hide_banner', '-nostats', '-f', 'lavfi',
        '-i', 'sine=frequency=1000:duration=2:sample_rate=48000',
        '-ac', '2', '-c:a', 'pcm_s24le', '-y', wav,
      ], { encoding: 'utf8' });
      const r = spawnSync('ffmpeg', [
        '-hide_banner', '-nostats', '-i', wav,
        '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-',
      ], { encoding: 'utf8' });

      const info = parseSourceInfo(`${r.stdout ?? ''}${r.stderr ?? ''}`)!;
      expect(info).not.toBeNull();
      expect(info.sampleRate).toBe(48000); // NOT 192000
      expect(info.channels).toBe(2);
      expect(info.bitDepth).toBe(24);
      expect(info.durationSec).toBeCloseTo(2, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('master output naming + guards', () => {
  it('replaces the source extension instead of appending to it', () => {
    expect(masterKeyFor('audio/poem-music/song.wav', -14)).toBe('audio/poem-music/song-master-14LUFS.wav');
    expect(masterKeyFor('audio/poem-music/song.mp3', -14)).toBe('audio/poem-music/song-master-14LUFS.wav');
    expect(masterKeyFor('audio/no-extension', -14)).toBe('audio/no-extension-master-14LUFS.wav');
  });

  it('keeps -14 and -16 masters of one source distinct', () => {
    // Without the target in the name the Apple master silently overwrote the
    // Spotify one — same source, same key.
    expect(masterKeyFor('a/song.wav', -14)).not.toBe(masterKeyFor('a/song.wav', -16));
    expect(masterKeyFor('a/song.wav', -16)).toBe('a/song-master-16LUFS.wav');
    expect(masterKeyFor('a/song.wav', -14.5)).toBe('a/song-master-14_5LUFS.wav');
  });

  it('recognises its own outputs, including the legacy shape', () => {
    expect(isMasterKey(masterKeyFor('a/song.wav', -14))).toBe(true);
    expect(isMasterKey('a/song.wav-master.wav')).toBe(true); // pre-target naming
    expect(isMasterKey('a/song.wav')).toBe(false);
    expect(isMasterKey('a/master-song.wav')).toBe(false);
  });

  it('accepts only numeric targets inside loudnorm range', () => {
    expect(isValidTarget(-14)).toBe(true);
    expect(isValidTarget(-16)).toBe(true);
    expect(isValidTarget(-70)).toBe(true);
    expect(isValidTarget(-5)).toBe(true);
    for (const bad of ['-16', -70.1, -4.9, 0, NaN, Infinity, null, undefined, {}]) {
      expect(isValidTarget(bad)).toBe(false);
    }
  });
});

describe('parseNormalizationType', () => {
  const json = (type: string) => `
[Parsed_loudnorm_0 @ 0x55] 
{
	"input_i" : "-17.90",
	"input_tp" : "-3.55",
	"input_lra" : "6.80",
	"input_thresh" : "-28.10",
	"output_i" : "-14.00",
	"output_tp" : "-3.20",
	"output_lra" : "6.80",
	"output_thresh" : "-24.20",
	"normalization_type" : "${type}",
	"target_offset" : "0.00"
}`;

  it('reads the linear verdict', () => {
    expect(parseNormalizationType(json('linear'))).toBe('linear');
  });

  /**
   * The one that matters: ffmpeg accepts linear=true and then reports "dynamic"
   * when the linear gain would have clipped. Exit status is still 0, so this
   * string is the ONLY signal that the master was compressed.
   */
  it('reads the dynamic fallback ffmpeg reports without erroring', () => {
    expect(parseNormalizationType(json('dynamic'))).toBe('dynamic');
  });

  it('is case-insensitive and rejects anything unexpected', () => {
    expect(parseNormalizationType(json('LINEAR'))).toBe('linear');
    expect(parseNormalizationType(json('sideways'))).toBeNull();
  });

  it('returns null on absent/unparseable output rather than guessing', () => {
    expect(parseNormalizationType('')).toBeNull();
    expect(parseNormalizationType('no json here')).toBeNull();
    expect(parseNormalizationType('{ not: valid json }')).toBeNull();
  });
});
