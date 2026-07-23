/**
 * Storage rules for the Sound Engineering / Mastering module. Pure — no AWS.
 *
 * Mastering works on *working files*, not published media: a SUNO WAV comes in,
 * a mastered WAV goes out, both get pulled into Adobe and neither is ever served
 * to a visitor. So they live under their own prefix, away from the published
 * `audio/poem-music/` catalogue, and the download route will only presign keys
 * that sit inside it (an admin session must not be able to presign arbitrary
 * bucket objects).
 */

/** Everything this module reads or writes lives here. */
export const MASTERING_PREFIX = 'audio/mastering/';

/** Master the lossless source — see the `music-lab-mastering` admin doc. */
export const ACCEPTED_UPLOAD_TYPES = ['audio/wav', 'audio/x-wav', 'audio/wave'] as const;

/**
 * 500 MB. A 24-bit/48 kHz stereo WAV runs ~17 MB/minute, so this clears a
 * 25-minute source while still refusing an accidental video drop.
 */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/** True if the key is inside the mastering workspace. */
export function isMasteringKey(key: string): boolean {
  return (
    typeof key === 'string' &&
    key.startsWith(MASTERING_PREFIX) &&
    !key.includes('..') &&
    key.length > MASTERING_PREFIX.length &&
    key.length <= 1024
  );
}

/**
 * A collision-proof key for an uploaded source. The original filename is kept
 * (sanitised) so the workspace stays readable, prefixed with a timestamp+nonce
 * so re-uploading the same song never clobbers an earlier attempt.
 *
 * `now`/`nonce` are injected rather than read from Date/Math so this stays pure
 * and testable.
 */
export function masteringUploadKey(filename: string, now: number, nonce: string): string {
  // Dots are stripped from the stem, not just slashes: a name like
  // "../../x.wav" would otherwise survive as ".._.._x" and produce a key that
  // isMasteringKey() then rejects — an upload you could never download back.
  // The extension is appended by us, so the stem never needs a dot.
  const safe =
    filename
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-zA-Z0-9-]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'source';
  // A source called "song-master.wav" (or "song-master-14LUFS.wav") would
  // otherwise generate a key matching the re-master guard (isMasterKey in
  // loudness-measure), so the file would upload in full and then be permanently
  // un-masterable. That guard keys off the literal "-master", so swapping every
  // occurrence for "_master" makes a false match impossible rather than merely
  // unlikely. The name still reads the same.
  return `${MASTERING_PREFIX}${now}_${nonce}_${safe.replace(/-master/gi, '_master')}.wav`;
}

/** Filename to offer the browser when downloading a key. */
export function downloadFilename(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1) || 'master.wav';
}
