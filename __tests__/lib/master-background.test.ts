/** @jest-environment node */
/**
 * A video background: a clip or GIF looped under the song.
 *
 * The failures worth pinning are the silent ones: a background that crops the
 * operator's artwork, a picture that runs past the song or cuts it short, a
 * loop whose bitrate is unbounded (a 5 GB file), and a key outside the
 * workspace reaching a worker that can read the whole bucket.
 */
import {
  ACCEPTED_BACKGROUND_TYPES,
  backgroundExtensionFor,
  masteringBackgroundKey,
  isBackgroundKey,
  checkBackground,
  backgroundFilterFrom,
  buildBackgroundFirstFrameArgs,
  buildBackgroundLoopArgs,
  buildBackgroundTrackArgs,
  buildBackgroundMuxArgs,
  backgroundMaxrateFor,
  isHdrHeader,
  BACKGROUND_TONEMAP,
  BACKGROUND_FPS,
  BACKGROUND_LOOP_MAX_SECONDS,
  BACKGROUND_MAX_SONG_SECONDS,
  MAX_BACKGROUND_CLIPS,
  normaliseBackgroundKeys,
  preparedBackgroundKey,
  isPreparedBackgroundKey,
  isBackgroundFrame,
  buildBackgroundConcatList,
  buildBackgroundJoinArgs,
  backgroundRequestFields,
  backgroundSummary,
} from '@/lib/master-background';
import { buildVideoFilter } from '@/lib/master-video';
import { buildShortFrameFilter } from '@/lib/master-short';

describe('accepted files and keys', () => {
  it('takes phone video, web video and GIF, and nothing else', () => {
    expect([...ACCEPTED_BACKGROUND_TYPES].sort()).toEqual(['image/gif', 'video/mp4', 'video/quicktime', 'video/webm']);
    expect(backgroundExtensionFor('video/quicktime')).toBe('.mov');
    expect(backgroundExtensionFor('image/gif')).toBe('.gif');
    expect(backgroundExtensionFor('image/png')).toBeNull();
    expect(backgroundExtensionFor('video/x-matroska')).toBeNull();
  });

  it('stores the upload in the mastering workspace with its own extension', () => {
    const key = masteringBackgroundKey('My Loop.MOV', 'video/quicktime', 1700000000000, 'abcd1234');
    expect(key).toBe('audio/mastering/1700000000000_abcd1234_My_Loop.mov');
    expect(isBackgroundKey(key)).toBe(true);
  });

  it('cannot produce a key the re-master guard would refuse', () => {
    expect(masteringBackgroundKey('loop-master.mp4', 'video/mp4', 1, 'n')).not.toMatch(/-master\./i);
  });

  it.each([
    ['outside the workspace', 'images/song-covers/x.mp4'],
    ['a still image', 'audio/mastering/1_c_cover.png'],
    ['a master', 'audio/mastering/1_a_song-master.wav'],
    ['a traversal', 'audio/mastering/../poem-music/x.mp4'],
    ['not a string', 42],
  ])('refuses %s', (_label, key) => {
    expect(isBackgroundKey(key)).toBe(false);
  });
});

describe('isHdrHeader', () => {
  it('spots HLG (iPhone) and PQ, and nothing else', () => {
    expect(isHdrHeader('Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67, progressive), 3840x2160')).toBe(true);
    expect(isHdrHeader('Video: hevc, yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160')).toBe(true);
    expect(isHdrHeader('Video: h264 (High), yuv420p(tv, bt709, progressive), 1920x1080')).toBe(false);
    expect(isHdrHeader('Video: gif, bgra, 400x400')).toBe(false);
  });
});

describe('checkBackground', () => {
  it('allows an ordinary song at 1080p or 1440p', () => {
    expect(checkBackground({ audioSeconds: 301, height: 1080 })).toEqual({ ok: true });
    expect(checkBackground({ audioSeconds: 301, height: 1440 })).toEqual({ ok: true });
  });

  it('allows ten minutes and refuses a second more', () => {
    expect(checkBackground({ audioSeconds: BACKGROUND_MAX_SONG_SECONDS }).ok).toBe(true);
    const over = checkBackground({ audioSeconds: BACKGROUND_MAX_SONG_SECONDS + 1 });
    expect(over).toMatchObject({ ok: false, message: expect.stringContaining('10 minutes') });
  });

  it('leaves an unknown length to the worker', () => {
    expect(checkBackground({ audioSeconds: null, height: 1440 })).toEqual({ ok: true });
  });

  it('refuses 4K, a slideshow, and motion — each with what to change', () => {
    expect(checkBackground({ height: 2160 })).toMatchObject({ ok: false, message: expect.stringContaining('1080p or 1440p') });
    expect(checkBackground({ slideshow: true })).toMatchObject({ ok: false, message: expect.stringContaining('slideshow') });
    expect(checkBackground({ motion: 'zoom-in' })).toMatchObject({ ok: false, message: expect.stringContaining('Motion to None') });
    expect(checkBackground({ motion: 'none' })).toEqual({ ok: true });
  });
});

describe('backgroundFilterFrom', () => {
  it('keeps the still fill rule for a 16:9 clip, after squaring pixels and setting the rate', () => {
    const f = backgroundFilterFrom(buildVideoFilter(1440, 16 / 9));
    expect(f.startsWith(`[0:v]scale=trunc(iw*sar/2)*2:ih,setsar=1,fps=${BACKGROUND_FPS},scale=2560:1440`)).toBe(true);
    expect(f).not.toContain('split');
    expect(f).not.toContain('boxblur');
    expect(f.endsWith('[v]')).toBe(true);
  });

  /** Raj rejected cropped artwork ("do not mask"): a square GIF keeps its backdrop. */
  it('keeps the blurred backdrop for a clip that cannot fill, splitting the source for both readers', () => {
    const f = backgroundFilterFrom(buildVideoFilter(1080, 1));
    expect(f).toContain('boxblur');
    expect(f).toContain('split=2[bgsrc0][bgsrc1]');
    expect(f).not.toContain('[0:v]scale=1920');
    // Each split output is read exactly once.
    expect(f.split('[bgsrc0]').length - 1).toBe(2);
    expect(f.split('[bgsrc1]').length - 1).toBe(2);
  });

  it('tone-maps an HDR clip after the rate drop, and leaves SDR alone', () => {
    const hdr = backgroundFilterFrom(buildVideoFilter(1440, 9 / 16), { hdr: true });
    expect(hdr).toContain(`fps=${BACKGROUND_FPS},${BACKGROUND_TONEMAP},split=2`);
    expect(backgroundFilterFrom(buildVideoFilter(1440, 9 / 16))).not.toContain('tonemap');
  });

  it('works on the vertical frame filter too', () => {
    const f = backgroundFilterFrom(buildShortFrameFilter(16 / 9));
    expect(f).toContain('split=2');
    expect(f).toContain('1080:1920');
  });
});

describe('the two passes', () => {
  it('reads the first frame as displayed', () => {
    const a = buildBackgroundFirstFrameArgs('/t/bg.mov', '/t/first.ppm');
    expect(a[a.indexOf('-frames:v') + 1]).toBe('1');
    expect(a).toContain('scale=trunc(iw*sar/2)*2:ih,setsar=1');
    expect(a.at(-1)).toBe('/t/first.ppm');
  });

  it('encodes the loop once: bounded length, no audio, capped bitrate', () => {
    const a = buildBackgroundLoopArgs({ srcPath: '/t/bg.gif', outPath: '/t/loop.mp4', filter: 'F[v]', crf: 16, maxrate: '8M' });
    // `-t` is an INPUT option here — before `-i` — so it bounds what is read.
    expect(a.indexOf('-t')).toBeLessThan(a.indexOf('-i'));
    expect(a[a.indexOf('-t') + 1]).toBe(String(BACKGROUND_LOOP_MAX_SECONDS));
    expect(a).toContain('-an');
    expect(a[a.indexOf('-maxrate') + 1]).toBe('8M');
    expect(a[a.indexOf('-bufsize') + 1]).toBe('16M');
    expect(a[a.indexOf('-r') + 1]).toBe(String(BACKGROUND_FPS));
    expect(a[a.indexOf('-color_trc') + 1]).toBe('bt709');
  });

  it('caps 1440p a little higher than 1080p', () => {
    expect(backgroundMaxrateFor(1080)).toBe('8M');
    expect(backgroundMaxrateFor(1440)).toBe('10M');
  });

  it('repeats the loop by copy, video only, ending by frame count', () => {
    const a = buildBackgroundTrackArgs({ loopPath: '/t/loop.mp4', outPath: '/t/track.mp4', seconds: 301.37 });
    expect(a.slice(a.indexOf('-stream_loop'), a.indexOf('-stream_loop') + 4)).toEqual(['-stream_loop', '-1', '-i', '/t/loop.mp4']);
    expect(a[a.indexOf('-c:v') + 1]).toBe('copy');
    // floor(301.37 * 25) = 7534 frames = 301.36 s: within a frame BEFORE the song ends.
    expect(a[a.indexOf('-frames:v') + 1]).toBe('7534');
    // No audio here: ending a pass by frame count took the song's last AAC frame with it.
    expect(a.join(' ')).not.toMatch(/\.wav|-c:a/);
    expect(a).not.toContain('libx264');
  });

  it('floors the frame count, so the picture never outlasts the song', () => {
    // 30.03 s is 750.75 frames: rounding would give 751 = 30.04 s, past the audio.
    const a = buildBackgroundTrackArgs({ loopPath: '/t/loop.mp4', outPath: '/t/track.mp4', seconds: 30.03 });
    expect(a[a.indexOf('-frames:v') + 1]).toBe('750');
  });

  it('lays the whole song under the finished track, never with -shortest', () => {
    const a = buildBackgroundMuxArgs({
      videoPath: '/t/track.mp4', audioPath: '/t/master.wav', outPath: '/t/out.mp4', audioBitrate: '384k',
    });
    expect(a[a.indexOf('-c:v') + 1]).toBe('copy');
    expect(a).not.toContain('-shortest');
    expect(a).not.toContain('-stream_loop');
    // The whole song: the audio is neither seeked nor trimmed, and the output not bounded.
    expect(a).not.toContain('-ss');
    expect(a).not.toContain('-t');
    expect(a).not.toContain('-frames:v');
    expect(a[a.indexOf('-b:a') + 1]).toBe('384k');
  });

  it('seeks and bounds the audio for a clip, with its fades', () => {
    const a = buildBackgroundMuxArgs({
      videoPath: '/t/track.mp4', audioPath: '/t/master.wav', outPath: '/t/out.mp4',
      window: { startSec: 62.5, seconds: 30 }, audioFilter: 'afade=t=in:st=0:d=0.6', audioBitrate: '192k',
    });
    const audioIn = a.indexOf('/t/master.wav');
    expect(a.slice(audioIn - 5, audioIn)).toEqual(['-ss', '62.500', '-t', '30', '-i']);
    expect(a[a.indexOf('-af') + 1]).toBe('afade=t=in:st=0:d=0.6');
  });

  it('loops and ends with the audio only when the length is unknown', () => {
    const a = buildBackgroundMuxArgs({
      videoPath: '/t/loop.mp4', loop: true, audioPath: '/t/master.wav', outPath: '/t/out.mp4', audioBitrate: '384k',
    });
    expect(a.slice(0, 6)).toEqual(['-hide_banner', '-nostats', '-stream_loop', '-1', '-i', '/t/loop.mp4']);
    expect(a).toContain('-shortest');
  });
});

/**
 * SEVERAL CLIPS (2026-11-07): 10-20 story clips joined in order, the whole
 * list repeating under the song. Each clip is prepared on its own (one per
 * worker), so the join is a copy and the cache key must be stable per clip
 * AND per frame — a 1080p segment is no use to a 1440p render.
 */
describe('several clips', () => {
  const A = 'audio/mastering/visual-story/vs_abc/candidates/c_1.mp4';
  const B = 'audio/mastering/1_d_loop.mov';

  it('takes one key or a list, and says which clip is wrong', () => {
    expect(normaliseBackgroundKeys(B, undefined)).toEqual({ ok: true, keys: [B] });
    expect(normaliseBackgroundKeys(undefined, [A, B, A])).toEqual({ ok: true, keys: [A, B, A] });
    expect(normaliseBackgroundKeys(undefined, undefined)).toEqual({ ok: true, keys: [] });
    expect(normaliseBackgroundKeys(null, null)).toEqual({ ok: true, keys: [] });
    expect(normaliseBackgroundKeys(undefined, [A, 'images/x.mp4'])).toEqual({
      ok: false, message: 'Background clip 2 is not a video or GIF in the mastering workspace.',
    });
    expect(normaliseBackgroundKeys(B, [A])).toMatchObject({ ok: false });
    expect(normaliseBackgroundKeys(undefined, 'x' as never)).toMatchObject({ ok: false });
  });

  it(`allows ${20} clips and refuses one more`, () => {
    expect(MAX_BACKGROUND_CLIPS).toBe(20);
    expect(normaliseBackgroundKeys(undefined, Array(20).fill(A))).toMatchObject({ ok: true });
    expect(normaliseBackgroundKeys(undefined, Array(21).fill(A))).toEqual({
      ok: false, message: 'Up to 20 background clips can be joined.',
    });
  });

  it('keeps a prepared clip per source AND per frame, inside the workspace', () => {
    const k1440 = preparedBackgroundKey(A, { kind: 'video', height: 1440 });
    const k1080 = preparedBackgroundKey(A, { kind: 'video', height: 1080 });
    const kv = preparedBackgroundKey(A, { kind: 'vertical' });
    expect(k1440).toBe('audio/mastering/background-prepared/v1/1440/visual-story/vs_abc/candidates/c_1-mp4.mp4');
    expect(new Set([k1440, k1080, kv]).size).toBe(3);
    expect(preparedBackgroundKey(B, { kind: 'vertical' })).toBe('audio/mastering/background-prepared/v1/vertical/1_d_loop-mov.mp4');
    // Two sources differing only in type never share a prepared clip.
    expect(preparedBackgroundKey('audio/mastering/x.mp4', { kind: 'vertical' })).not.toBe(preparedBackgroundKey('audio/mastering/x.mov', { kind: 'vertical' }));
    expect(isPreparedBackgroundKey(k1440)).toBe(true);
    expect(isPreparedBackgroundKey(A)).toBe(false);
    expect(isPreparedBackgroundKey('audio/mastering/background-prepared/v1/../x.mp4')).toBe(false);
  });

  it('knows the frames it can prepare, and nothing else', () => {
    expect(isBackgroundFrame({ kind: 'video', height: 1440 })).toBe(true);
    expect(isBackgroundFrame({ kind: 'video', height: 1080 })).toBe(true);
    expect(isBackgroundFrame({ kind: 'video', height: 2160 })).toBe(false);
    expect(isBackgroundFrame({ kind: 'vertical' })).toBe(true);
    expect(isBackgroundFrame({ kind: 'square' })).toBe(false);
    expect(isBackgroundFrame(null)).toBe(false);
  });

  it('joins the prepared clips in order by copy, quoting each path', () => {
    expect(buildBackgroundConcatList(['/tmp/a/seg-0.mp4', "/tmp/it's/seg-1.mp4"])).toBe(
      "file '/tmp/a/seg-0.mp4'\nfile '/tmp/it'\\''s/seg-1.mp4'\n"
    );
    const args = buildBackgroundJoinArgs({ listPath: '/tmp/a/list.txt', outPath: '/tmp/a/seq.mp4' });
    expect(args).toEqual(expect.arrayContaining(['-f', 'concat', '-safe', '0', '-i', '/tmp/a/list.txt']));
    expect(args[args.indexOf('-c') + 1]).toBe('copy');
    expect(args.at(-1)).toBe('/tmp/a/seq.mp4');
  });
});

describe('what the panel sends and says', () => {
  const A = 'audio/mastering/1_a.mp4';
  const B = 'audio/mastering/1_b.mp4';

  it('sends nothing, the single field, or the list — the event keeps its old shape for one clip', () => {
    expect(backgroundRequestFields([])).toEqual({});
    expect(backgroundRequestFields([A])).toEqual({ backgroundKey: A });
    expect(backgroundRequestFields([A, B])).toEqual({ backgroundKeys: [A, B] });
  });

  it('adds up the clips (each at most the 30 s used) and says when they repeat', () => {
    expect(backgroundSummary([{ seconds: 15 }, { seconds: 15 }], 361)).toBe(
      '2 clips · 0:30 of video · the song is 6:01, so the clips repeat from clip 1'
    );
    expect(backgroundSummary([{ seconds: 45 }, { seconds: 15 }], 40)).toBe('2 clips · 0:45 of video');
    expect(backgroundSummary(Array(20).fill({ seconds: 15 }), 300)).toBe('20 clips · 5:00 of video');
    expect(backgroundSummary([{ seconds: 15 }, { seconds: null }], 300)).toBe('2 clips');
    expect(backgroundSummary([{ seconds: 15 }], null)).toBe('1 clip · 0:15 of video');
  });
});
