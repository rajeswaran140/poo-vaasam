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
