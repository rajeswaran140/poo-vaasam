/** @jest-environment node */
import { planUpload, uploadRefusalMessage, UPLOAD_STALE_AFTER_MS, type UploadRefusal } from '@/lib/youtube-upload';
import type { MasterJob } from '@/types/masterJob';

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
    const all: UploadRefusal[] = ['no-video', 'not-saved', 'no-title', 'no-description', 'already-uploaded', 'in-flight'];
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
    expect(planUpload(j, input, NOW)).toEqual({ ok: false, reason: 'in-flight' });
  });

  it('treats uploading as resumable once updatedAt is older than the stale window', () => {
    const j = job({ uploadStatus: 'uploading', updatedAt: at(UPLOAD_STALE_AFTER_MS + 1000) });
    expect(planUpload(j, input, NOW).ok).toBe(true);
  });

  it('queued gets the identical treatment: fresh refuses, stale proceeds', () => {
    const fresh = job({ uploadStatus: 'queued', updatedAt: at(1000) });
    expect(planUpload(fresh, input, NOW)).toEqual({ ok: false, reason: 'in-flight' });

    const stale = job({ uploadStatus: 'queued', updatedAt: at(UPLOAD_STALE_AFTER_MS + 1000) });
    expect(planUpload(stale, input, NOW).ok).toBe(true);
  });

  it('right at the boundary is still in-flight — only strictly beyond the window is stale', () => {
    const j = job({ uploadStatus: 'uploading', updatedAt: at(UPLOAD_STALE_AFTER_MS) });
    expect(planUpload(j, input, NOW)).toEqual({ ok: false, reason: 'in-flight' });
  });

  it('missing/unparseable updatedAt cannot prove staleness, so it still refuses in-flight', () => {
    const j = job({ uploadStatus: 'uploading', updatedAt: undefined as unknown as string });
    expect(planUpload(j, input, NOW)).toEqual({ ok: false, reason: 'in-flight' });
  });

  it('THE IMPORTANT ONE: a stale-and-already-uploaded job still refuses already-uploaded — staleness must never weaken the duplicate guard', () => {
    const j = job({
      uploadStatus: 'uploading',
      updatedAt: at(UPLOAD_STALE_AFTER_MS + 1000),
      youtubeVideoId: 'abc123',
    });
    expect(planUpload(j, input, NOW)).toEqual({ ok: false, reason: 'already-uploaded' });
  });
});
