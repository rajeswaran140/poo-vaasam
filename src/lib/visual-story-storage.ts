/**
 * Storage rules for Visual Story Studio assets. Pure — no AWS.
 *
 * Everything lives in the private mastering workspace
 * (`audio/mastering/visual-story/<vsId>/…`, bucket `tamil-web-media`), which
 * CloudFront denies, so an unreleased story is never public and the existing
 * `mastering/download?mode=play` route can preview it. Keys are ALWAYS built
 * here, from ids that pass the shape guards in `@/types/visualStory`; a key
 * received from a client is only ever compared against `isRefKeyFor`.
 */

import { randomUUID } from 'node:crypto';
import { MASTERING_PREFIX } from '@/lib/mastering-storage';
import { isVsId, isCharId, isCandId } from '@/types/visualStory';

export const VISUAL_STORY_PREFIX = `${MASTERING_PREFIX}visual-story/`;

export const ACCEPTED_REF_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_REF_BYTES = 10 * 1024 * 1024;
export const MAX_REFS_PER_CHARACTER = 4;

const REF_EXTS = ['jpg', 'png', 'webp'] as const;
const CAND_EXTS = ['jpg', 'png', 'mp4'] as const;

/** A picture the admin uploads to a shot: the types Grok takes as a first frame. */
export const ACCEPTED_PICTURE_TYPES = ['image/jpeg', 'image/png'] as const;

/** The stored extension for an accepted shot-picture type, else null. */
export function pictureExtensionFor(contentType: string): 'jpg' | 'png' | null {
  switch (contentType) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    default: return null;
  }
}

/** The stored extension for an accepted reference type, else null. */
export function refExtensionFor(contentType: string): (typeof REF_EXTS)[number] | null {
  switch (contentType) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    default: return null;
  }
}

/** `audio/mastering/visual-story/<vsId>/refs/<charId>/` — throws on a malformed id. */
export function refPrefix(vsId: string, charId: string): string {
  if (!isVsId(vsId)) throw new Error('invalid vsId');
  if (!isCharId(charId)) throw new Error('invalid charId');
  return `${VISUAL_STORY_PREFIX}${vsId}/refs/${charId}/`;
}

/** A fresh, unguessable key for one reference image. */
export function refKey(vsId: string, charId: string, ext: string): string {
  if (!(REF_EXTS as readonly string[]).includes(ext)) throw new Error('invalid reference extension');
  return `${refPrefix(vsId, charId)}${randomUUID()}.${ext}`;
}

/** Key of a candidate's still (`jpg`, or an uploaded `png`), poster (`jpg`) or clip (`mp4`). */
export function candidateKey(vsId: string, candId: string, ext: string): string {
  if (!isVsId(vsId)) throw new Error('invalid vsId');
  if (!isCandId(candId)) throw new Error('invalid candId');
  if (!(CAND_EXTS as readonly string[]).includes(ext)) throw new Error('invalid candidate extension');
  return `${VISUAL_STORY_PREFIX}${vsId}/candidates/${candId}.${ext}`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * True only for a key exactly as `refKey` would build it for THIS story and
 * character: right prefix, one uuid segment, accepted extension. Ids are
 * shape-checked first so the prefix can contain no regex or path surprises.
 */
export function isRefKeyFor(key: unknown, vsId: string, charId: string): boolean {
  if (typeof key !== 'string' || key.length > 1024) return false;
  if (!isVsId(vsId) || !isCharId(charId)) return false;
  const prefix = refPrefix(vsId, charId);
  if (!key.startsWith(prefix)) return false;
  return new RegExp(`^${UUID}\\.(jpg|png|webp)$`).test(key.slice(prefix.length));
}

/**
 * The candidate id and extension of a picture key exactly as `candidateKey`
 * builds it for THIS story (`jpg` or `png` only), else null. Used to confirm an
 * uploaded shot picture: the server minted the key, the client only echoes it.
 */
export function parseUploadedPictureKey(key: unknown, vsId: string): { candId: string; ext: 'jpg' | 'png' } | null {
  if (typeof key !== 'string' || key.length > 1024 || !isVsId(vsId)) return null;
  const prefix = `${VISUAL_STORY_PREFIX}${vsId}/candidates/`;
  if (!key.startsWith(prefix)) return null;
  const m = /^([^/.]+)\.(jpg|png)$/.exec(key.slice(prefix.length));
  if (!m || !isCandId(m[1])) return null;
  return { candId: m[1], ext: m[2] as 'jpg' | 'png' };
}
