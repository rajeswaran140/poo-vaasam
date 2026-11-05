/**
 * Video generation jobs (`GENJOB#<jobId>`) — the parts shared by the make-video
 * route, the job route and the reconciler.
 *
 * Keep Next.js out of here: the reconciler may bundle this module.
 */

import { S3Operations } from '@/infrastructure/storage/s3-client';
import type { Candidate, Character, Shot, VisualStory } from '@/types/visualStory';
import type { VideoGenRequest } from '@/services/video/providers/types';

/** xAI accepts at most this many `reference_images`. */
export const MAX_REFERENCE_IMAGES = 14;
/** A video job (and its per-shot VIDLOCK#) not finished after this long is ended / taken over (Rulings V4, V5). */
export const VIDEO_STALE_MS = 60 * 60_000;
/** Signed URLs handed to xAI live this long. */
export const SIGNED_URL_TTL_SEC = 3600;

/** The parts of `loadTree` a video request needs. */
export interface VideoRequestTree {
  story: Pick<VisualStory, 'aspectRatio'>;
  characters: Character[];
  candidates: Candidate[];
}

/**
 * The provider request for one shot: the shot's prompt plus its cast
 * ("Name: description", tagged with the `<IMAGE_n>` references that show
 * them), the pinned first-frame STILL and the cast's reference photos — all
 * as short-lived signed URLs. Never carries an abort signal (R10).
 */
export async function buildVideoRequest(tree: VideoRequestTree, shot: Shot): Promise<VideoGenRequest> {
  const cast = shot.charIds
    .map((id) => tree.characters.find((c) => c.charId === id))
    .filter((c): c is Character => !!c);

  // Cap before signing, so the <IMAGE_n> indices match the URLs sent.
  const refKeys: string[] = [];
  const castLines = cast.map((c) => {
    const tags: string[] = [];
    for (const key of c.refImageKeys ?? []) {
      if (refKeys.length >= MAX_REFERENCE_IMAGES) break;
      tags.push(`<IMAGE_${refKeys.length}>`);
      refKeys.push(key);
    }
    const desc = c.description.trim();
    const line = desc ? `${c.name}: ${desc}` : c.name;
    return tags.length ? `${line} (shown in ${tags.join(', ')})` : line;
  });

  const prompt = castLines.length
    ? `${shot.visualPrompt}\n\nCharacters in this shot:\n${castLines.join('\n')}`
    : shot.visualPrompt;

  const firstFrame = shot.firstFrameCandidateId
    ? tree.candidates.find(
        (c) =>
          c.candId === shot.firstFrameCandidateId &&
          c.sceneOrder === shot.sceneOrder &&
          c.shotOrder === shot.shotOrder &&
          c.mode === 'STILL'
      )
    : undefined;

  const sign = (key: string) => S3Operations.getSignedUrl(key, SIGNED_URL_TTL_SEC);
  const [firstFrameUrl, referenceImageUrls] = await Promise.all([
    firstFrame ? sign(firstFrame.s3Key) : Promise.resolve(undefined),
    Promise.all(refKeys.map(sign)),
  ]);

  return {
    prompt,
    mode: 'HERO',
    durationSec: shot.durationSec,
    aspectRatio: tree.story.aspectRatio,
    ...(firstFrameUrl ? { firstFrameUrl } : {}),
    ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
  };
}
