/** @jest-environment node */
import { planUpload, uploadRefusalMessage, UPLOAD_STALE_AFTER_MS, type UploadRefusal } from '@/lib/youtube-upload';
import type { MasterJob } from '@/types/masterJob';

// Only used by the markUploadQueued describe block below, but must be
// declared/mocked before the MasterJobRepository import for jest's hoisting.
const mockUpdate = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    update: (...a: unknown[]) => mockUpdate(...a),
    put: jest.fn(),
    get: jest.fn(),
    query: jest.fn(),
    delete: jest.fn(),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';

const job = (over: Partial<MasterJob> = {}): MasterJob => ({
  ...({} as MasterJob),
  id: 'j1',
  status: 'done',
  savedAt: '2026-09-15T00:00:00.000Z',
  masterKey: 'audio/mastering/1_a_x-master-14LUFS.wav',
  videoKey: 'audio/mastering/1_a_x-master-14LUFS-1440p.mp4',
  coverKey: 'audio/mastering/1_a_cover.png',
  uploadStatus: null,
  uploadSessionUri: null,
  youtubeVideoId: null,
  uploadedToYoutubeAt: null,
  uploadError: null,
  ...over,
});

const input = {
  title: 'காதல் வந்து அரும்பியதே',
  description: 'body text',
  tags: ['Tamil love song'],
  playlistIds: ['PLLsCQ9NH4rLSZU0Ycy6I-Xr8DMAbe4vjs'],
};

describe('planUpload', () => {
  it('uploads PRIVATE and in the music category — the portal never publishes', () => {
    const p = planUpload(job(), input);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.privacyStatus).toBe('private');
      expect(p.categoryId).toBe('10');
      expect(p.videoKey).toBe(job().videoKey);
    }
  });

  it('refuses a job with no rendered video', () => {
    const p = planUpload(job({ videoKey: null }), input);
    expect(p).toEqual({ ok: false, reason: 'no-video' });
  });

  it('refuses an unsaved master, whose provenance expires in 24h', () => {
    expect(planUpload(job({ savedAt: null }), input)).toEqual({ ok: false, reason: 'not-saved' });
  });

  /**
   * The upload gate for output verification.
   *
   * ⚠️ ONLY the literal 'failed' may block. Getting this wrong in the safe-
   * looking direction — treating anything non-'passed' as suspect — would
   * refuse the entire back catalogue, since every job rendered before the check
   * existed carries null.
   */
  it('refuses a video whose audio was measured and did not match its master', () => {
    expect(planUpload(job({ videoAudioCheck: 'failed' }), input))
      .toEqual({ ok: false, reason: 'audio-mismatch' });
    expect(uploadRefusalMessage('audio-mismatch')).toMatch(/re-render/);
  });

  it('allows every other verdict, including the ones that mean "we do not know"', () => {
    // null      — rendered before the check existed. The whole back catalogue.
    // undefined — a job object built before the field existed.
    // 'unknown' — a figure could not be read. Not a fault.
    // 'passed'  — measured and matching.
    for (const v of [null, undefined, 'unknown' as const, 'passed' as const]) {
      expect(planUpload(job({ videoAudioCheck: v }), input).ok).toBe(true);
    }
  });

  it('lets already-uploaded still win, so a mismatch cannot reopen a finished job', () => {
    // Ordering matters: a job that already produced a public video must never
    // reach the insert path, whatever else is wrong with it.
    expect(planUpload(job({ videoAudioCheck: 'failed', youtubeVideoId: 'abc123' }), input))
      .toEqual({ ok: false, reason: 'already-uploaded' });
  });

  it('REFUSES A SECOND INSERT — this is what stops duplicate public videos', () => {
    const p = planUpload(job({ youtubeVideoId: 'abc123' }), input);
    expect(p).toEqual({ ok: false, reason: 'already-uploaded' });
  });

  it('already-uploaded WINS over every other defect — the job never reaches the insert path', () => {
    // videoKey is also missing AND the title is blank: either alone would
    // produce a different refusal. already-uploaded must still be the result,
    // proving the check runs first, not merely that it exists.
    const p = planUpload(job({ youtubeVideoId: 'abc123', videoKey: null }), { ...input, title: '  ' });
    expect(p).toEqual({ ok: false, reason: 'already-uploaded' });
  });

  it('refuses while an upload is already in flight', () => {
    expect(planUpload(job({ uploadStatus: 'uploading' }), input)).toEqual({ ok: false, reason: 'in-flight' });
  });

  it('in-flight also wins over an independently invalid input', () => {
    const p = planUpload(job({ uploadStatus: 'queued' }), { ...input, title: '  ' });
    expect(p).toEqual({ ok: false, reason: 'in-flight' });
  });

  it('requires a title and a description', () => {
    expect(planUpload(job(), { ...input, title: '  ' })).toEqual({ ok: false, reason: 'no-title' });
    expect(planUpload(job(), { ...input, description: '' })).toEqual({ ok: false, reason: 'no-description' });
  });

  it('every refusal has actionable wording', () => {
    const all: UploadRefusal[] = ['no-video', 'audio-mismatch', 'not-saved', 'no-title', 'no-description', 'already-uploaded', 'in-flight'];
    for (const r of all) expect(uploadRefusalMessage(r).length).toBeGreaterThan(10);
  });
});

/**
 * Resuming a crashed upload.
 *
 * The whole point of `uploadSessionUri` is to resume an upload that died
 * partway — but a worker that dies mid-PUT leaves `uploadStatus: 'uploading'`
 * behind forever, and without a staleness window `planUpload` would refuse
 * every subsequent attempt as `in-flight` permanently. The resume path would
 * exist in the code and be unreachable in practice.
 *
 * `now` is passed explicitly (never `Date.now()` inside `planUpload` itself)
 * so every case here is deterministic.
 */
describe('planUpload — resuming a crashed upload', () => {
  const NOW = Date.parse('2026-09-15T12:00:00.000Z');
  const at = (msBeforeNow: number) => new Date(NOW - msBeforeNow).toISOString();

  it('refuses in-flight when uploading and updatedAt is fresh', () => {
    const j = job({ uploadStatus: 'uploading', updatedAt: at(1000) });
    expect(planUpload(j, input, { now: NOW })).toEqual({ ok: false, reason: 'in-flight' });
  });

  it('treats uploading as resumable once updatedAt is older than the stale window', () => {
    const j = job({ uploadStatus: 'uploading', updatedAt: at(UPLOAD_STALE_AFTER_MS + 1000) });
    expect(planUpload(j, input, { now: NOW }).ok).toBe(true);
  });

  it('queued gets the identical treatment: fresh refuses, stale proceeds', () => {
    const fresh = job({ uploadStatus: 'queued', updatedAt: at(1000) });
    expect(planUpload(fresh, input, { now: NOW })).toEqual({ ok: false, reason: 'in-flight' });

    const stale = job({ uploadStatus: 'queued', updatedAt: at(UPLOAD_STALE_AFTER_MS + 1000) });
    expect(planUpload(stale, input, { now: NOW }).ok).toBe(true);
  });

  it('right at the boundary is still in-flight — only strictly beyond the window is stale', () => {
    const j = job({ uploadStatus: 'uploading', updatedAt: at(UPLOAD_STALE_AFTER_MS) });
    expect(planUpload(j, input, { now: NOW })).toEqual({ ok: false, reason: 'in-flight' });
  });

  it('missing/unparseable updatedAt cannot prove staleness, so it still refuses in-flight', () => {
    const j = job({ uploadStatus: 'uploading', updatedAt: undefined as unknown as string });
    expect(planUpload(j, input, { now: NOW })).toEqual({ ok: false, reason: 'in-flight' });
  });

  it('THE IMPORTANT ONE: a stale-and-already-uploaded job still refuses already-uploaded — staleness must never weaken the duplicate guard', () => {
    const j = job({
      uploadStatus: 'uploading',
      updatedAt: at(UPLOAD_STALE_AFTER_MS + 1000),
      youtubeVideoId: 'abc123',
    });
    expect(planUpload(j, input, { now: NOW })).toEqual({ ok: false, reason: 'already-uploaded' });
  });
});

/**
 * THE TWO ROLES.
 *
 * The route marks a job `queued` (with a fresh `updatedAt`) and only THEN
 * invokes the worker, so the worker always re-reads a job that looks
 * in-flight — because it is, and the worker is what makes it so. Running the
 * gate's concurrency refusal in the worker made it refuse every job it was
 * ever invoked for: the feature could not complete once, and each retry
 * repeated the loop. `stage: 'execute'` drops that ONE refusal.
 *
 * Everything below the concurrency check is a property of the JOB, not of who
 * is asking, so none of it may be skipped at either stage — `already-uploaded`
 * least of all, since the worker is the only caller that can actually create
 * the duplicate video.
 */
describe('planUpload — enqueue vs execute', () => {
  const NOW = Date.parse('2026-09-15T12:00:00.000Z');
  const justQueued = () =>
    job({ uploadStatus: 'queued', updatedAt: new Date(NOW - 1000).toISOString() });

  it('THE BUG: enqueue refuses a freshly-queued job, execute proceeds with it', () => {
    // Identical job, identical clock — only the role differs.
    expect(planUpload(justQueued(), input, { now: NOW, stage: 'enqueue' })).toEqual({
      ok: false,
      reason: 'in-flight',
    });
    expect(planUpload(justQueued(), input, { now: NOW, stage: 'execute' }).ok).toBe(true);
  });

  it('execute also proceeds on a fresh `uploading` — that is the resume, not a race', () => {
    const j = job({ uploadStatus: 'uploading', updatedAt: new Date(NOW - 1000).toISOString() });
    expect(planUpload(j, input, { now: NOW, stage: 'execute' }).ok).toBe(true);
  });

  it('⚠️ execute NEVER skips already-uploaded — the duplicate-video guard is not role-dependent', () => {
    const j = job({
      uploadStatus: 'queued',
      updatedAt: new Date(NOW - 1000).toISOString(),
      youtubeVideoId: 'abc123',
    });
    expect(planUpload(j, input, { now: NOW, stage: 'execute' })).toEqual({
      ok: false,
      reason: 'already-uploaded',
    });
  });

  it('execute keeps every other eligibility refusal too', () => {
    const q = { uploadStatus: 'queued' as const, updatedAt: new Date(NOW - 1000).toISOString() };
    const exec = { now: NOW, stage: 'execute' as const };
    expect(planUpload(job({ ...q, videoKey: null }), input, exec)).toEqual({ ok: false, reason: 'no-video' });
    expect(planUpload(job({ ...q, savedAt: null }), input, exec)).toEqual({ ok: false, reason: 'not-saved' });
    expect(planUpload(job(q), { ...input, title: ' ' }, exec)).toEqual({ ok: false, reason: 'no-title' });
    expect(planUpload(job(q), { ...input, description: '' }, exec)).toEqual({ ok: false, reason: 'no-description' });
  });

  it('defaults to the stricter role when no stage is named, so a forgotten option fails closed', () => {
    expect(planUpload(justQueued(), input, { now: NOW })).toEqual({ ok: false, reason: 'in-flight' });
  });
});

/**
 * Code review Finding 1 (round 1): markUploadQueued must refresh `updatedAt`,
 * not just `uploadStatus`. planUpload's in-flight guard decides "queued but
 * not yet stale" purely from the age of `updatedAt`. A render can sit
 * reviewed for half an hour before Upload is pressed — if markUploadQueued
 * left the render's old `updatedAt` in place, the job would be marked
 * `queued` and be ALREADY STALE at that instant, so a double-click would read
 * `isStale` as true and start a second invoke. This test proves the write
 * actually stamps a fresh `updatedAt`, and that the fresh value is what keeps
 * an immediate re-check `in-flight` rather than stale.
 */
describe('markUploadQueued refreshes updatedAt', () => {
  beforeEach(() => mockUpdate.mockClear());

  it('stamps updatedAt so a job marked queued is NOT immediately treated as stale', async () => {
    mockUpdate.mockResolvedValueOnce({});
    await new MasterJobRepository().markUploadQueued('j1');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const args = mockUpdate.mock.calls[0][0];
    expect(args.updateExpression).toContain('#updatedAt = :now');
    expect(args.expressionAttributeNames['#updatedAt']).toBe('updatedAt');
    const stampedUpdatedAt = args.expressionAttributeValues[':now'];
    expect(typeof stampedUpdatedAt).toBe('string');

    // Simulate the double-click: read the job back right after this write
    // (uploadStatus: 'queued', updatedAt: the value just stamped) and press
    // Upload again a second later. It must be refused as in-flight, not
    // treated as stale — proving the fresh timestamp actually reaches the
    // guard, not merely that the DynamoDB call shape looks plausible.
    const requeuedJob = job({ uploadStatus: 'queued', updatedAt: stampedUpdatedAt });
    const oneSecondLater = Date.parse(stampedUpdatedAt) + 1000;
    expect(planUpload(requeuedJob, input, { now: oneSecondLater })).toEqual({ ok: false, reason: 'in-flight' });
  });
});
