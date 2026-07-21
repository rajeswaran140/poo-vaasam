/**
 * GenerateKaraokeStem — use-case tests.
 *
 * All four ports are mocked, so these run with no S3, no DynamoDB, and no ML
 * engine. They pin the orchestration order and that every failure mode maps to
 * the right discriminated result (never a throw).
 */

import { GenerateKaraokeStem } from '@/application/use-cases/GenerateKaraokeStem';
import type { StemSeparator } from '@/application/ports/StemSeparator';
import type {
  SongMasterSource,
  KaraokeInstrumentalStorage,
  KaraokeAssetRepository,
} from '@/application/ports/karaoke';

const SONG_ID = 'sevvanthi-poove';
const FIXED_NOW = new Date('2026-07-21T12:00:00.000Z');

function build(overrides?: {
  masters?: Partial<SongMasterSource>;
  separator?: Partial<StemSeparator>;
  storage?: Partial<KaraokeInstrumentalStorage>;
  repository?: Partial<KaraokeAssetRepository>;
}) {
  const masters: jest.Mocked<SongMasterSource> = {
    fetchMaster: jest.fn().mockResolvedValue({ localPath: '/tmp/master.mp3' }),
    ...overrides?.masters,
  } as jest.Mocked<SongMasterSource>;

  const separator: jest.Mocked<StemSeparator> = {
    model: 'htdemucs',
    separate: jest.fn().mockResolvedValue({
      instrumentalPath: '/tmp/instrumental.mp3',
      model: 'htdemucs',
      durationSeconds: 214,
    }),
    ...overrides?.separator,
  } as jest.Mocked<StemSeparator>;

  const storage: jest.Mocked<KaraokeInstrumentalStorage> = {
    store: jest.fn().mockResolvedValue({
      objectKey: 'performer-tracks/sevvanthi-poove-instrumental-1.mp3',
      durationSeconds: 214,
    }),
    ...overrides?.storage,
  } as jest.Mocked<KaraokeInstrumentalStorage>;

  const repository: jest.Mocked<KaraokeAssetRepository> = {
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides?.repository,
  } as jest.Mocked<KaraokeAssetRepository>;

  const useCase = new GenerateKaraokeStem(masters, separator, storage, repository, () => FIXED_NOW);
  return { useCase, masters, separator, storage, repository };
}

describe('GenerateKaraokeStem', () => {
  beforeEach(() => jest.clearAllMocks());

  it('produces a gated asset and persists it on the happy path', async () => {
    const { useCase, masters, separator, storage, repository } = build();

    const result = await useCase.execute(SONG_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.asset.songId).toBe(SONG_ID);
    expect(result.asset.visibility).toBe('subscribers');
    expect(result.asset.isAccessibleBy({ isSubscriber: true })).toBe(true);
    expect(result.asset.isAccessibleBy({ isSubscriber: false })).toBe(false);
    expect(result.asset.createdAt).toBe(FIXED_NOW.toISOString());

    // Orchestration order + wiring.
    expect(masters.fetchMaster).toHaveBeenCalledWith(SONG_ID);
    expect(separator.separate).toHaveBeenCalledWith({ songId: SONG_ID, sourceAudioPath: '/tmp/master.mp3' });
    expect(storage.store).toHaveBeenCalledWith({ songId: SONG_ID, localPath: '/tmp/instrumental.mp3' });
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save.mock.calls[0][0].songId).toBe(SONG_ID);
  });

  it('prefers the storage-reported duration over the separator estimate', async () => {
    const { useCase } = build({
      separator: {
        model: 'htdemucs',
        separate: jest.fn().mockResolvedValue({ instrumentalPath: '/tmp/i.mp3', model: 'htdemucs', durationSeconds: 200 }),
      },
      storage: {
        store: jest.fn().mockResolvedValue({ objectKey: 'performer-tracks/a.mp3', durationSeconds: 214 }),
      },
    });
    const result = await useCase.execute(SONG_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.asset.durationSeconds).toBe(214);
    expect(result.asset.instrumentalKey).toBe('performer-tracks/a.mp3');
  });

  it('rejects a blank songId with 400 and touches nothing', async () => {
    const { useCase, masters } = build();
    const result = await useCase.execute('   ');
    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
    expect(masters.fetchMaster).not.toHaveBeenCalled();
  });

  it('returns 404 when the master is missing and does not separate', async () => {
    const { useCase, separator } = build({ masters: { fetchMaster: jest.fn().mockResolvedValue(null) } });
    const result = await useCase.execute(SONG_ID);
    expect(result).toEqual({ ok: false, status: 404, error: expect.any(String) });
    expect(separator.separate).not.toHaveBeenCalled();
  });

  it('maps a master-fetch throw to 502', async () => {
    const { useCase } = build({ masters: { fetchMaster: jest.fn().mockRejectedValue(new Error('s3 down')) } });
    expect(await useCase.execute(SONG_ID)).toEqual({ ok: false, status: 502, error: expect.any(String) });
  });

  it('maps a separation failure to 502 and does not store', async () => {
    const { useCase, storage } = build({
      separator: { model: 'htdemucs', separate: jest.fn().mockRejectedValue(new Error('engine missing')) },
    });
    const result = await useCase.execute(SONG_ID);
    expect(result).toEqual({ ok: false, status: 502, error: expect.any(String) });
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('maps a storage failure to 502 and does not persist', async () => {
    const { useCase, repository } = build({
      storage: { store: jest.fn().mockRejectedValue(new Error('put failed')) },
    });
    const result = await useCase.execute(SONG_ID);
    expect(result).toEqual({ ok: false, status: 502, error: expect.any(String) });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('maps a persistence failure to 502 (instrumental stored but unrecorded)', async () => {
    const { useCase } = build({ repository: { save: jest.fn().mockRejectedValue(new Error('ddb down')) } });
    expect(await useCase.execute(SONG_ID)).toEqual({ ok: false, status: 502, error: expect.any(String) });
  });

  it('maps an invalid produced key (a public URL) to 502 without persisting', async () => {
    // The domain rejects a URL where a private key belongs — the use case must
    // surface that as a failure and never record a public-address "gated" asset.
    const { useCase, repository } = build({
      storage: { store: jest.fn().mockResolvedValue({ objectKey: 'https://cdn.example.com/x.mp3' }) },
    });
    const result = await useCase.execute(SONG_ID);
    expect(result).toEqual({ ok: false, status: 502, error: expect.any(String) });
    expect(repository.save).not.toHaveBeenCalled();
  });
});
