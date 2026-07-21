/**
 * DynamoKaraokeAssetRepository — infrastructure adapter for {@link
 * ../../application/ports/karaoke.KaraokeAssetRepository}.
 *
 * Persists the generated instrumental into the SAME field the Performers
 * feature already serves from — `instrumentalKey` (+ `instrumentalDuration`) on
 * the song's Content item — by delegating to {@link ../../lib/performer-write.setPerformerAssets}.
 * This is the deliberate reconciliation: the generation pipeline feeds the
 * branch's existing gated stream route (`GET /api/performers/songs/[id]/track`
 * behind `requirePerformer`) rather than introducing a parallel schema or a
 * second serving path. The private object key is never exposed as a URL.
 */

import { setPerformerAssets } from '@/lib/performer-write';
import type { KaraokeAssetRepository } from '@/application/ports/karaoke';
import type { KaraokeAsset } from '@/domain/songs/KaraokeAsset';

export class DynamoKaraokeAssetRepository implements KaraokeAssetRepository {
  async save(asset: KaraokeAsset): Promise<void> {
    await setPerformerAssets(asset.songId, {
      instrumentalKey: asset.instrumentalKey,
      instrumentalDuration: asset.durationSeconds ?? null,
    });
  }
}
