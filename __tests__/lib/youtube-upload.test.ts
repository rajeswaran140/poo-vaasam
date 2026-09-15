/** @jest-environment node */
import { planUpload, uploadRefusalMessage, type UploadRefusal } from '@/lib/youtube-upload';
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

  it('refuses while an upload is already in flight', () => {
    expect(planUpload(job({ uploadStatus: 'uploading' }), input)).toEqual({ ok: false, reason: 'in-flight' });
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
