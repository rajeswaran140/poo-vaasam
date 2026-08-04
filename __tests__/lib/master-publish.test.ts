/** @jest-environment node */
/**
 * Publishing a mastered web MP3 to the site's audio path.
 *
 * This is the first thing in the module that writes to a PUBLIC, CDN-served
 * location, and to a key that is canonical per song — `audio/poem-music/<Tamil
 * title>.mp3` is what listeners hear. So the tests here are mostly about what
 * it REFUSES to do: publish under a machine name, publish a file measured above
 * the peak ceiling, or publish twice.
 */
import {
  planPublish,
  publishKeyForTitle,
  publishRefusalMessage,
  SITE_AUDIO_PREFIX,
} from '@/lib/master-publish';
import type { MasterJob } from '@/types/masterJob';

const baseJob: MasterJob = {
  id: 'j1',
  status: 'done',
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:05:00.000Z',
  s3Key: 'audio/mastering/1_ab_take.wav',
  target: -14,
  edit: null,
  editedDurationSec: null,
  mp3Key: 'audio/mastering/1_ab_take-master-14LUFS.mp3',
  mp3Lufs: -14.0,
  mp3Tp: -3.55,
  masterKey: 'audio/mastering/1_ab_take-master-14LUFS.wav',
  beforeLufs: -14.4,
  beforeTp: -3.6,
  afterLufs: -14.0,
  afterTp: -3.5,
  beforeLra: 3.0,
  afterLra: 3.0,
  normalizationType: 'linear',
  source: null,
  savedAt: '2026-08-04T00:06:00.000Z',
  title: 'அந்தி மேகமே',
  archivedAt: null,
  archiveKey: null,
  archiveError: null,
  publishedAt: null,
  publishKey: null,
  publishError: null,
  error: null,
};
const job = (over: Partial<MasterJob> = {}): MasterJob => ({ ...baseJob, ...over });

describe('publishKeyForTitle', () => {
  it('names the file after the song, in Tamil, under the site prefix', () => {
    expect(publishKeyForTitle('அந்தி மேகமே')).toBe(`${SITE_AUDIO_PREFIX}அந்தி மேகமே.mp3`);
  });

  it('does not double the extension when the title already carries one', () => {
    expect(publishKeyForTitle('அந்தி மேகமே.mp3')).toBe(`${SITE_AUDIO_PREFIX}அந்தி மேகமே.mp3`);
    expect(publishKeyForTitle('Song.wav')).toBe(`${SITE_AUDIO_PREFIX}Song.mp3`);
  });

  it('cannot escape the prefix, whatever the title contains', () => {
    // The title reaches this from an admin text field and the result is an S3
    // key in a public bucket, so the invariant is: the key stays inside
    // audio/poem-music/ and names exactly ONE object.
    //
    // NOTE `../../evil` becomes `.. .. evil.mp3` — the dots survive, and that
    // is fine. Separators are what traverse; S3 keys are flat strings, so dots
    // with no slash are just an odd filename. Asserting "no dots" would be
    // testing for a mechanism rather than the property that matters.
    for (const evil of ['../../evil', 'a/b/c', '..\\..\\evil', 'x"y']) {
      const key = publishKeyForTitle(evil);
      if (key === null) continue;
      expect(key.startsWith(SITE_AUDIO_PREFIX)).toBe(true);
      const name = key.slice(SITE_AUDIO_PREFIX.length);
      expect(name).not.toContain('/');
      expect(name).not.toContain('\\');
    }
  });

  it('refuses a title that sanitises to nothing rather than inventing a name', () => {
    expect(publishKeyForTitle('')).toBeNull();
    expect(publishKeyForTitle('   ')).toBeNull();
    expect(publishKeyForTitle(null)).toBeNull();
  });
});

describe('planPublish', () => {
  it('publishes the MP3 — never the WAV — for a clean saved master', () => {
    const plan = planPublish(job());
    expect(plan).toEqual({
      ok: true,
      mp3Key: 'audio/mastering/1_ab_take-master-14LUFS.mp3',
      publishKey: `${SITE_AUDIO_PREFIX}அந்தி மேகமே.mp3`,
    });
    // The site serves 192k MP3 deliberately: ~70% India / ~10% Sri Lanka on
    // mobile links, where a 70 MB WAV was the original "it won't play" bug.
    if (plan.ok) expect(plan.mp3Key).toMatch(/\.mp3$/);
  });

  it('REFUSES an MP3 measured above the peak ceiling', () => {
    // The whole documented value of this module is peak safety. Two catalogue
    // songs sit above -1 dBTP; this is the gate that would have stopped them.
    const plan = planPublish(job({ mp3Tp: -0.4 }));
    expect(plan).toEqual({ ok: false, reason: 'peak-hot' });
    expect(publishRefusalMessage('peak-hot')).toMatch(/Re-master/);
    expect(publishRefusalMessage('peak-hot')).toMatch(/re-encoding will not fix/i);
  });

  it('allows an UNMEASURED peak, matching the readiness rule', () => {
    // A check that never ran is not a failure. Deliberately different from the
    // hot case above, and the caller surfaces it as a caveat.
    expect(planPublish(job({ mp3Tp: null })).ok).toBe(true);
  });

  it('refuses an untitled master rather than publishing a machine name', () => {
    // `1780067292588_ab3f_take-master-14LUFS.mp3` on a public song path would
    // rebuild the orphan problem the library exists to prevent.
    expect(planPublish(job({ title: null }))).toEqual({ ok: false, reason: 'no-title' });
    expect(planPublish(job({ title: '   ' }))).toEqual({ ok: false, reason: 'no-title' });
  });

  it('refuses an unsaved job — the title is the filename, and save persists it', () => {
    expect(planPublish(job({ savedAt: null }))).toEqual({ ok: false, reason: 'not-saved' });
  });

  it('refuses a job with no MP3, and says the export is automatic', () => {
    expect(planPublish(job({ mp3Key: null }))).toEqual({ ok: false, reason: 'no-mp3' });
    expect(publishRefusalMessage('no-mp3')).toMatch(/Re-master/);
  });

  it('refuses to publish the same job twice', () => {
    expect(planPublish(job({ publishedAt: '2026-08-04T01:00:00.000Z' }))).toEqual({
      ok: false,
      reason: 'already-published',
    });
  });

  it('refuses an unfinished job', () => {
    expect(planPublish(job({ status: 'processing' })).ok).toBe(false);
    expect(planPublish(job({ status: 'error' })).ok).toBe(false);
  });

  /**
   * Order matters for the message the operator sees. A hot MP3 on an untitled
   * master should say "re-master", not "name it" — naming it would not make it
   * publishable, and sending someone to fix the wrong thing is worse than a
   * blunt refusal.
   */
  it('reports the peak problem before the naming problem', () => {
    expect(planPublish(job({ title: null, mp3Tp: -0.4 }))).toEqual({ ok: false, reason: 'peak-hot' });
  });

  it('every refusal has a message, and none is empty', () => {
    for (const r of ['not-done', 'not-saved', 'no-title', 'no-mp3', 'peak-hot', 'already-published'] as const) {
      expect(publishRefusalMessage(r).length).toBeGreaterThan(10);
    }
  });
});
