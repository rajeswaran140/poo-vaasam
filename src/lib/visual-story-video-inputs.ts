/**
 * Which images go with one shot's clip: its first frame and its cast's
 * reference faces. Shared by the request (buildVideoRequest) and every price
 * the studio shows or reserves, so the price counts exactly what is sent.
 *
 * Client-safe: no server SDK imports.
 */

import { grokVideoCostUsd } from '@/services/video/cost';
import type { Candidate, Character, Shot } from '@/types/visualStory';

/** xAI accepts at most this many `reference_images`. */
export const MAX_REFERENCE_IMAGES = 14;

export interface VideoInputsTree {
  characters: Character[];
  candidates: Candidate[];
}

export interface VideoInputs {
  /** The shot's cast, in tick order (unknown ids dropped). */
  cast: Character[];
  /** The pinned STILL, else the chosen picture when it is a STILL of this shot. */
  firstFrame: Candidate | undefined;
  /** Each cast member's reference keys, after the overall cap (same order as `cast`). */
  refKeysByCast: string[][];
  /** All reference keys sent, in order (`<IMAGE_n>` indices). */
  refKeys: string[];
}

export function selectVideoInputs(tree: VideoInputsTree, shot: Shot): VideoInputs {
  const cast = shot.charIds
    .map((id) => tree.characters.find((c) => c.charId === id))
    .filter((c): c is Character => !!c);

  const stillOfShot = (candId: string | null | undefined) =>
    candId
      ? tree.candidates.find(
          (c) => c.candId === candId && c.sceneOrder === shot.sceneOrder && c.shotOrder === shot.shotOrder && c.mode === 'STILL'
        )
      : undefined;
  const firstFrame = stillOfShot(shot.firstFrameCandidateId) ?? stillOfShot(shot.selectedCandidateId);

  // Cap before signing, so the <IMAGE_n> indices match the URLs sent.
  const refKeys: string[] = [];
  const refKeysByCast = cast.map((c) => {
    const mine: string[] = [];
    for (const key of c.refImageKeys ?? []) {
      if (refKeys.length >= MAX_REFERENCE_IMAGES) break;
      mine.push(key);
      refKeys.push(key);
    }
    return mine;
  });

  return { cast, firstFrame, refKeysByCast, refKeys };
}

/**
 * What one Grok clip for this shot costs, as it stands now. `assumeFirstFrame`
 * is for a row that will get its frame just before the clip (Continue from…).
 */
export function clipPriceUsd(tree: VideoInputsTree, shot: Shot, opts: { assumeFirstFrame?: boolean } = {}): number {
  const { firstFrame, refKeys } = selectVideoInputs(tree, shot);
  return grokVideoCostUsd({
    // Grok makes whole seconds: a row in tenths is asked for, and billed, the next whole second.
    durationSec: Math.ceil(shot.durationSec),
    referenceCount: refKeys.length,
    hasFirstFrame: !!firstFrame || !!opts.assumeFirstFrame,
  });
}
