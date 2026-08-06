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

    expect(out).toMatchObject({ archived: true, key: `${MASTERS_PREFIX}ஒத்த பனங்கீத்தே.wav` });
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


/**
 * A JOINED master has TWO sources.
 *
 * Until 2026-08-06 this archived only `job.s3Key` — Part A — and said nothing,
 * so saving an assembled song protected half of it. Found by reading what a
 * real session actually wrote to S3: three archived files for வானவில்லே were
 * all byte-identical Part A copies under three different titles, and Part B
 * survived only because it happened to be mastered separately afterwards.
 */
describe('a two-part master archives BOTH sources', () => {
  const joined: MasterJob = {
    ...job,
    join: {
      partBKey: 'audio/mastering/1780067292588_cd4e_partb.wav',
      overlapSec: 3, curve: 'qsin', editB: null,
    },
  } as MasterJob;

  it('copies Part A and Part B, named for their parts', async () => {
    const out = await archiveSavedMaster('j1', joined);

    expect(out.archived).toBe(true);
    expect(copyObject).toHaveBeenCalledTimes(2);
    expect(copyObject).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sourceKey: joined.s3Key,
      destKey: `${MASTERS_PREFIX}ஒத்த பனங்கீத்தே (Part A).wav`,
    }));
    expect(copyObject).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sourceKey: 'audio/mastering/1780067292588_cd4e_partb.wav',
      destKey: `${MASTERS_PREFIX}ஒத்த பனங்கீத்தே (Part B).wav`,
    }));
    expect(out.keys).toHaveLength(2);
  });

  it('still writes ONE file for a single-source master, under the bare song name', async () => {
    // The regression that matters: existing archives stay addressable.
    await archiveSavedMaster('j1', job);
    expect(copyObject).toHaveBeenCalledTimes(1);
    expect(copyObject).toHaveBeenCalledWith(expect.objectContaining({
      destKey: `${MASTERS_PREFIX}ஒத்த பனங்கீத்தே.wav`,
    }));
  });

  it('records Part A as the job\'s archiveKey, so the record shape is unchanged', async () => {
    await archiveSavedMaster('j1', joined);
    expect(recordArchive).toHaveBeenCalledWith('j1', expect.objectContaining({
      archiveKey: `${MASTERS_PREFIX}ஒத்த பனங்கீத்தே (Part A).wav`,
    }));
  });
});
