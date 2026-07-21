/**
 * DynamoKaraokeAssetRepository — infrastructure adapter for {@link
 * ../../application/ports/karaoke.KaraokeAssetRepository}.
 *
 * Records the karaoke asset on the song's existing content item
 * (PK=CONTENT#<id>, SK=METADATA) as additive attributes — no schema migration.
 * `karaokeAccess` mirrors the domain visibility so a read path can gate without
 * rehydrating the value object. Guarded by attribute_exists(PK): a karaoke
 * asset can only attach to a song that actually exists.
 */

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import type { KaraokeAssetRepository } from '@/application/ports/karaoke';
import type { KaraokeAsset } from '@/domain/songs/KaraokeAsset';

export class DynamoKaraokeAssetRepository implements KaraokeAssetRepository {
  async save(asset: KaraokeAsset): Promise<void> {
    await DynamoDBOperations.update({
      key: { PK: `CONTENT#${asset.songId}`, SK: 'METADATA' },
      updateExpression:
        'SET karaokeInstrumentalKey = :k, karaokeAsset = :a, karaokeAccess = :v, updatedAt = :t',
      expressionAttributeValues: {
        // The private object key — never a public URL (serving is gated).
        ':k': asset.instrumentalKey,
        ':a': asset.toJSON(),
        ':v': asset.visibility,
        ':t': asset.createdAt,
      },
      conditionExpression: 'attribute_exists(PK)',
    });
  }
}
