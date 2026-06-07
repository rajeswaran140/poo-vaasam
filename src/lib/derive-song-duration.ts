/**
 * deriveDurationSeconds — choose a song's duration without a media library.
 *
 * Order of preference:
 *  1. The WAV header (read via an injected S3 range reader — only the first few
 *     hundred bytes), since the master audio is the source of truth.
 *  2. The matched YouTube video's ISO-8601 duration (when the song was auto-linked).
 *  3. undefined — the song still publishes; duration can be backfilled later.
 *
 * The S3 reader is injected so this stays pure and unit-testable (the publish
 * route wires in S3Operations.getRange).
 */

import { parseWavDurationSeconds } from './wav-duration';
import { iso8601DurationToSeconds } from './youtube-shorts';

/** Enough bytes to cover RIFF + fmt + (filler chunks) + data header. */
const WAV_HEADER_BYTES = 512;

export interface DeriveDurationInput {
  audioUrl: string;
  /** ISO-8601 duration of a matched YouTube video, if any. */
  matchedVideoDuration?: string;
  /** Reads bytes [0, end] of an S3 object key → header bytes. */
  readRange: (key: string, end: number) => Promise<Uint8Array>;
}

/** Extract the object key from a public S3 URL (decoding percent-escapes). */
function s3KeyFromUrl(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, '')) || null;
  } catch {
    return null;
  }
}

export async function deriveDurationSeconds(input: DeriveDurationInput): Promise<number | undefined> {
  const { audioUrl, matchedVideoDuration, readRange } = input;

  if (/\.wav(\?|$)/i.test(audioUrl)) {
    const key = s3KeyFromUrl(audioUrl);
    if (key) {
      try {
        const bytes = await readRange(key, WAV_HEADER_BYTES);
        const secs = parseWavDurationSeconds(bytes);
        if (secs !== null && secs > 0) return secs;
      } catch {
        /* fall through to the YouTube duration */
      }
    }
  }

  const fromYouTube = iso8601DurationToSeconds(matchedVideoDuration);
  return fromYouTube !== null && fromYouTube > 0 ? fromYouTube : undefined;
}
