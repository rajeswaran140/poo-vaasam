/** @jest-environment node */
import { encodeWav16, limitPeak } from '@/lib/studio-phase0/wav';

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.slice(at, at + n));

describe('encodeWav16', () => {
  it('writes a 44-byte RIFF/WAVE PCM header for 48 kHz stereo 16-bit', () => {
    const frames = 3;
    const bytes = encodeWav16([new Float32Array(frames), new Float32Array(frames)], 48000);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(bytes.byteLength).toBe(44 + frames * 4);
    expect(ascii(bytes, 0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + frames * 4);
    expect(ascii(bytes, 8, 4)).toBe('WAVE');
    expect(ascii(bytes, 12, 4)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(28, true)).toBe(192000);
    expect(v.getUint16(32, true)).toBe(4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(bytes, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(frames * 4);
  });

  it('interleaves L/R and clips to ±1', () => {
    const bytes = encodeWav16([Float32Array.from([1.5, 0.5]), Float32Array.from([-1.5, 0])], 48000);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)])
      .toEqual([32767, -32768, 16384, 0]);
  });
});

describe('limitPeak (final review: overlapping voices clipped before measuring)', () => {
  it('scales a render whose peak is over −1 dBFS down to exactly −1 dBFS, both channels alike', () => {
    const out = limitPeak([Float32Array.from([0.5, 1.8]), Float32Array.from([-0.9, 0])]);
    const ceiling = Math.pow(10, -1 / 20);
    expect(Math.max(...out.flatMap((c) => Array.from(c, Math.abs)))).toBeCloseTo(ceiling, 5);
    expect(out[0][0] / out[1][0]).toBeCloseTo(0.5 / -0.9, 5);
  });

  it('raises a quiet render to −1 dBFS too (smplr renders peaked near −27 dBFS in Chrome)', () => {
    const out = limitPeak([Float32Array.from([0.02, -0.05])]);
    expect(Math.abs(out[0][1])).toBeCloseTo(Math.pow(10, -1 / 20), 5);
    expect(out[0][0] / out[0][1]).toBeCloseTo(0.02 / -0.05, 5);
  });

  it('returns silence unchanged', () => {
    expect(Array.from(limitPeak([new Float32Array(3)])[0])).toEqual([0, 0, 0]);
  });
});
