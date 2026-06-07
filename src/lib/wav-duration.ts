/**
 * wav-duration — derive a WAV file's playing time from its RIFF header bytes.
 *
 * A WAV is `RIFF<size>WAVE` followed by chunks; the `fmt ` chunk carries the
 * byteRate (bytes/second) and the `data` chunk header carries the audio byte
 * count, so duration = dataSize / byteRate. Only the first few hundred bytes are
 * needed, so the publish flow can read them with a single S3 Range request — no
 * media library, no headless browser (both unavailable in the Lambda runtime).
 *
 * Pure + dependency-free so it's exhaustively unit-tested.
 */

function readU32LE(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

/**
 * Returns the WAV's duration in whole seconds, or null if the bytes aren't a
 * WAV, the `fmt `/`data` chunks aren't both present in the supplied window, or
 * the byteRate is 0 (caller should fall back to another duration source).
 */
export function parseWavDurationSeconds(header: Uint8Array): number | null {
  if (header.length < 44) return null;
  if (fourcc(header, 0) !== 'RIFF' || fourcc(header, 8) !== 'WAVE') return null;

  let byteRate: number | null = null;
  let dataSize: number | null = null;

  // Walk chunks starting after "RIFF<size>WAVE" (offset 12). Each chunk is an
  // 8-byte header (4cc + u32 size) followed by `size` bytes, padded to even.
  let offset = 12;
  while (offset + 8 <= header.length) {
    const id = fourcc(header, offset);
    const size = readU32LE(header, offset + 4);
    const bodyStart = offset + 8;

    if (id === 'fmt ' && bodyStart + 16 <= header.length) {
      byteRate = readU32LE(header, bodyStart + 8); // byteRate is at fmt body offset 8
    } else if (id === 'data') {
      dataSize = size;
      break; // everything we need is in or before the data header
    }

    offset = bodyStart + size + (size % 2); // advance past body + pad byte
  }

  if (byteRate === null || dataSize === null || byteRate === 0) return null;
  return Math.round(dataSize / byteRate);
}
