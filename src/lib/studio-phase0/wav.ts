/**
 * 16-bit PCM WAV encoding for the Composition Studio listening test's renders.
 * Pure: channels in, file bytes out. Samples outside ±1 are clipped, not
 * wrapped. The page uploads the result through the ordinary workspace upload.
 */
export function encodeWav16(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numChannels = channels.length;
  const frames = channels[0]?.length ?? 0;
  const blockAlign = numChannels * 2;
  const dataBytes = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataBytes);
  const v = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));

  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);

  let at = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][f]));
      v.setInt16(at, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      at += 2;
    }
  }
  return bytes;
}
