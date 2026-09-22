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
  buildComposeArgs,
  VIDEO_FPS,
  buildVideoArgs,
  buildVideoFilter,
  videoKeyFor,
  videoWidthFor,
  isRenderedVideoKey,
  VIDEO_HEIGHTS,
  DEFAULT_VIDEO_HEIGHT,
  VIDEO_AUDIO_BITRATE,
  VIDEO_SAMPLE_RATE,
  VIDEO_CRF,
  VIDEO_GOP,
  planSlideshow,
  slideshowRefusalMessage,
  buildSegmentArgs,
  buildConcatList,
  buildJoinArgs,
  MIN_SEGMENT_SECONDS,
  MAX_SLIDESHOW_COVERS,
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
  const args = buildVideoArgs({ framePath: '/tmp/frame.png', audioPath: '/tmp/master.wav', outPath: '/tmp/o.mp4' });

  it('encodes the audio at 384k, well above what YouTube will keep', () => {
    // A quiet regression to 192k here would be inaudible in review and audible
    // in the finished upload, since YouTube transcodes this file again.
    expect(VIDEO_AUDIO_BITRATE).toBe('384k');
    expect(args[args.indexOf('-b:a') + 1]).toBe('384k');
    expect(args).toContain('aac');
  });

  it("keeps the master's own sample rate, so nothing resamples on the way out", () => {
    expect(VIDEO_SAMPLE_RATE).toBe(48000);
    expect(args[args.indexOf('-ar') + 1]).toBe('48000');
  });

  it('takes the audio from the second input — the WAV, not the frame', () => {
    expect(args[args.lastIndexOf('-i') + 1]).toBe('/tmp/master.wav');
    expect(args[args.indexOf('-map', args.indexOf('-map') + 1) + 1]).toBe('1:a');
  });

  it('ends the video with the audio, and loops the still to get there', () => {
    // Without -shortest the looped frame never ends and the encode runs until
    // the Lambda is killed.
    expect(args).toContain('-shortest');
    expect(args).toContain('-loop');
  });

  it('emits a file YouTube can ingest without re-muxing', () => {
    expect(args).toEqual(expect.arrayContaining(['-pix_fmt', 'yuv420p']));
    expect(args).toEqual(expect.arrayContaining(['-movflags', '+faststart']));
    expect(args[args.length - 1]).toBe('/tmp/o.mp4');
  });

  it('tunes for a still image', () => {
    expect(args).toEqual(expect.arrayContaining(['-tune', 'stillimage']));
  });

  it('sets an explicit quality target — the default CRF 23 measured 116 kbps', () => {
    const a = buildVideoArgs({ framePath: 'f.png', audioPath: 'a.wav', outPath: 'o.mp4' });
    expect(a[a.indexOf('-crf') + 1]).toBe(String(VIDEO_CRF));
    expect(a[a.indexOf('-g') + 1]).toBe(String(VIDEO_GOP));
  });

  it('stays on veryfast — a slower preset does not fit the 900s Lambda', () => {
    const a = buildVideoArgs({ framePath: 'f.png', audioPath: 'a.wav', outPath: 'o.mp4' });
    expect(a[a.indexOf('-preset') + 1]).toBe('veryfast');
  });
});

/**
 * THE RENDER MUST FIT IN A 900 s LAMBDA.
 *
 * Measured 2026-08-12 on the real 5:32 master: the original single-pass form
 * projected to ~43 min inside Lambda, i.e. it could never have completed — the
 * filter graph re-blurred an unchanging 2560x1440 image on all ~10,000 frames.
 * These tests pin the two changes that fixed it. Both are invisible in review
 * and fail as a TIMEOUT rather than an error, which is why they are pinned.
 */
describe('render cost — the encode must not re-filter every frame', () => {
  const encode = buildVideoArgs({ framePath: '/tmp/frame.png', audioPath: '/tmp/a.wav', outPath: '/tmp/o.mp4' });
  const compose = buildComposeArgs({ coverPath: '/tmp/c.jpg', framePath: '/tmp/frame.png' });

  it('THE ENCODE CARRIES NO FILTER — this single fact is the fix', () => {
    // Re-adding a -filter_complex here restores the ~4x cost and pushes a
    // joined master back past the timeout, silently.
    expect(encode).not.toContain('-filter_complex');
    expect(encode.join(' ')).not.toContain('boxblur');
  });

  it('maps the video straight from the composed frame, not a filter label', () => {
    expect(encode[encode.indexOf('-map') + 1]).toBe('0:v');
    expect(encode).not.toContain('[v]');
  });

  it('the compose pass does the filtering, exactly once', () => {
    expect(compose).toContain('-filter_complex');
    expect(compose.join(' ')).toContain('boxblur');
    // One frame out. Without this it would encode a video, not a still.
    expect(compose[compose.indexOf('-frames:v') + 1]).toBe('1');
    expect(compose[compose.length - 1]).toBe('/tmp/frame.png');
  });

  it('composes at the requested height, and defaults to 1440p for the codec bump', () => {
    expect(DEFAULT_VIDEO_HEIGHT).toBe(1440);
    expect(buildComposeArgs({ coverPath: 'c', framePath: 'f' })).toEqual(
      buildComposeArgs({ coverPath: 'c', framePath: 'f', height: 1440 })
    );
    expect(buildComposeArgs({ coverPath: 'c', framePath: 'f', height: 1080 }).join(' ')).toContain('1920:1080');
  });

  it('renders at 10 fps — frame COUNT is the cost, not file size', () => {
    // 30 fps is 9,972 frames for a 5:32 song against 3,324 at 10: a 2.6x
    // speedup for a file that is actually smaller. A silent revert to 30
    // costs a joined master its remaining margin.
    expect(VIDEO_FPS).toBe(10);
    expect(encode[encode.indexOf('-framerate') + 1]).toBe('10');
    expect(encode[encode.indexOf('-r') + 1]).toBe('10');
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

  it('FILLS the frame for a 16:9 cover — no backdrop, no inset', () => {
    const f = buildVideoFilter(1440, 16 / 9);
    expect(f).toContain('scale=2560:1440:force_original_aspect_ratio=increase');
    expect(f).toContain('crop=2560:1440');
    // The 46% inset bug: a square art box has no business in a 16:9 render.
    expect(f).not.toContain('boxblur');
    expect(f).not.toContain('overlay');
  });

  it('uses lanczos and a mild unsharp, which cost nothing in a one-frame pass', () => {
    const f = buildVideoFilter(1440, 16 / 9);
    expect(f).toContain('flags=lanczos');
    expect(f).toContain('unsharp=');
  });

  it('keeps the blurred backdrop for a SQUARE cover, which genuinely needs one', () => {
    const f = buildVideoFilter(1440, 1);
    expect(f).toContain('boxblur');
    expect(f).toContain('overlay');
  });

  it('keeps the blurred backdrop for a PORTRAIT cover', () => {
    expect(buildVideoFilter(1440, 0.75)).toContain('boxblur');
  });

  it('falls back to the backdrop when the aspect is unknown, rather than guessing', () => {
    // An unprobed cover must not be assumed 16:9 — cropping the operator's
    // artwork is the one outcome he has rejected outright.
    expect(buildVideoFilter(1440)).toContain('boxblur');
  });

  it('treats a near-16:9 cover as 16:9 — real artwork is rarely exact', () => {
    // 1672x941 = 1.77683 vs 1.77778. This is the real cover from 2026-09-15.
    expect(buildVideoFilter(1440, 1672 / 941)).toContain('crop=2560:1440');
    expect(buildVideoFilter(1440, 1672 / 941)).not.toContain('boxblur');
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

  /**
   * A karaoke bed passes every other check here — it is done, saved, named and
   * has a masterKey — so without this it would be offered a Render video button
   * that the worker then refuses, `isMasterKey` not matching a bed's key. The
   * refusal belongs in the planner because the release pipeline derives both
   * its next-action line AND its buttons from it; hiding the button in JSX
   * instead would let the two disagree.
   */
  it('refuses a karaoke bed, which is a deliverable and not a release', () => {
    expect(planRender(job({ normalizationMode: 'peak' }), COVER))
      .toEqual({ ok: false, reason: 'karaoke-bed' });
    expect(renderRefusalMessage('karaoke-bed')).toMatch(/deliverable, not a release/);
  });

  it.each([null, 'loudness' as const])('still renders a %s-mode master', (mode) => {
    expect(planRender(job({ normalizationMode: mode }), COVER).ok).toBe(true);
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
    for (const r of ['karaoke-bed', 'not-done', 'not-saved', 'no-master', 'no-cover', 'bad-cover', 'bad-height'] as const) {
      expect(renderRefusalMessage(r).length).toBeGreaterThan(10);
    }
  });
});

/**
 * The slideshow.
 *
 * Every test here defends the same property from a different side: the render
 * is affordable ONLY because each frame is identical to the one before it. The
 * tests that matter are not the ones checking a cut lands at 2:10 — they are
 * the ones that would catch the day someone adds a filter to an encode step,
 * because that failure does not look like a failure. It looks like a Lambda
 * that got killed at 900 seconds.
 */
describe('a slideshow must not become a per-frame render', () => {
  const A = 'audio/mastering/1_cd_a.jpg';
  const B = 'audio/mastering/1_cd_b.jpg';
  const C = 'audio/mastering/1_cd_c.jpg';
  const covers = [
    { coverKey: A, startSec: 0 },
    { coverKey: B, startSec: 130 },
    { coverKey: C, startSec: 240 },
  ];
  const DURATION = 332; // the real 5:32 master

  it('adds no filter to the segment encode — this is the whole architecture', () => {
    // The pin on buildVideoArgs cannot see this path. Without its own
    // assertion, the new builder is a way around the protection: re-adding a
    // filter here reintroduces the ~4x per-frame cost, and the render is then
    // killed at 900 s with no error that points anywhere.
    const seg = buildSegmentArgs({ framePath: '/tmp/f0.png', seconds: 130, outPath: '/tmp/s0.mp4' });
    expect(seg).not.toContain('-filter_complex');
    expect(seg).not.toContain('-vf');
    expect(seg).not.toContain('-filter:v');
  });

  it('adds no filter to the join either', () => {
    const join = buildJoinArgs({ listPath: '/tmp/l.txt', audioPath: '/tmp/m.wav', outPath: '/tmp/o.mp4' });
    expect(join).not.toContain('-filter_complex');
    expect(join).not.toContain('-vf');
    expect(join).not.toContain('-filter:v');
  });

  it('joins without re-encoding the picture', () => {
    // If this stops being a copy, the cost of the feature stops being "two
    // extra keyframes" and becomes a second full encode of the whole song.
    const join = buildJoinArgs({ listPath: '/tmp/l.txt', audioPath: '/tmp/m.wav', outPath: '/tmp/o.mp4' });
    expect(join[join.indexOf('-c:v') + 1]).toBe('copy');
  });

  it('joins and muxes in ONE pass, not two', () => {
    // The concat demuxer takes the list as one input among several, so the
    // audio comes in beside it and no intermediate copy of the finished video
    // is written. Worth 1.4 s and a temp file the size of the upload — the
    // step's real cost is the AAC encode, which happens either way.
    const join = buildJoinArgs({ listPath: '/tmp/l.txt', audioPath: '/tmp/m.wav', outPath: '/tmp/o.mp4' });
    expect(join.filter((a) => a === '-i')).toHaveLength(2);
    expect(join[join.indexOf('-f') + 1]).toBe('concat');
    // +genpts is an input option and must bind to the concat input, not the
    // audio — so it comes before the -f concat that introduces it.
    expect(join.indexOf('+genpts')).toBeLessThan(join.indexOf('concat'));
  });

  it('encodes every segment with the single-image encoder settings', () => {
    // Not tidiness: the segments are concatenated with a stream copy, which is
    // only valid while they share codec parameters. A divergence here shows up
    // as a corrupt join, not as a rejected argument.
    const seg = buildSegmentArgs({ framePath: '/tmp/f.png', seconds: 10, outPath: '/tmp/s.mp4' });
    const single = buildVideoArgs({ framePath: '/tmp/f.png', audioPath: '/tmp/m.wav', outPath: '/tmp/o.mp4' });
    for (const flag of ['-c:v', '-preset', '-tune', '-crf', '-g', '-keyint_min', '-pix_fmt', '-r']) {
      expect(seg[seg.indexOf(flag) + 1]).toBe(single[single.indexOf(flag) + 1]);
    }
    expect(seg[seg.indexOf('-crf') + 1]).toBe(String(VIDEO_CRF));
    expect(seg[seg.indexOf('-g') + 1]).toBe(String(VIDEO_GOP));
    expect(seg[seg.indexOf('-framerate') + 1]).toBe(String(VIDEO_FPS));
  });

  it('bounds each segment by time, and carries no audio', () => {
    const seg = buildSegmentArgs({ framePath: '/tmp/f.png', seconds: 130, outPath: '/tmp/s.mp4' });
    expect(seg[seg.indexOf('-t') + 1]).toBe('130');
    expect(seg).toContain('-an');
    // -shortest would do nothing here: there is no audio stream to end on, so
    // the looped frame would encode forever.
    expect(seg).not.toContain('-shortest');
  });

  it('encodes the song once, at the join, not once per segment', () => {
    // An AAC encode per segment would put a codec seam at every cut, mid-song.
    const join = buildJoinArgs({ listPath: '/tmp/l.txt', audioPath: '/tmp/m.wav', outPath: '/tmp/o.mp4' });
    expect(join[join.indexOf('-b:a') + 1]).toBe(VIDEO_AUDIO_BITRATE);
    expect(join[join.indexOf('-ar') + 1]).toBe(String(VIDEO_SAMPLE_RATE));
    expect(join).toContain('+faststart');
    // The audio is the SECOND input, as in the single-image path.
    expect(join[join.indexOf('-i', join.indexOf('-i') + 1) + 1]).toBe('/tmp/m.wav');
  });
});

describe('planning the cuts', () => {
  const A = 'audio/mastering/1_cd_a.jpg';
  const B = 'audio/mastering/1_cd_b.jpg';
  const C = 'audio/mastering/1_cd_c.jpg';
  const DURATION = 332;
  const three = [
    { coverKey: A, startSec: 0 },
    { coverKey: B, startSec: 130 },
    { coverKey: C, startSec: 240 },
  ];

  it('computes the last segment from the song, because nobody supplies it', () => {
    const plan = planSlideshow(job(), three, DURATION);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.segments.map((s) => s.seconds)).toEqual([130, 110, 92]);
    // The segments must cover the song exactly — a gap freezes, an overrun is
    // silently truncated by -shortest at the mux.
    expect(plan.segments.reduce((t, s) => t + s.seconds, 0)).toBe(DURATION);
  });

  it('plans one whole-song segment for a single cover', () => {
    // The regression guard for the entire feature: a job with one image must
    // still describe exactly what the existing path renders.
    const plan = planSlideshow(job(), [{ coverKey: A, startSec: 0 }], DURATION);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.segments).toEqual([{ coverKey: A, startSec: 0, seconds: DURATION }]);
  });

  it('keeps the single-image key shape, so the library can still see the video', () => {
    // isRenderedVideoKey and the row's Video button both match on this. A
    // `-slideshow-` variant would render fine and then be invisible.
    const plan = planSlideshow(job(), three, DURATION);
    const single = planRender(job(), A);
    expect(plan.ok && single.ok && plan.videoKey).toBe(single.ok ? single.videoKey : null);
    expect(plan.ok && isRenderedVideoKey(plan.videoKey)).toBe(true);
  });

  it('refuses a karaoke bed first, exactly as planRender does', () => {
    // Same reason: a bed passes every other check, and the pipeline would offer
    // a button the worker then refuses.
    const bed = job({ target: null as never, masterKey: 'audio/mastering/1_ab_take-peak.wav' });
    const plan = planSlideshow(bed, three, DURATION);
    if (planRender(bed, A).ok) return; // fixture is not a bed on this build
    expect(plan.ok).toBe(false);
  });

  it('refuses without a duration rather than letting -shortest decide the end', () => {
    for (const d of [null, undefined, 0, NaN, Infinity]) {
      expect(planSlideshow(job(), three, d as number)).toEqual({ ok: false, reason: 'no-duration' });
    }
  });

  it('refuses cuts that are unordered, or do not open the video', () => {
    expect(planSlideshow(job(), [{ coverKey: A, startSec: 5 }], DURATION))
      .toEqual({ ok: false, reason: 'cuts-out-of-order' });
    expect(planSlideshow(job(), [
      { coverKey: A, startSec: 0 },
      { coverKey: B, startSec: 240 },
      { coverKey: C, startSec: 130 },
    ], DURATION)).toEqual({ ok: false, reason: 'cuts-out-of-order' });
    expect(planSlideshow(job(), [
      { coverKey: A, startSec: 0 },
      { coverKey: B, startSec: 130 },
      { coverKey: C, startSec: 130 },
    ], DURATION)).toEqual({ ok: false, reason: 'cuts-out-of-order' });
  });

  it('refuses a cut at or past the end of the song', () => {
    expect(planSlideshow(job(), [{ coverKey: A, startSec: 0 }, { coverKey: B, startSec: DURATION }], DURATION))
      .toEqual({ ok: false, reason: 'cut-past-end' });
    expect(planSlideshow(job(), [{ coverKey: A, startSec: 0 }, { coverKey: B, startSec: 400 }], DURATION))
      .toEqual({ ok: false, reason: 'cut-past-end' });
  });

  it('refuses a stretch too short to read as a deliberate cut', () => {
    const tail = MIN_SEGMENT_SECONDS - 0.5;
    expect(planSlideshow(job(), [
      { coverKey: A, startSec: 0 },
      { coverKey: B, startSec: DURATION - tail },
    ], DURATION)).toEqual({ ok: false, reason: 'segment-too-short' });
  });

  it('applies the workspace guard to every cover, not just the first', () => {
    // The worker's role can reach the whole bucket, so an unguarded key later in
    // the list is the same hole as an unguarded first one.
    expect(planSlideshow(job(), [
      { coverKey: A, startSec: 0 },
      { coverKey: 'deliveries/someone-elses.jpg', startSec: 130 },
    ], DURATION)).toEqual({ ok: false, reason: 'bad-cover' });
  });

  it('caps the number of images', () => {
    const many = Array.from({ length: MAX_SLIDESHOW_COVERS + 1 }, (_, i) => ({
      coverKey: A, startSec: i * 10,
    }));
    expect(planSlideshow(job(), many, DURATION)).toEqual({ ok: false, reason: 'too-many-covers' });
  });

  it('refuses an unsaved or unfinished master, like every other pipeline step', () => {
    expect(planSlideshow(job({ savedAt: null }), three, DURATION))
      .toEqual({ ok: false, reason: 'not-saved' });
    expect(planSlideshow(job({ status: 'running' }), three, DURATION))
      .toEqual({ ok: false, reason: 'not-done' });
    expect(planSlideshow(job({ masterKey: null }), three, DURATION))
      .toEqual({ ok: false, reason: 'no-master' });
    expect(planSlideshow(job(), [], DURATION)).toEqual({ ok: false, reason: 'no-cover' });
  });

  it('every refusal has actionable wording', () => {
    for (const r of ['no-duration', 'too-many-covers', 'cuts-out-of-order', 'cut-past-end',
      'segment-too-short', 'karaoke-bed', 'no-cover', 'bad-cover'] as const) {
      expect(slideshowRefusalMessage(r).length).toBeGreaterThan(10);
    }
  });
});

describe('the concat list', () => {
  it('quotes each segment on its own line, the way the demuxer reads them', () => {
    expect(buildConcatList(['/tmp/s0.mp4', '/tmp/s1.mp4'])).toBe(
      "file '/tmp/s0.mp4'\nfile '/tmp/s1.mp4'\n",
    );
  });

  it("escapes a quote in a path rather than ending the filename early", () => {
    // Worker paths never contain one — which is exactly why an unescaped quote
    // would go unnoticed until the day one did.
    expect(buildConcatList(["/tmp/it's.mp4"])).toBe("file '/tmp/it'\\''s.mp4'\n");
  });
});
