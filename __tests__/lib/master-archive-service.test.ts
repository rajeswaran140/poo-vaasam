/** @jest-environment node */
/**
 * The archive side-effect: what actually reaches S3, and what happens when it
 * does not.
 *
 * The pure rules are covered in master-archive.test.ts. What matters here is
 * the guarantee that made this safe to bolt onto save() at all — archiving is
 * best-effort and can never fail, or undo, a save that already succeeded.
 */

const copyObject = jest.fn();
const recordArchive = jest.fn();

jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { copyObject: (...a: unknown[]) => copyObject(...a) },
}));
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: class {
    recordArchive = (...a: unknown[]) => recordArchive(...a);
  },
}));

import { archiveSavedMaster } from '@/lib/master-archive-service';
import { MASTERS_BUCKET, MASTERS_PREFIX, MASTERS_STORAGE_CLASS } from '@/lib/master-archive';
import type { MasterJob } from '@/types/masterJob';

const job: MasterJob = {
  id: 'j1', status: 'done',
  createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:04:00.000Z',
  s3Key: 'audio/mastering/1780067292588_ab3f_take.wav',
  target: -14, masterKey: 'audio/mastering/1780067292588_ab3f_take-master-14LUFS.wav',
  beforeLufs: -17.9, beforeTp: -0.3, afterLufs: -14, afterTp: -3.6,
  beforeLra: 3, afterLra: 3, normalizationType: 'linear', source: null,
  savedAt: '2026-08-01T10:05:00.000Z', title: 'ஒத்த பனங்கீத்தே',
  archivedAt: null, archiveKey: null, archiveError: null, error: null,
};

beforeEach(() => {
  copyObject.mockReset().mockResolvedValue({});
  recordArchive.mockReset().mockResolvedValue(undefined);
});

describe('a successful archive', () => {
  it('server-side copies the source into the masters bucket as GLACIER_IR', async () => {
    const out = await archiveSavedMaster('j1', job);

    expect(out).toEqual({ archived: true, key: `${MASTERS_PREFIX}ஒத்த பனங்கீத்தே.wav` });
    expect(copyObject).toHaveBeenCalledWith({
      sourceKey: job.s3Key,
      destKey: `${MASTERS_PREFIX}ஒத்த பனங்கீத்தே.wav`,
      destBucket: MASTERS_BUCKET,
      storageClass: MASTERS_STORAGE_CLASS,
    });
  });

  it('records where it landed so the Studio can show it', async () => {
    await archiveSavedMaster('j1', job);
    const [id, result] = recordArchive.mock.calls[0];
    expect(id).toBe('j1');
    expect(result.archiveKey).toBe(`${MASTERS_PREFIX}ஒத்த பனங்கீத்தே.wav`);
    expect(Date.parse(result.archivedAt)).not.toBeNaN();
  });
});

describe('when the copy fails', () => {
  /**
   * The load-bearing guarantee. This runs AFTER save() has committed, so a
   * throw here would 502 a request whose work already succeeded and lose the
   * operator's title over a transient S3 error.
   */
  it('never throws, and never undoes the save', async () => {
    copyObject.mockRejectedValue(new Error('AccessDenied'));
    await expect(archiveSavedMaster('j1', job)).resolves.toEqual({
      archived: false,
      message: expect.stringContaining('AccessDenied'),
    });
  });

  it('persists the failure rather than leaving it silent', async () => {
    copyObject.mockRejectedValue(new Error('SlowDown'));
    await archiveSavedMaster('j1', job);
    expect(recordArchive).toHaveBeenCalledWith('j1', { archiveError: 'SlowDown' });
  });

  /**
   * A failed archive that reads as success would be the worst outcome of all —
   * Raj would believe a source is safe in Glacier when nothing was copied.
   */
  it('does not report archived:true for a copy that did not happen', async () => {
    copyObject.mockRejectedValue(new Error('NoSuchKey'));
    const out = await archiveSavedMaster('j1', job);
    expect(out.archived).toBe(false);
    expect(out.key).toBeUndefined();
  });

  it('survives the failure-recording write itself failing', async () => {
    copyObject.mockRejectedValue(new Error('AccessDenied'));
    recordArchive.mockRejectedValue(new Error('dynamo down'));
    await expect(archiveSavedMaster('j1', job)).resolves.toMatchObject({ archived: false });
  });
});

describe('when there is nothing to archive', () => {
  it.each([
    ['untitled', { title: null }],
    ['unsaved', { savedAt: null }],
    ['already archived', { archivedAt: '2026-08-01T11:00:00Z' }],
    ['still processing', { status: 'processing' as const }],
  ])('touches neither S3 nor DynamoDB for %s', async (_label, patch) => {
    const out = await archiveSavedMaster('j1', { ...job, ...patch } as MasterJob);

    expect(out.archived).toBe(false);
    expect(copyObject).not.toHaveBeenCalled();
    // A refusal is not a failure — writing it would make "nothing to do"
    // indistinguishable from "we tried and it broke".
    expect(recordArchive).not.toHaveBeenCalled();
  });

  it('explains the untitled case, which is the only one the operator can fix', async () => {
    const out = await archiveSavedMaster('j1', { ...job, title: null });
    expect(out.message).toMatch(/name this master/i);
  });
});
