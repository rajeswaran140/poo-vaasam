/** @jest-environment node */
/**
 * The publish side-effect: what actually reaches the site's audio path.
 *
 * The pure rules live in master-publish.test.ts. What matters HERE is the
 * composition, which is where every defect this module has shipped has
 * actually lived (PR #79, #80, #98 — units green, composition untested):
 * whether the occupied-key check runs BEFORE the copy, whether the outcome is
 * recorded, and whether a failure is visible rather than silent.
 *
 * This is also the module's first write to a public, CDN-served, canonical
 * per-song key, so "does it refuse to clobber" is a correctness test, not a
 * politeness one.
 */

const copyObject = jest.fn();
const fileExists = jest.fn();
const recordPublish = jest.fn();

jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: {
    copyObject: (...a: unknown[]) => copyObject(...a),
    fileExists: (...a: unknown[]) => fileExists(...a),
  },
}));
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: class {
    recordPublish = (...a: unknown[]) => recordPublish(...a);
  },
}));

import { publishWebMp3 } from '@/lib/master-publish-service';
import { SITE_AUDIO_PREFIX, SITE_AUDIO_CONTENT_TYPE } from '@/lib/master-publish';
import type { MasterJob } from '@/types/masterJob';

const baseJob: MasterJob = {
  id: 'j1',
  status: 'done',
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:05:00.000Z',
  s3Key: 'audio/mastering/1780067292588_ab3f_take.wav',
  target: -14,
  edit: null,
  editedDurationSec: null,
  mp3Key: 'audio/mastering/1780067292588_ab3f_take-master-14LUFS.mp3',
  mp3Lufs: -14.0,
  mp3Tp: -3.55,
  masterKey: 'audio/mastering/1780067292588_ab3f_take-master-14LUFS.wav',
  beforeLufs: -14.4,
  beforeTp: -3.6,
  afterLufs: -14.0,
  afterTp: -3.5,
  beforeLra: 3,
  afterLra: 3,
  normalizationType: 'linear',
  source: null,
  savedAt: '2026-08-04T00:06:00.000Z',
  title: 'ஒத்த பனங்கீத்தே',
  archivedAt: null,
  archiveKey: null,
  archiveError: null,
  publishedAt: null,
  publishKey: null,
  publishError: null,
  error: null,
};
const job = (over: Partial<MasterJob> = {}): MasterJob => ({ ...baseJob, ...over });
const DEST = `${SITE_AUDIO_PREFIX}ஒத்த பனங்கீத்தே.mp3`;

beforeEach(() => {
  copyObject.mockReset().mockResolvedValue({});
  fileExists.mockReset().mockResolvedValue(false);
  recordPublish.mockReset().mockResolvedValue(undefined);
});

describe('a successful publish', () => {
  it('copies the MP3 to the song-named site key, as audio/mpeg', async () => {
    const out = await publishWebMp3('j1', job());

    expect(out).toMatchObject({ published: true, key: DEST, replaced: false });
    expect(copyObject).toHaveBeenCalledWith({
      sourceKey: 'audio/mastering/1780067292588_ab3f_take-master-14LUFS.mp3',
      destKey: DEST,
      // Without this the copy inherits the workspace object's header; an
      // audio/wav Content-Type on an MP3 is refused by some mobile players,
      // which is precisely the audience this file exists for.
      contentType: SITE_AUDIO_CONTENT_TYPE,
    });
  });

  it('copies the MP3, never the mastered WAV', async () => {
    await publishWebMp3('j1', job());
    expect(copyObject.mock.calls[0][0].sourceKey).toMatch(/\.mp3$/);
    expect(copyObject.mock.calls[0][0].sourceKey).not.toBe(baseJob.masterKey);
  });

  it('records where and when, so the library can show it', async () => {
    await publishWebMp3('j1', job());
    const [id, result] = recordPublish.mock.calls[0];
    expect(id).toBe('j1');
    expect(result.publishKey).toBe(DEST);
    expect(typeof result.publishedAt).toBe('string');
  });
});

describe('an occupied destination', () => {
  it('REFUSES without copying, and says what would be replaced', async () => {
    fileExists.mockResolvedValue(true);
    const out = await publishWebMp3('j1', job());

    expect(out.conflict).toBe(true);
    expect(out.published).toBe(false);
    expect(out.message).toContain(DEST);
    // The assertion that matters: nothing was written, and nothing was recorded
    // as if it had been.
    expect(copyObject).not.toHaveBeenCalled();
    expect(recordPublish).not.toHaveBeenCalled();
  });

  it('replaces only when overwrite is asked for, and says that it did', async () => {
    fileExists.mockResolvedValue(true);
    const out = await publishWebMp3('j1', job(), { overwrite: true });

    expect(out).toMatchObject({ published: true, key: DEST, replaced: true });
    expect(copyObject).toHaveBeenCalledTimes(1);
  });

  it('checks the destination BEFORE copying, not after', async () => {
    // Ordering is the whole guard. Checking afterwards would report a conflict
    // for a file it had already overwritten.
    const order: string[] = [];
    fileExists.mockImplementation(async () => { order.push('exists'); return true; });
    copyObject.mockImplementation(async () => { order.push('copy'); });

    await publishWebMp3('j1', job());
    expect(order).toEqual(['exists']);
  });
});

describe('when the copy fails', () => {
  it('reports the failure instead of swallowing it', async () => {
    // Deliberately UNLIKE the archive service, which is best-effort because it
    // runs after a save that already succeeded. Publishing IS the request: an
    // operator who pressed the button must not be told nothing at all.
    copyObject.mockRejectedValue(new Error('AccessDenied'));
    const out = await publishWebMp3('j1', job());

    expect(out.published).toBe(false);
    expect(out.message).toMatch(/AccessDenied/);
  });

  it('records the failure on the job rather than only logging it', async () => {
    copyObject.mockRejectedValue(new Error('AccessDenied'));
    await publishWebMp3('j1', job());
    expect(recordPublish).toHaveBeenCalledWith('j1', { publishError: expect.stringContaining('AccessDenied') });
  });

  it('still returns an outcome when even the failure-record write fails', async () => {
    copyObject.mockRejectedValue(new Error('AccessDenied'));
    recordPublish.mockRejectedValue(new Error('dynamo down'));
    await expect(publishWebMp3('j1', job())).resolves.toMatchObject({ published: false });
  });

  it('treats a HeadObject failure as a failure, never as "not there"', async () => {
    // fileExists rethrows anything that is not NotFound. Swallowing that would
    // turn a permissions problem into a silent overwrite of a live song.
    fileExists.mockRejectedValue(new Error('AccessDenied'));
    const out = await publishWebMp3('j1', job());
    expect(out.published).toBe(false);
    expect(copyObject).not.toHaveBeenCalled();
  });
});

describe('refusals never touch S3', () => {
  it.each([
    ['unsaved', { savedAt: null }],
    ['untitled', { title: null }],
    ['no mp3', { mp3Key: null }],
    ['peak above the ceiling', { mp3Tp: -0.4 }],
    ['already published', { publishedAt: '2026-08-04T01:00:00.000Z' }],
    ['unfinished', { status: 'processing' as const }],
  ])('%s', async (_label, over) => {
    const out = await publishWebMp3('j1', job(over));
    expect(out.published).toBe(false);
    expect(out.message).toBeTruthy();
    expect(fileExists).not.toHaveBeenCalled();
    expect(copyObject).not.toHaveBeenCalled();
    expect(recordPublish).not.toHaveBeenCalled();
  });
});
