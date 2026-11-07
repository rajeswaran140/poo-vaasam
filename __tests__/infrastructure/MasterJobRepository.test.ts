/** @jest-environment node */
/**
 * How a master job is written and read back.
 *
 * The `normalizationMode` field decides whether a job is a loudness master or a
 * karaoke bed, and it is read from a stored row rather than recomputed. So the
 * properties that matter are: a row written before the field existed must come
 * back as a LOUDNESS job rather than undefined, and a row carrying a value the
 * code does not recognise must not be passed through to the worker.
 *
 * Task 2 of docs/superpowers/plans/2026-09-18-karaoke-master-target.md.
 */

const mockPut = jest.fn();
const mockGet = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: (...a: unknown[]) => mockPut(...a),
    get: (...a: unknown[]) => mockGet(...a),
    query: jest.fn(), scanAll: jest.fn(), update: (...a: unknown[]) => mockUpdate(...a), delete: jest.fn(),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));

import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';

const repo = new MasterJobRepository();
const written = () => mockPut.mock.calls[0][0] as Record<string, unknown>;

/** A stored row as it looks before hydration. */
const stored = (over: Record<string, unknown> = {}) => ({
  PK: 'MASTERJOB#j1', SK: 'METADATA', id: 'j1',
  s3Key: 'audio/mastering/1_a_song.wav', target: -14, status: 'done',
  createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z',
  ...over,
});

beforeEach(() => { mockPut.mockReset(); mockGet.mockReset(); mockUpdate.mockReset(); });

describe('create', () => {
  it('writes both peak fields as null, so a loudness job says so explicitly', async () => {
    await repo.create('j1', { s3Key: 'audio/mastering/1_a_song.wav', target: -14 });
    expect(written().normalizationMode).toBeNull();
    expect(written().peakGainDb).toBeNull();
  });
});

describe('hydrate', () => {
  const read = async (over: Record<string, unknown> = {}) => {
    mockGet.mockResolvedValueOnce(stored(over));
    return (await repo.get('j1'))!;
  };

  /**
   * Every row written before this feature existed has no such attribute. It
   * must read as a loudness master — the default — rather than as undefined,
   * which would reach the worker and mean nothing.
   */
  it('reads a pre-feature row as null, meaning loudness', async () => {
    const job = await read();
    expect(job.normalizationMode).toBeNull();
    expect(job.peakGainDb).toBeNull();
  });

  it('carries a peak job through with the gain it applied', async () => {
    const job = await read({ normalizationMode: 'peak', peakGainDb: 6.5 });
    expect(job.normalizationMode).toBe('peak');
    expect(job.peakGainDb).toBe(6.5);
  });

  it('carries an explicit loudness job through', async () => {
    expect((await read({ normalizationMode: 'loudness' })).normalizationMode).toBe('loudness');
  });

  /**
   * ⚠️ A stored value the code does not recognise must NOT be passed on. The
   * worker branches on this field; an unknown string would fall through its
   * peak check and silently master as loudness anyway — so it is better to say
   * null here, which means the same thing and is honest about it.
   */
  it('refuses a mode it does not recognise, rather than passing it through', async () => {
    for (const bad of ['karaoke', 'PEAK', '', 0, {}, []]) {
      expect((await read({ normalizationMode: bad })).normalizationMode).toBeNull();
    }
  });

  it('refuses a gain that is not a number', async () => {
    for (const bad of ['6.5', null, {}, Number.NaN]) {
      const v = (await read({ normalizationMode: 'peak', peakGainDb: bad })).peakGainDb;
      expect(typeof v === 'number' ? Number.isFinite(v) : v === null).toBe(true);
    }
  });

  it('keeps a gain of zero, which is a real applied value', async () => {
    // A bed already at the ceiling gets 0.00 dB — and the pass still ran.
    expect((await read({ normalizationMode: 'peak', peakGainDb: 0 })).peakGainDb).toBe(0);
  });

  it('keeps a negative gain, which is attenuation', async () => {
    expect((await read({ normalizationMode: 'peak', peakGainDb: -1.8 })).peakGainDb).toBe(-1.8);
  });
});

describe('lineage', () => {
  const lastPut = () => mockPut.mock.calls[mockPut.mock.calls.length - 1][0] as Record<string, unknown>;
  beforeEach(() => { mockPut.mockReset().mockResolvedValue({}); mockGet.mockReset(); });

  it('stores derivedFrom only when given, so ordinary jobs are unchanged', async () => {
    await repo.create('j1', { s3Key: 'audio/mastering/a.wav', target: -14 });
    expect(lastPut()).not.toHaveProperty('derivedFrom');
    await repo.create('j2', { s3Key: 'audio/mastering/a.wav', target: -14, derivedFrom: { jobId: 'p1', via: 're-master' } });
    expect(lastPut().derivedFrom).toEqual({ jobId: 'p1', via: 're-master' });
  });

  it('hydrates derivedFrom, null on an old row', async () => {
    mockGet.mockResolvedValueOnce({ id: 'j1', status: 'done', s3Key: 'audio/mastering/a.wav', target: -14 });
    expect((await repo.get('j1'))!.derivedFrom).toBeNull();
    mockGet.mockResolvedValueOnce({
      id: 'j2', status: 'done', s3Key: 'audio/mastering/a.wav', target: -14, derivedFrom: { jobId: 'p1', via: 'stem-remix' },
    });
    expect((await repo.get('j2'))!.derivedFrom).toEqual({ jobId: 'p1', via: 'stem-remix' });
  });
});

describe('video backgrounds', () => {
  it('reads each render\'s background, null on an old row or a non-string', async () => {
    mockGet.mockResolvedValueOnce(stored({
      videoBackgroundKey: 'audio/mastering/1_d_loop.mov', shortBackgroundKey: 42,
    }));
    const job = (await repo.get('j1'))!;
    expect(job.videoBackgroundKey).toBe('audio/mastering/1_d_loop.mov');
    expect(job.shortBackgroundKey).toBeNull();
    expect(job.verticalBackgroundKey).toBeNull();
  });

  it('reads the clip lists of a joined background, null on an old row or a stray value', async () => {
    const list = ['audio/mastering/visual-story/vs_a/candidates/c_1.mp4', 'audio/mastering/1_d_loop.mov'];
    mockGet.mockResolvedValueOnce(stored({ videoBackgroundKeys: list, shortBackgroundKeys: ['x', 3] }));
    const job = (await repo.get('j1'))!;
    expect(job.videoBackgroundKeys).toEqual(list);
    expect(job.shortBackgroundKeys).toBeNull();
    expect(job.verticalBackgroundKeys).toBeNull();
  });
});

/**
 * Audit 2026-11-07, defect 1: a retry that failed with the SAME message as the
 * last attempt spun until the deadline, because the poll only threw on an error
 * that differed from the one already on the row, and nothing cleared it.
 * The routes now clear the field on enqueue, through this.
 */
describe('clearRenderError', () => {
  it.each(['videoError', 'shortError', 'verticalError'] as const)('clears %s and nothing else', async (field) => {
    mockUpdate.mockResolvedValueOnce({});
    await repo.clearRenderError('j1', field);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const args = mockUpdate.mock.calls[0][0];
    expect(args.key).toEqual({ PK: 'MASTERJOB#j1', SK: 'METADATA' });
    expect(args.updateExpression).toBe('SET #field = :null');
    expect(args.expressionAttributeNames).toEqual({ '#field': field });
    expect(args.expressionAttributeValues).toEqual({ ':null': null });
    // Never creates a row for a job that does not exist.
    expect(args.conditionExpression).toBe('attribute_exists(PK)');
  });

  it('does NOT touch updatedAt — the upload guard reads it to judge an upload in flight', async () => {
    mockUpdate.mockResolvedValueOnce({});
    await repo.clearRenderError('j1', 'videoError');
    const args = mockUpdate.mock.calls[0][0];
    expect(args.updateExpression).not.toContain('updatedAt');
    expect(Object.values(args.expressionAttributeNames)).not.toContain('updatedAt');
  });

  it('refuses a field that is not a render error', async () => {
    await expect(repo.clearRenderError('j1', 'youtubeVideoId' as never)).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
