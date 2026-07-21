/**
 * DynamoKaraokeAssetRepository — persistence reconciliation test.
 *
 * Verifies the generation pipeline writes into the SAME field the Performers
 * stream route serves from (`instrumentalKey` via setPerformerAssets), not a
 * parallel schema — so no second serving path exists.
 */

import { setPerformerAssets } from '@/lib/performer-write';
import { DynamoKaraokeAssetRepository } from '@/infrastructure/database/DynamoKaraokeAssetRepository';
import { KaraokeAsset } from '@/domain/songs/KaraokeAsset';

jest.mock('@/lib/performer-write', () => ({ setPerformerAssets: jest.fn() }));
const mockedSet = setPerformerAssets as jest.MockedFunction<typeof setPerformerAssets>;

function asset(overrides?: Partial<Parameters<typeof KaraokeAsset.create>[0]>) {
  return KaraokeAsset.create({
    songId: 'sevvanthi-poove',
    instrumentalKey: 'performer-tracks/sevvanthi-poove-instrumental-1.mp3',
    durationSeconds: 214,
    separationModel: 'htdemucs',
    createdAt: '2026-07-21T12:00:00.000Z',
    ...overrides,
  });
}

describe('DynamoKaraokeAssetRepository', () => {
  beforeEach(() => jest.clearAllMocks());

  it('persists via setPerformerAssets using the branch instrumentalKey field', async () => {
    mockedSet.mockResolvedValue(undefined);
    await new DynamoKaraokeAssetRepository().save(asset());
    expect(mockedSet).toHaveBeenCalledWith('sevvanthi-poove', {
      instrumentalKey: 'performer-tracks/sevvanthi-poove-instrumental-1.mp3',
      instrumentalDuration: 214,
    });
  });

  it('passes null duration when the asset has none (clears the field)', async () => {
    mockedSet.mockResolvedValue(undefined);
    await new DynamoKaraokeAssetRepository().save(asset({ durationSeconds: 0 }));
    expect(mockedSet).toHaveBeenCalledWith('sevvanthi-poove', {
      instrumentalKey: expect.any(String),
      instrumentalDuration: null,
    });
  });

  it('propagates a persistence failure to the caller (use case maps it to 502)', async () => {
    mockedSet.mockRejectedValue(new Error('ConditionalCheckFailedException'));
    await expect(new DynamoKaraokeAssetRepository().save(asset())).rejects.toThrow(/Conditional/);
  });
});
