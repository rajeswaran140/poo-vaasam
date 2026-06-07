/** @jest-environment node */
/**
 * deriveDurationSeconds — pick a song's duration: prefer reading the WAV header
 * (via an injected S3 range reader), else fall back to a matched YouTube video's
 * ISO duration, else undefined. The S3 reader is injected so this stays pure.
 */

import { deriveDurationSeconds } from '@/lib/derive-song-duration';

/** A minimal valid 44.1k/16/stereo WAV header for `dataSize` audio bytes. */
function wavHeader(dataSize: number): Uint8Array {
  const byteRate = 44100 * 2 * 2;
  const w32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const w16 = (n: number) => [n & 255, (n >> 8) & 255];
  const s = (t: string) => [...t].map((c) => c.charCodeAt(0));
  return new Uint8Array([
    ...s('RIFF'), ...w32(36 + dataSize), ...s('WAVE'),
    ...s('fmt '), ...w32(16), ...w16(1), ...w16(2), ...w32(44100), ...w32(byteRate), ...w16(4), ...w16(16),
    ...s('data'), ...w32(dataSize),
  ]);
}

const S3 = 'https://tamil-web-media.s3.us-east-1.amazonaws.com';

it('reads the duration from a WAV header (preferred source)', async () => {
  const readRange = jest.fn().mockResolvedValue(wavHeader(44100 * 2 * 2 * 90)); // 90s
  const secs = await deriveDurationSeconds({ audioUrl: `${S3}/audio/poem-music/x.wav`, readRange });
  expect(secs).toBe(90);
  expect(readRange).toHaveBeenCalledWith('audio/poem-music/x.wav', expect.any(Number));
});

it('decodes the S3 key from a percent-encoded URL', async () => {
  const readRange = jest.fn().mockResolvedValue(wavHeader(44100 * 2 * 2 * 10));
  await deriveDurationSeconds({ audioUrl: `${S3}/audio/poem-music/%E0%AE%85.wav`, readRange });
  expect(readRange).toHaveBeenCalledWith('audio/poem-music/அ.wav', expect.any(Number));
});

it('falls back to the matched YouTube ISO duration for a non-WAV file', async () => {
  const readRange = jest.fn();
  const secs = await deriveDurationSeconds({ audioUrl: `${S3}/audio/x.mp3`, matchedVideoDuration: 'PT4M14S', readRange });
  expect(secs).toBe(254);
  expect(readRange).not.toHaveBeenCalled(); // no range read for non-WAV
});

it('falls back to YouTube when the WAV header is unparseable', async () => {
  const readRange = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])); // not a WAV
  const secs = await deriveDurationSeconds({ audioUrl: `${S3}/a.wav`, matchedVideoDuration: 'PT3M', readRange });
  expect(secs).toBe(180);
});

it('falls back to YouTube when the range read throws', async () => {
  const readRange = jest.fn().mockRejectedValue(new Error('s3 down'));
  const secs = await deriveDurationSeconds({ audioUrl: `${S3}/a.wav`, matchedVideoDuration: 'PT2M', readRange });
  expect(secs).toBe(120);
});

it('returns undefined when nothing yields a duration', async () => {
  const readRange = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  expect(await deriveDurationSeconds({ audioUrl: `${S3}/a.mp3`, readRange })).toBeUndefined();
});
