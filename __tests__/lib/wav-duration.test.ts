/** @jest-environment node */
/**
 * parseWavDurationSeconds — derive a song's length from a WAV file's RIFF header
 * (the first few hundred bytes), so the publish flow can set audioDuration
 * without a heavy media library or a headless browser. duration = data-chunk
 * size / fmt byteRate.
 */

import { parseWavDurationSeconds } from '@/lib/wav-duration';

/** Build a minimal canonical WAV header (+ optional chunks before `data`). */
function buildWav(opts: {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataSize: number;
  fmtExtensionBytes?: number; // non-PCM fmt chunks carry a cbSize extension
  extraChunks?: { id: string; size: number }[]; // e.g. LIST/fact between fmt and data
  truncateBeforeData?: boolean; // omit the data chunk header (simulate a short range read)
}): Uint8Array {
  const { sampleRate, channels, bitsPerSample, dataSize } = opts;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const fmtBody = 16 + (opts.fmtExtensionBytes ?? 0);
  const chunks: number[] = [];
  const w32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const w16 = (n: number) => [n & 255, (n >> 8) & 255];
  const str = (s: string) => [...s].map((c) => c.charCodeAt(0));

  // fmt chunk
  chunks.push(...str('fmt '), ...w32(fmtBody));
  chunks.push(...w16(1), ...w16(channels), ...w32(sampleRate), ...w32(byteRate), ...w16(channels * (bitsPerSample / 8)), ...w16(bitsPerSample));
  if (opts.fmtExtensionBytes) chunks.push(...new Array(opts.fmtExtensionBytes).fill(0));

  // any filler chunks between fmt and data
  for (const c of opts.extraChunks ?? []) {
    chunks.push(...str(c.id), ...w32(c.size), ...new Array(c.size + (c.size % 2)).fill(0));
  }

  if (!opts.truncateBeforeData) chunks.push(...str('data'), ...w32(dataSize));

  const riffSize = 4 + chunks.length;
  return new Uint8Array([...str('RIFF'), ...w32(riffSize), ...str('WAVE'), ...chunks]);
}

describe('parseWavDurationSeconds', () => {
  it('computes duration for a canonical 44.1k/16-bit/stereo file', () => {
    // byteRate = 44100*2*2 = 176400; 180s of audio = 31,752,000 bytes
    const wav = buildWav({ sampleRate: 44100, channels: 2, bitsPerSample: 16, dataSize: 176400 * 180 });
    expect(parseWavDurationSeconds(wav)).toBe(180);
  });

  it('handles mono 8-bit', () => {
    // byteRate = 8000*1*1 = 8000; 12s = 96000 bytes
    const wav = buildWav({ sampleRate: 8000, channels: 1, bitsPerSample: 8, dataSize: 96000 });
    expect(parseWavDurationSeconds(wav)).toBe(12);
  });

  it('finds the data chunk past a fmt extension', () => {
    const wav = buildWav({ sampleRate: 48000, channels: 2, bitsPerSample: 24, dataSize: 48000 * 2 * 3 * 30, fmtExtensionBytes: 2 });
    expect(parseWavDurationSeconds(wav)).toBe(30);
  });

  it('skips LIST/fact chunks sitting between fmt and data', () => {
    const byteRate = 44100 * 2 * 2;
    const wav = buildWav({
      sampleRate: 44100, channels: 2, bitsPerSample: 16, dataSize: byteRate * 60,
      extraChunks: [{ id: 'fact', size: 4 }, { id: 'LIST', size: 26 }],
    });
    expect(parseWavDurationSeconds(wav)).toBe(60);
  });

  it('rounds to the nearest whole second', () => {
    const byteRate = 44100 * 2 * 2;
    const wav = buildWav({ sampleRate: 44100, channels: 2, bitsPerSample: 16, dataSize: Math.round(byteRate * 187.6) });
    expect(parseWavDurationSeconds(wav)).toBe(188);
  });

  it('returns null for non-RIFF data (e.g. an MP3/ID3 header)', () => {
    expect(parseWavDurationSeconds(new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('returns null when the data chunk is beyond the supplied window (truncated)', () => {
    const wav = buildWav({ sampleRate: 44100, channels: 2, bitsPerSample: 16, dataSize: 1000, truncateBeforeData: true });
    expect(parseWavDurationSeconds(wav)).toBeNull();
  });

  it('returns null when byteRate is 0 (no divide-by-zero)', () => {
    const wav = buildWav({ sampleRate: 0, channels: 0, bitsPerSample: 0, dataSize: 1000 });
    expect(parseWavDurationSeconds(wav)).toBeNull();
  });

  it('returns null for an empty / tiny buffer', () => {
    expect(parseWavDurationSeconds(new Uint8Array([]))).toBeNull();
    expect(parseWavDurationSeconds(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
