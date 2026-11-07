/**
 * Visual story S3 keys that the browser needs too (no node:crypto here; the
 * rest lives in visual-story-storage.ts, which re-exports these).
 */

import { MASTERING_PREFIX } from '@/lib/mastering-storage';
import { isCandId, isVsId } from '@/types/visualStory';

export const VISUAL_STORY_PREFIX = `${MASTERING_PREFIX}visual-story/`;

const CAND_EXTS = ['jpg', 'png', 'mp4'] as const;

/** Key of a candidate's still (`jpg`, or an uploaded `png`), poster (`jpg`) or clip (`mp4`). */
export function candidateKey(vsId: string, candId: string, ext: string): string {
  if (!isVsId(vsId)) throw new Error('invalid vsId');
  if (!isCandId(candId)) throw new Error('invalid candId');
  if (!(CAND_EXTS as readonly string[]).includes(ext)) throw new Error('invalid candidate extension');
  return `${VISUAL_STORY_PREFIX}${vsId}/candidates/${candId}.${ext}`;
}
