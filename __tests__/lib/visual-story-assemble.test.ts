/** @jest-environment node */
/**
 * Assembly arg builders (Phase 6). The silent failures: a segment a frame long
 * or short (the video drifts off the song), a clip's own sound leaking in, a
 * fade cutting a whole song's first note, `-shortest` trimming the ending, a
 * key outside the story reaching the worker, and a render too long to finish.
 */
import {
  shotsShowingPictureWithClip,
  assembleTailSec,
  ASSEMBLE_CODEC_ARGS,
  assembleFrameSize,
  assemblyKindOf,
  isAssemblyShotKey,
  buildClipSegmentArgs,
  segmentFrames,
  assemblyShotProblem,
  buildAssembleJoinArgs,
  buildAssembleConcatList,
  assembleFades,
  stillMotionFor,
  estimateAssembleSec,
  MAX_ASSEMBLE_SEC,
  shotLabel,
} from '@/lib/visual-story-assemble';

const VS = 'vs_1793963798955_ncowzqfo';
const C = `audio/mastering/visual-story/${VS}/candidates`;

describe('what may be assembled', () => {
  it('knows a clip from a still by its extension', () => {
    expect(assemblyKindOf(`${C}/cd_1.mp4`)).toBe('clip');
    expect(assemblyKindOf(`${C}/cd_1.jpg`)).toBe('still');
    expect(assemblyKindOf(`${C}/cd_1.PNG`)).toBe('still');
    expect(assemblyKindOf(`${C}/cd_1.gif`)).toBeNull();
  });

  it.each([
    ['another story', `audio/mastering/visual-story/vs_other/candidates/cd_1.mp4`],
    ['outside candidates', `audio/mastering/visual-story/${VS}/refs/ch_1/x.jpg`],
    ['a traversal', `${C}/../../x.mp4`],
    ['an unknown type', `${C}/cd_1.webm`],
    ['the bare prefix', `${C}/`],
    ['not a string', 7],
  ])('refuses %s', (_l, key) => {
    expect(isAssemblyShotKey(key, VS)).toBe(false);
  });

  it('accepts this story\'s own clip or still', () => {
    expect(isAssemblyShotKey(`${C}/cd_1.mp4`, VS)).toBe(true);
    expect(isAssemblyShotKey(`${C}/cd_2.png`, VS)).toBe(true);
  });
});

describe('a clip segment', () => {
  const args = buildClipSegmentArgs({ srcPath: '/t/c.mp4', outPath: '/t/s.mp4', frames: 150, aspect: '9:16' });

  it('is exactly durationSec × 25 frames, with its sound dropped', () => {
    expect(args[args.indexOf('-frames:v') + 1]).toBe('150');
    expect(args).toContain('-an');
  });

  it('fills the story frame at 25 fps and holds its last frame if short', () => {
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toContain('fps=25');
    expect(vf).toContain('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
    expect(vf).toContain('tpad=stop_mode=clone:stop_duration=6');
  });

  it('uses the one shared encode recipe, so the join can copy', () => {
    const at = args.indexOf(ASSEMBLE_CODEC_ARGS[0]);
    expect(args.slice(at, at + ASSEMBLE_CODEC_ARGS.length)).toEqual([...ASSEMBLE_CODEC_ARGS]);
  });

  it('sizes 16:9 landscape', () => {
    expect(assembleFrameSize('16:9')).toEqual({ width: 1920, height: 1080 });
  });
});

describe('the join', () => {
  const base = { listPath: '/t/l.txt', audioPath: '/t/m.wav', outPath: '/t/o.mp4', windowStartSec: 42, windowSec: 180 };

  it('copies the picture, cuts the master\'s window, and never passes -shortest', () => {
    const a = buildAssembleJoinArgs({ ...base, fadeIn: true, fadeOut: true });
    expect(a[a.indexOf('-c:v') + 1]).toBe('copy');
    const at = a.indexOf('/t/m.wav');
    expect(a.slice(at - 5, at)).toEqual(['-ss', '42.000', '-t', '180', '-i']);
    expect(a).not.toContain('-shortest');
    expect(a[a.indexOf('-af') + 1]).toBe('afade=t=in:st=0:d=0.6,afade=t=out:st=177.000:d=3');
  });

  it('adds no fade at all for a whole song', () => {
    expect(buildAssembleJoinArgs({ ...base, fadeIn: false, fadeOut: false })).not.toContain('-af');
  });

  it('quotes a path with an apostrophe in the concat list', () => {
    expect(buildAssembleConcatList(["/t/a'b.mp4", '/t/c.mp4'])).toBe("file '/t/a'\\''b.mp4'\nfile '/t/c.mp4'\n");
  });
});

describe('assembleFades', () => {
  it('fades an excerpt in and out', () => {
    expect(assembleFades({ windowStartSec: 30, windowEndSec: 150, songSec: 240 })).toEqual({ fadeIn: true, fadeOut: true });
  });
  it('does not fade a window that starts at the start or ends at the end', () => {
    expect(assembleFades({ windowStartSec: 0, windowEndSec: 240, songSec: 240.3 })).toEqual({ fadeIn: false, fadeOut: false });
  });
  it('treats an unknown song length as an excerpt', () => {
    expect(assembleFades({ windowStartSec: 0, windowEndSec: 240, songSec: null }).fadeOut).toBe(true);
  });
});

describe('stills and labels', () => {
  it('alternates the zoom so a run of stills does not keep diving in', () => {
    expect([0, 1, 2].map(stillMotionFor)).toEqual(['zoom-in', 'zoom-out', 'zoom-in']);
  });
  it('names a shot the way the studio does', () => {
    expect(shotLabel({ sceneOrder: 2, shotOrder: 3 })).toBe('Scene 2, shot 3');
  });
});

describe('rows in tenths render frame-exact (2026-11-13)', () => {
  it('takes each shot\'s frames from the running total, so tenths never drift off the song', () => {
    expect(segmentFrames([14.9, 15, 13.2])).toEqual([373, 375, 330]);
    expect(segmentFrames([14.9, 15, 13.2]).reduce((a, b) => a + b, 0)).toBe(Math.round(43.1 * 25));
    // Rounding each 0.1 s row alone (2.5 → 3) would drift to 90 frames.
    expect(segmentFrames(Array(30).fill(0.1)).reduce((a, b) => a + b, 0)).toBe(75);
    expect(Math.min(...segmentFrames(Array(30).fill(0.1)))).toBeGreaterThanOrEqual(1);
  });
  it('slows a clip with setpts before the 25 fps step, and pads to the row', () => {
    const args = buildClipSegmentArgs({ srcPath: '/t/c.mp4', outPath: '/t/s.mp4', frames: 380, playbackRate: 0.921, aspect: '16:9' });
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toContain('setpts=PTS/0.921');
    expect(vf.indexOf('setpts=PTS/0.921')).toBeLessThan(vf.indexOf('fps=25'));
    expect(vf).toContain('tpad=stop_mode=clone:stop_duration=15.2');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('380');
  });
  it('does not touch the speed of a clip at its own pace', () => {
    const args = buildClipSegmentArgs({ srcPath: '/t/c.mp4', outPath: '/t/s.mp4', frames: 330, aspect: '16:9' });
    expect(args[args.indexOf('-vf') + 1]).not.toContain('setpts');
  });
  it('the worker accepts tenths and a speed from 0.88 up to 1, nothing else', () => {
    const key = `audio/mastering/visual-story/vs_1700000000000_abcdef12/candidates/cd_1.mp4`;
    const ok = { sceneOrder: 1, shotOrder: 1, key, durationSec: 14.9 };
    expect(assemblyShotProblem(ok)).toBeNull();
    expect(assemblyShotProblem({ ...ok, playbackRate: 0.921 })).toBeNull();
    expect(assemblyShotProblem({ ...ok, durationSec: 14.95 })).toBe('Scene 1, shot 1 has a length this renderer does not accept.');
    for (const r of [0.87, 1, 1.2, Number.NaN]) {
      expect(assemblyShotProblem({ ...ok, playbackRate: r })).toBe('Scene 1, shot 1 has a speed this renderer does not accept.');
    }
  });
  it('estimates more work for a slowed clip', () => {
    const k = 'a.mp4';
    expect(estimateAssembleSec([{ key: k, durationSec: 15, playbackRate: 0.9 }])).toBeGreaterThan(estimateAssembleSec([{ key: k, durationSec: 15 }]));
  });
});

describe('estimateAssembleSec', () => {
  const shots = (n: number, durationSec: number, ext: string) =>
    Array.from({ length: n }, (_, i) => ({ key: `${C}/cd_${i}${ext}`, durationSec }));

  it('prices a 3-minute mixed video well inside the limit', () => {
    const est = estimateAssembleSec([...shots(15, 6, '.mp4'), ...shots(15, 6, '.jpg')]);
    expect(est).toBeGreaterThan(150);
    expect(est).toBeLessThan(MAX_ASSEMBLE_SEC / 2);
  });

  it('fits seven minutes of half clips, half pictures; refuses seven minutes of pictures only', () => {
    expect(estimateAssembleSec([...shots(35, 6, '.mp4'), ...shots(35, 6, '.jpg')])).toBeLessThanOrEqual(MAX_ASSEMBLE_SEC);
    expect(estimateAssembleSec(shots(70, 6, '.jpg'))).toBeGreaterThan(MAX_ASSEMBLE_SEC);
    expect(estimateAssembleSec(shots(420, 1, '.jpg'))).toBeGreaterThan(MAX_ASSEMBLE_SEC);
  });

  it('charges a still more than a clip of the same length', () => {
    expect(estimateAssembleSec(shots(1, 10, '.jpg'))).toBeGreaterThan(estimateAssembleSec(shots(1, 10, '.mp4')));
  });
});

describe('shotsShowingPictureWithClip (audit 2026-11-09: a made clip left unused)', () => {
  const C = 'audio/mastering/visual-story/vs_1/candidates';
  const sh = (shotOrder: number, sel: string | null) => ({ sceneOrder: 1, shotOrder, selectedCandidateId: sel });
  const cd = (candId: string, shotOrder: number, ext: string) => ({ candId, sceneOrder: 1, shotOrder, s3Key: `${C}/${candId}${ext}` });
  it('names shots whose chosen item is a picture while a clip exists for them, in order', () => {
    const shots = [sh(2, 'p2'), sh(1, 'p1'), sh(3, 'c3')];
    const cands = [cd('p1', 1, '.jpg'), cd('c1', 1, '.mp4'), cd('p2', 2, '.png'), cd('p3', 3, '.jpg'), cd('c3', 3, '.mp4')];
    expect(shotsShowingPictureWithClip(shots, cands)).toEqual(['Scene 1, shot 1']);
  });
  it('a picture with no clip, nothing chosen, or a chosen clip is not named', () => {
    expect(shotsShowingPictureWithClip([sh(1, 'p1'), sh(2, null)], [cd('p1', 1, '.jpg'), cd('c2', 2, '.mp4')])).toEqual([]);
  });
});

describe('assembleTailSec', () => {
  it('the part of a second a whole-second window leaves off the song', () => {
    expect(assembleTailSec({ windowEndSec: 240, songSec: 240.7 })).toBe(0.7);
    expect(assembleTailSec({ windowEndSec: 240, songSec: 240.0004 })).toBe(0);
  });
  it('0 for an excerpt, an exact end, or an unknown length', () => {
    expect(assembleTailSec({ windowEndSec: 60, songSec: 240.7 })).toBe(0);
    expect(assembleTailSec({ windowEndSec: 240, songSec: 240 })).toBe(0);
    expect(assembleTailSec({ windowEndSec: 240, songSec: null })).toBe(0);
  });
});
