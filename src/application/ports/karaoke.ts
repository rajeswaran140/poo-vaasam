/**
 * Ports for the karaoke (Performers) feature.
 *
 * The use case ({@link ../use-cases/GenerateKaraokeStem}) orchestrates these
 * three collaborators; concrete adapters live in the infrastructure layer and
 * the CLI composition root. Keeping them as interfaces makes the use case
 * unit-testable with no S3, no DynamoDB, and no ML engine installed.
 */

import type { KaraokeAsset } from '@/domain/songs/KaraokeAsset';

/** Fetches a song's finished master to a local file for processing. */
export interface SongMasterSource {
  /**
   * Resolve and download the master audio for `songId` to a local path.
   * Returns null when the song or its master audio does not exist (→ 404).
   */
  fetchMaster(songId: string): Promise<{ localPath: string } | null>;
}

/** Uploads the produced instrumental to gated storage and returns its private
 *  object key — NOT a public URL (a gated asset must have no public address). */
export interface KaraokeInstrumentalStorage {
  /**
   * Store the local instrumental for `songId` and return the private S3 object
   * key plus duration when known. The adapter owns the gated key convention;
   * serving is a gated route's concern, not this port's.
   */
  store(input: {
    songId: string;
    localPath: string;
  }): Promise<{ objectKey: string; durationSeconds?: number }>;
}

/** Persists the karaoke asset reference against the song. */
export interface KaraokeAssetRepository {
  save(asset: KaraokeAsset): Promise<void>;
}
