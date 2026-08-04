/**
 * Publishing a mastered web MP3 to the site's own audio path.
 *
 * WHY THIS EXISTS. The module ends one step short of where the file is needed.
 * It ingests a lossless WAV, masters it, and (since 2026-08-04) exports a
 * measured 192k MP3 — and then hands that MP3 back as a download, so putting it
 * on tamilagaval.com means saving it locally, renaming it in Tamil by hand, and
 * re-uploading it to `audio/poem-music/`. Measured 2026-08-04: the site serves
 * 17 songs while the channel has published ~58, and nothing new has landed in
 * that prefix since 2026-06-09. The round trip is the friction.
 *
 * Both prefixes live in the SAME bucket (`tamil-web-media`), so this is a
 * server-side CopyObject: no egress, no bytes through the SSR Lambda, instant
 * at 8 MB.
 *
 * ⚠️ WHAT THIS DOES **NOT** DO — and the UI must say so. Copying the object
 * stages the audio at its canonical path. It does not create the song's
 * DynamoDB record, and `/songs` is build-time SSG, so nothing appears on the
 * live site until a content record points at the file AND Amplify rebuilds.
 * Claiming "published to the site" for a file that is merely present in a
 * bucket would be the same class of overstatement this module has spent four
 * PRs removing from its own report.
 *
 * Pure and I/O-free, mirroring master-archive.ts: this decides WHERE the MP3
 * belongs and WHETHER it may go there; the service does the S3 work.
 */

import type { MasterJob } from '@/types/masterJob';
import { sanitizeMasterTitle } from '@/lib/mastering-storage';
import { mp3PeakVerdict } from '@/lib/master-mp3';

/** Where the site's player reads song audio from. CDN-served via CloudFront. */
export const SITE_AUDIO_PREFIX = 'audio/poem-music/';

/** What the delivered file is. Set explicitly so the copy cannot inherit `audio/wav`. */
export const SITE_AUDIO_CONTENT_TYPE = 'audio/mpeg';

/** Why a master cannot be published. Each is a normal outcome, not an error. */
export type PublishRefusal =
  | 'not-done'
  | 'not-saved'
  | 'no-title'
  | 'no-mp3'
  | 'peak-hot'
  | 'already-published';

export type PublishPlan =
  | { ok: true; mp3Key: string; publishKey: string }
  | { ok: false; reason: PublishRefusal };

/**
 * Destination key from the admin's title.
 *
 * The site prefix is HUMAN-NAMED in Tamil (`அந்தி மேகமே.mp3`) while the
 * mastering workspace is machine-named (`1780067292588_ab3f_take-master-14LUFS
 * .mp3`). Publishing under the workspace name would put a filename no one can
 * read into the catalogue the site serves — the same orphan problem the save
 * feature exists to prevent, but this time on a public path.
 *
 * `sanitizeMasterTitle` strips control characters, quotes and path separators,
 * so a title cannot escape the prefix. Tamil survives it.
 */
export function publishKeyForTitle(title: string | null | undefined): string | null {
  const clean = sanitizeMasterTitle(title ?? '')
    .replace(/\.(mp3|wave?)$/i, '')
    .trim();
  return clean ? `${SITE_AUDIO_PREFIX}${clean}.mp3` : null;
}

/**
 * Decide whether this job's web MP3 may be published, and where.
 *
 * Publishes the MP3, never the WAV: the site serves 192k MP3 because the
 * audience is ~70% India / ~10% Sri Lanka on weak mobile links, and a 70 MB WAV
 * was the original cause of "the first songs wouldn't play".
 *
 * THE PEAK GATE IS THE POINT. A measured violation refuses outright — this
 * module's documented value is peak safety, and the two catalogue songs sitting
 * above -1 dBTP are exactly the files that would have been caught here. An
 * UNMEASURED peak does not refuse, matching the readiness rule: a check that
 * never ran is not a failure, and the caller surfaces it as a caveat.
 */
export function planPublish(job: MasterJob): PublishPlan {
  if (job.status !== 'done') return { ok: false, reason: 'not-done' };
  // Save is where the title is persisted, and the title is the filename. An
  // unsaved job also carries a 24h ttl — publishing from a record about to
  // expire would leave a public file whose provenance vanishes the next day.
  if (!job.savedAt) return { ok: false, reason: 'not-saved' };
  if (job.publishedAt) return { ok: false, reason: 'already-published' };
  if (!job.mp3Key) return { ok: false, reason: 'no-mp3' };
  if (mp3PeakVerdict({ mp3Tp: job.mp3Tp, wavTp: job.afterTp }).status === 'hot') {
    return { ok: false, reason: 'peak-hot' };
  }
  const publishKey = publishKeyForTitle(job.title);
  if (!publishKey) return { ok: false, reason: 'no-title' };
  return { ok: true, mp3Key: job.mp3Key, publishKey };
}

/** Operator-facing wording for a refusal. Says what to DO wherever there is something. */
export function publishRefusalMessage(reason: PublishRefusal): string {
  switch (reason) {
    case 'no-title':
      return 'Name this master before publishing — the site names audio by song, in Tamil, not by job id.';
    case 'not-saved':
      return 'Save this master before publishing it to the site.';
    case 'no-mp3':
      return 'This job has no web MP3. Re-master it — the MP3 export runs automatically.';
    case 'peak-hot':
      return 'This MP3 peaks above -1 dBTP. Re-master rather than publish it — re-encoding will not fix a hot master.';
    case 'already-published':
      return 'Already published to the site.';
    case 'not-done':
      return 'Only a finished master can be published.';
  }
}
