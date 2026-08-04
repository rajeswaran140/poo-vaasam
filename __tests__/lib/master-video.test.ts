/** @jest-environment node */
/**
 * Rendering the YouTube video.
 *
 * The point of doing this in the module rather than Premiere is that the audio
 * path stops being a matter of discipline: the render reads the mastered WAV and
 * encodes it exactly once. So the tests that matter are the ones that would
 * catch that path silently regressing — the wrong source file, a quietly lowered
 * bitrate, a resample — none of which any listener could attribute and none of
 * which would look like a failure.
 */
import {
  planRender,
  renderRefusalMessage,
  buildVideoArgs,
  buildVideoFilter,
  videoKeyFor,
  videoWidthFor,
  isRenderedVideoKey,
  VIDEO_HEIGHTS,
  DEFAULT_VIDEO_HEIGHT,
  VIDEO_AUDIO_BITRATE,
  VIDEO_SAMPLE_RATE,
} from '@/lib/master-video';
import type { MasterJob } from '@/types/masterJob';

const baseJob: MasterJob = {
  id: 'j1',
  status: 'done',
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:05:00.000Z',
  s3Key: 'audio/mastering/1_ab_take.wav',
  target: -14,
  edit: null,
  join: null,
  editedDurationSec: null,
  mp3Key: 'audio/mastering/1_ab_take-master-14LUFS.mp3',
  mp3Lufs: -14,
  mp3Tp: -3.5,
  masterKey: 'audio/mastering/1_ab_take-master-14LUFS.wav',
  beforeLufs: -14.4, beforeTp: -3.6, afterLufs: -14, afterTp: -3.5,
  beforeLra: 3, afterLra: 3,
  normalizationType: 'linear',
  source: null,
  savedAt: '2026-08-04T00:06:00.000Z',
  title: 'அந்தி மேகமே',
  archivedAt: null, archiveKey: null, archiveError: null,
  publishedAt: null, publishKey: null, publishError: null,
  videoKey: null, videoRenderedAt: null, videoError: null, coverKey: null,
  error: null,
};
const job = (over: Partial<MasterJob> = {}): MasterJob => ({ ...baseJob, ...over });
const COVER = 'audio/mastering/1_cd_cover.jpg';

describe('the encode settings are the whole point', () => {
  const args = buildVideoArgs({ coverPath: '/tmp/c.jpg', audioPath: '/tmp/master.wav', outPath: '/tmp/o.mp4' });

  it('encodes the audio at 384k, well above what YouTube will keep', () => {
    // A quiet regression to 192k here would be inaudible in review and audible
    // in the finished upload, since YouTube transcodes this file again.
    expect(VIDEO_AUDIO_BITRATE).toBe('384k');
    expect(args[args.indexOf('-b:a') + 1]).toBe('384k');
    expect(args).toContain('aac');
  });

  it('keeps the master\'s own sample rate, so nothing resamples on the way out', () => {
    expect(VIDEO_SAMPLE_RATE).toBe(48000);
    expect(args[args.indexOf('-ar') + 1]).toBe('48000');
  });

  it('takes the audio from the second input — the WAV, not the cover', () => {
    expect(args[args.lastIndexOf('-i') + 1]).toBe('/tmp/master.wav');
    expect(args[args.indexOf('-map', args.indexOf('-map') + 1) + 1]).toBe('1:a');
  });

  it('defaults to 1440p, which is what earns the better codec on YouTube', () => {
    expect(DEFAULT_VIDEO_HEIGHT).toBe(1440);
    expect(buildVideoArgs({ coverPath: 'c', audioPath: 'a', outPath: 'o' })).toEqual(
      buildVideoArgs({ coverPath: 'c', audioPath: 'a', outPath: 'o', height: 1440 })
    );
  });

  it('ends the video with the audio, and loops the still to get there', () => {
    // Without -shortest the looped cover never ends and the encode runs until
    // the Lambda is killed.
    expect(args).toContain('-shortest');
    expect(args).toContain('-loop');
  });

  it('emits a file YouTube can ingest without re-muxing', () => {
    expect(args).toEqual(expect.arrayContaining(['-pix_fmt', 'yuv420p']));
    expect(args).toEqual(expect.arrayContaining(['-movflags', '+faststart']));
    expect(args[args.length - 1]).toBe('/tmp/o.mp4');
  });

  it('tunes for a still image, which is what makes a six-minute 1440p render cheap', () => {
    expect(args).toEqual(expect.arrayContaining(['-tune', 'stillimage']));
  });
});

describe('frame geometry', () => {
  it('is 16:9 at every offered height, with an even width', () => {
    for (const h of VIDEO_HEIGHTS) {
      const w = videoWidthFor(h);
      expect(w % 2).toBe(0); // yuv420p cannot encode an odd dimension
      expect(Math.abs(w / h - 16 / 9)).toBeLessThan(0.01);
    }
    expect(videoWidthFor(1440)).toBe(2560);
    expect(videoWidthFor(1080)).toBe(1920);
    expect(videoWidthFor(2160)).toBe(3840);
  });

  it('fills the frame with a blurred cover rather than pillarboxing', () => {
    // A square cover in a 16:9 frame otherwise leaves two black slabs, which
    // reads as a broken upload.
    const f = buildVideoFilter(1440);
    expect(f).toContain('boxblur');
    expect(f).toContain('scale=2560:1440:force_original_aspect_ratio=increase');
    expect(f).toContain('overlay=(W-w)/2:(H-h)/2[v]');
  });

  it('scales the artwork itself without distorting it', () => {
    expect(buildVideoFilter(1440)).toContain('force_original_aspect_ratio=decrease');
  });
});

describe('videoKeyFor', () => {
  it('sits beside the master, named for its height', () => {
    expect(videoKeyFor('audio/mastering/x-master-14LUFS.wav', 1440))
      .toBe('audio/mastering/x-master-14LUFS-1440p.mp4');
  });

  it('keeps heights distinct so a re-render cannot overwrite another upload', () => {
    const a = videoKeyFor('audio/mastering/x-master-14LUFS.wav', 1080);
    const b = videoKeyFor('audio/mastering/x-master-14LUFS.wav', 1440);
    expect(a).not.toBe(b);
  });

  it('recognises its own output, and does not claim the master or the MP3', () => {
    expect(isRenderedVideoKey('audio/mastering/x-master-14LUFS-1440p.mp4')).toBe(true);
    expect(isRenderedVideoKey('audio/mastering/x-master-14LUFS.wav')).toBe(false);
    expect(isRenderedVideoKey('audio/mastering/x-master-14LUFS.mp3')).toBe(false);
    expect(isRenderedVideoKey('videos/holiday.mp4')).toBe(false);
  });
});

describe('planRender', () => {
  it('renders from the MASTER, never the web MP3', () => {
    // The entire reason this lives in the module: the 192k file exists on the
    // same job and would stack a lossy generation in front of YouTube's own.
    const plan = planRender(job(), COVER);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.audioKey).toBe(baseJob.masterKey);
      expect(plan.audioKey).not.toBe(baseJob.mp3Key);
      expect(plan.videoKey).toBe('audio/mastering/1_ab_take-master-14LUFS-1440p.mp4');
    }
  });

  it('refuses an unsaved master — a video whose provenance expires in 24h', () => {
    expect(planRender(job({ savedAt: null }), COVER)).toEqual({ ok: false, reason: 'not-saved' });
  });

  it('refuses a job with no mastered WAV rather than falling back to anything', () => {
    expect(planRender(job({ masterKey: null }), COVER)).toEqual({ ok: false, reason: 'no-master' });
  });

  it('requires a cover, and requires it to be in the workspace', () => {
    expect(planRender(job(), null)).toEqual({ ok: false, reason: 'no-cover' });
    expect(planRender(job(), '')).toEqual({ ok: false, reason: 'no-cover' });
    // The worker's role can read the entire bucket, so an arbitrary key here
    // would be a second way to make it fetch whatever it likes.
    for (const bad of ['images/song-covers/x.png', '../../etc/passwd', 'audio/mastering/../x.png']) {
      expect(planRender(job(), bad)).toEqual({ ok: false, reason: 'bad-cover' });
    }
  });

  it('refuses a height it does not offer', () => {
    for (const h of [720, 1441, 0, -1080, 4321]) {
      expect(planRender(job(), COVER, h)).toEqual({ ok: false, reason: 'bad-height' });
    }
    for (const h of VIDEO_HEIGHTS) {
      expect(planRender(job(), COVER, h).ok).toBe(true);
    }
  });

  it('refuses an unfinished job', () => {
    expect(planRender(job({ status: 'processing' }), COVER).ok).toBe(false);
    expect(planRender(job({ status: 'error' }), COVER).ok).toBe(false);
  });

  it('allows a re-render — a cover is the thing most likely to be replaced', () => {
    // Deliberately unlike publishing, which refuses a second run: re-rendering
    // overwrites only a workspace file nobody has uploaded yet.
    expect(planRender(job({ videoKey: 'audio/mastering/x-1440p.mp4', videoRenderedAt: 'x' }), COVER).ok).toBe(true);
  });

  it('every refusal has actionable wording', () => {
    for (const r of ['not-done', 'not-saved', 'no-master', 'no-cover', 'bad-cover', 'bad-height'] as const) {
      expect(renderRefusalMessage(r).length).toBeGreaterThan(10);
    }
  });
});
