/**
 * Storage rules for the Sound Engineering / Mastering module. Pure — no AWS.
 *
 * Mastering works on *working files*, not published media: a SUNO WAV comes in,
 * a mastered WAV goes out, both get pulled into Adobe and neither is meant for a
 * visitor. So they live under their own prefix, away from the published
 * `audio/poem-music/` catalogue, and the download route will only presign keys
 * that sit inside it (an admin session must not be able to presign arbitrary
 * bucket objects).
 *
 * NB: CloudFront serves the whole bucket by default, so this prefix is NOT
 * private by virtue of living here — it is kept off the public CDN by an
 * explicit bucket-policy Deny (Sid DenyCloudFrontOnMasteringWorkspace).
 */

/** Everything this module reads or writes lives here. */
export const MASTERING_PREFIX = 'audio/mastering/';

/**
 * Reference tracks used as mastering targets by the matchering-worker (Phase
 * 1B). Same private-workspace treatment as MASTERING_PREFIX — the S3 bucket
 * policy's DenyCloudFrontOnMasteringWorkspaceAndReferences Sid covers this
 * prefix explicitly so a reference is never served over the public CDN.
 */
export const REFERENCES_PREFIX = 'audio/references/';

/** Master the lossless source — see the `music-lab-mastering` admin doc. */
export const ACCEPTED_UPLOAD_TYPES = ['audio/wav', 'audio/x-wav', 'audio/wave'] as const;

/**
 * 500 MB. A 24-bit/48 kHz stereo WAV runs ~17 MB/minute, so this clears a
 * 25-minute source while still refusing an accidental video drop.
 */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/**
 * Cover art for the YouTube render. Kept narrow on purpose: these are decoded by
 * ffmpeg inside the worker, so the allow-list is the formats that recipe is
 * known to handle, not "any image".
 */
export const ACCEPTED_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** 25 MB clears a 4000×4000 PNG and still refuses a video dropped by mistake. */
export const MAX_COVER_BYTES = 25 * 1024 * 1024;

/** The stored extension for an accepted cover type. */
export function coverExtensionFor(contentType: string): string | null {
  switch (contentType) {
    case 'image/jpeg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/webp': return '.webp';
    default: return null;
  }
}

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

/** True if the key is inside the references workspace. Mirrors isMasteringKey. */
export function isReferenceKey(key: string): boolean {
  return (
    typeof key === 'string' &&
    key.startsWith(REFERENCES_PREFIX) &&
    !key.includes('..') &&
    key.length > REFERENCES_PREFIX.length &&
    key.length <= 1024
  );
}

/**
 * S3 key for the reference-matched output of a mastering job. Mirrors the
 * naming of masterKeyFor() so the two outputs sit alongside each other in
 * the mastering workspace and the download route recognises both.
 *
 * Example: given s3Key `audio/mastering/song.wav` and referenceId `raj-emo-01`
 * → `audio/mastering/song-matched-raj-emo-01.wav`.
 *
 * referenceId is sanitised down to `[a-zA-Z0-9_-]` so a malformed value can't
 * push the key outside the workspace prefix or collide with an existing file.
 */
export function matchedMasterKeyFor(s3Key: string, referenceId: string): string {
  const stem = s3Key.replace(/\.[a-z0-9]+$/i, '');
  const safeRef = String(referenceId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'unknown';
  return `${stem}-matched-${safeRef}.wav`;
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

/**
 * The same key rules for an uploaded cover image, differing only in extension.
 *
 * Covers live in the mastering workspace rather than the site's image prefix
 * because that prefix is Denied on CloudFront: a cover staged here cannot leak
 * to the CDN before the video it belongs to is published. It also means the
 * worker reads it with the bucket access it already has, and the `-master`
 * neutralisation above applies unchanged, so a file called "cover-master.png"
 * cannot produce a key the re-master guard would later refuse.
 */
export function masteringCoverKey(
  filename: string,
  contentType: string,
  now: number,
  nonce: string,
): string | null {
  const ext = coverExtensionFor(contentType);
  if (!ext) return null;
  return masteringUploadKey(filename, now, nonce).replace(/\.wav$/, ext);
}

/**
 * The default download name for a key when the admin hasn't titled the master.
 * Strips our storage noise — the `<timestamp>_<nonce>_` prefix added on upload —
 * and any leading punctuation a SUNO export leaves behind ("- 01 8"), so the
 * saved file reads as cleanly as the source name allows. Always ends in .wav.
 */
export function downloadFilename(key: string): string {
  const base = key.slice(key.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/i, '');
  const ext = extensionFor(key);
  const cleaned = base
    .replace(/^\d+_[a-z0-9]+_/i, '') // drop the timestamp_nonce_ we prepend
    .replace(/^[^\p{L}\p{N}]+/u, '') // drop leading punctuation from the SUNO stem
    .trim();
  return `${cleaned || 'master'}${ext}`;
}

/**
 * The extension the download should carry, taken from the STORED KEY.
 *
 * Hardcoding `.wav` was fine while the module produced only WAVs; now that it
 * also exports a 192k MP3, a fixed extension would hand the admin an MP3 named
 * `.wav` — a file most players refuse and which would be wrong the moment it
 * was uploaded anywhere. Anything unrecognised falls back to `.wav`, which is
 * what every pre-existing key is.
 */
export function extensionFor(key: string): string {
  return /\.mp3$/i.test(key) ? '.mp3' : '.wav';
}

/**
 * Turn a user-supplied master title into a safe download filename. Unicode
 * letters/marks are kept so Tamil survives (அம்மம்மா என் அகமே); path separators,
 * control characters and quotes are stripped so the value can neither escape a
 * folder nor break out of the Content-Disposition header. Capped, single .wav.
 */
/**
 * Sanitise a DISPLAY title for a saved master.
 *
 * Distinct from `sanitizeMasterFilename`, which is a FILENAME sanitiser: that
 * one always appends `.wav` and falls back to "master" so a download can never
 * be nameless. Running it over a title was a real defect — every saved master
 * in the library ended up called `ஈழத்து_மண்ணே_Tamilagaval.wav`, an extension
 * baked into a human-facing name.
 *
 * This keeps the same safety rules (no control characters, no path separators
 * or quotes) but produces a NAME: no extension, no invented fallback. An empty
 * result is returned as empty so the caller can refuse rather than silently
 * storing "master".
 *
 * The download filename is still built from the title at download time, so the
 * two never need the extension stored.
 */
export function sanitizeMasterTitle(name: string): string {
  return (name ?? '')
    .normalize('NFC')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/["\\/]+/g, ' ')
    .replace(/\.wave?$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function sanitizeMasterFilename(name: string, ext = '.wav'): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[\x00-\x1f\x7f]/g, '') // strip C0 control chars + DEL
    .replace(/["\\/]+/g, ' ') // no quotes or path separators
    .replace(/\s+/g, ' ')
    .replace(/\.(wave?|mp3)$/i, '') // we re-append the extension ourselves
    .trim()
    .slice(0, 120);
  return `${cleaned || 'master'}${ext}`;
}
