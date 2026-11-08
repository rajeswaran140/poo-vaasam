/** @jest-environment node */
/**
 * The Video Text render plan: cut the source on keyframes, burn the PNGs into
 * each segment, join by stream copy with the ORIGINAL audio.
 *
 * The failures worth pinning are the silent ones: an audio re-encode (the
 * song changes), a `-shortest` at the join (the song is cut short), a block
 * that crosses a cut appearing in only one of the two segments (a flash), and
 * floating-point noise in an `enable=` time.
 */
import {
  segmentPlanFor,
  SEGMENT_TARGET_SEC,
  CHUNK_CRF,
  CHUNK_PRESET,
  parseSegmentList,
  buildSegmentArgs,
  overlaysForSegment,
  buildChunkArgs,
  buildJoinMuxArgs,
  buildAudioHashArgs,
  buildAudioExtractArgs,
  audioExtractExtFor,
} from '@/lib/video-text/render-plan';
import { VIDEO_CRF } from '@/lib/master-video';

const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('constants', () => {
  it('sizes a chunk well inside the 300 s chunk timeout', () => {
    expect(SEGMENT_TARGET_SEC).toBeGreaterThan(0);
    expect(SEGMENT_TARGET_SEC).toBeLessThanOrEqual(24);
  });
  it('encodes at the house CRF and preset', () => {
    expect(CHUNK_CRF).toBe(VIDEO_CRF);
    expect(CHUNK_PRESET).toBe('veryfast');
  });
});

describe('parseSegmentList', () => {
  it('reads the segment muxer csv list with exact times', () => {
    expect(parseSegmentList('seg000.mp4,0.000000,19.960000\nseg001.mp4,19.960000,40.000000\n')).toEqual([
      { file: 'seg000.mp4', startSec: 0, endSec: 19.96 },
      { file: 'seg001.mp4', startSec: 19.96, endSec: 40 },
    ]);
  });
  it('tolerates CRLF and blank lines', () => {
    expect(parseSegmentList('\r\na.mp4,0,1\r\n\r\n')).toEqual([{ file: 'a.mp4', startSec: 0, endSec: 1 }]);
  });
  it('throws on a malformed line rather than dropping a segment', () => {
    expect(() => parseSegmentList('a.mp4,0,1\nb.mp4,oops,2\n')).toThrow(/segment list/);
    expect(() => parseSegmentList('a.mp4,0\n')).toThrow(/segment list/);
  });
});

describe('buildSegmentArgs', () => {
  const args = buildSegmentArgs('/tmp/src.mp4', '/tmp/seg%03d.mp4', '/tmp/list.csv', 20);
  it('copies the video stream only into keyframe-cut segments', () => {
    expect(after(args, '-i')).toBe('/tmp/src.mp4');
    expect(after(args, '-map')).toBe('0:v:0');
    expect(after(args, '-c')).toBe('copy');
    expect(after(args, '-f')).toBe('segment');
    expect(after(args, '-segment_time')).toBe('20');
    expect(after(args, '-reset_timestamps')).toBe('1');
    expect(after(args, '-segment_list')).toBe('/tmp/list.csv');
    expect(after(args, '-segment_list_type')).toBe('csv');
    expect(args[args.length - 1]).toBe('/tmp/seg%03d.mp4');
    expect(args).not.toContain('0:a:0');
  });
  it("keeps the source's timestamps so the csv cut times are presentation times", () => {
    // Default avoid_negative_ts shifts a B-frame source by its delay: cuts listed 0.2 s late.
    expect(after(args, '-avoid_negative_ts')).toBe('disabled');
    expect(args.indexOf('-avoid_negative_ts')).toBeLessThan(args.indexOf('-f'));
  });
});

describe('overlaysForSegment', () => {
  const segs = [{ startSec: 0, endSec: 19.96 }, { startSec: 19.96, endSec: 40 }];
  it('splits a block crossing a cut into both segments, relative and rounded to 1 ms', () => {
    const blocks = [{ id: 'b', startSec: 15, endSec: 25 }];
    expect(overlaysForSegment(blocks, segs[0])).toEqual([{ id: 'b', fromSec: 15, toSec: 19.96 }]);
    expect(overlaysForSegment(blocks, segs[1])).toEqual([{ id: 'b', fromSec: 0, toSec: 5.04 }]);
  });
  it('leaves out a block outside the segment, including one that only touches its edge', () => {
    const blocks = [
      { id: 'early', startSec: 1, endSec: 5 },
      { id: 'touch', startSec: 10, endSec: 19.96 },
      { id: 'late', startSec: 30, endSec: 35 },
    ];
    expect(overlaysForSegment(blocks, segs[1]).map((o) => o.id)).toEqual(['late']);
    expect(overlaysForSegment(blocks, segs[0]).map((o) => o.id)).toEqual(['early', 'touch']);
  });
  it('clips a block longer than the segment to [0, segment length]', () => {
    expect(overlaysForSegment([{ id: 'x', startSec: 0, endSec: 100 }], segs[1])).toEqual([
      { id: 'x', fromSec: 0, toSec: 20.04 },
    ]);
  });
});

describe('buildChunkArgs', () => {
  const args = buildChunkArgs({
    segPath: '/tmp/seg001.mp4',
    overlays: [
      { path: '/tmp/a.png', fromSec: 15, toSec: 19.96 },
      { path: '/tmp/b.png', fromSec: 0, toSec: 5.04 },
    ],
    width: 2560,
    height: 1440,
    outPath: '/tmp/chunk001.mp4',
    crf: 16,
    preset: 'veryfast',
  });
  const filter = after(args, '-filter_complex');

  it('reads each PNG ONCE as its own input after the segment', () => {
    // `-loop 1` re-decodes every full-frame PNG 25 times a second: measured on
    // the layer's 7.0.2, 8 overlays took a 20 s 1440p chunk from 4.3 s to 157 s.
    expect(args).not.toContain('-loop');
    const inputs = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
    expect(inputs).toEqual(['/tmp/seg001.mp4', '/tmp/a.png', '/tmp/b.png']);
  });
  it('chains timed overlays bound to the segment length', () => {
    expect(filter).toContain("[0:v][1:v]overlay=0:0:enable='gte(t,15)*lt(t,19.96)'");
    expect(filter).toContain("enable='gte(t,0)*lt(t,5.04)'");
    expect(filter).not.toContain('between');
    // A one-frame overlay input is held by eof_action=repeat; `shortest=1`
    // would end the chunk after its first frame.
    expect(filter).not.toContain('shortest');
    for (const step of filter.split(';')) expect(step).toContain('eof_action=repeat');
    expect(after(args, '-map')).toMatch(/^\[.+\]$/);
  });
  it('encodes video only, frame for frame, with the house settings', () => {
    expect(args).toContain('-an');
    expect(args).not.toContain('-c:a');
    expect(after(args, '-c:v')).toBe('libx264');
    expect(after(args, '-crf')).toBe('16');
    expect(after(args, '-preset')).toBe('veryfast');
    expect(after(args, '-pix_fmt')).toBe('yuv420p');
    expect(after(args, '-fps_mode')).toBe('passthrough');
    expect(args[args.length - 1]).toBe('/tmp/chunk001.mp4');
  });
  it('gives two blocks sharing an edge half-open windows, so the shared frame draws only the later one', () => {
    // Lyric lines are tiled edge to edge; between() includes both ends, so at
    // 10 fps frame 45 of A=[2,4.5] B=[4.5,7] showed both lines.
    const f = after(buildChunkArgs({
      segPath: '/tmp/s.mp4',
      overlays: [{ path: '/tmp/a.png', fromSec: 2, toSec: 4.5 }, { path: '/tmp/b.png', fromSec: 4.5, toSec: 7 }],
      width: 1920, height: 1080, outPath: '/tmp/c.mp4', crf: 16, preset: 'veryfast',
    }), '-filter_complex');
    const [a, b] = f.split(';');
    expect(a).toContain("enable='gte(t,2)*lt(t,4.5)'");
    expect(b).toContain("enable='gte(t,4.5)*lt(t,7)'");
  });
  it('re-encodes the segment the same way when it has no overlays', () => {
    const plain = buildChunkArgs({
      segPath: '/tmp/s.mp4', overlays: [], width: 1920, height: 1080, outPath: '/tmp/c.mp4', crf: 16, preset: 'veryfast',
    });
    expect(plain).not.toContain('-loop');
    expect(plain).not.toContain('-filter_complex');
    expect(after(plain, '-map')).toBe('0:v:0');
    expect(after(plain, '-c:v')).toBe('libx264');
    expect(plain).toContain('-an');
    expect(after(plain, '-fps_mode')).toBe('passthrough');
  });
});

describe('buildJoinMuxArgs', () => {
  it('joins the chunks and copies the original audio, never shortening', () => {
    const args = buildJoinMuxArgs({ concatListPath: '/tmp/c.txt', srcPath: '/tmp/audio.m4a', outPath: '/tmp/o.mp4', hasAudio: true });
    expect(args.slice(args.indexOf('-f'), args.indexOf('-f') + 6)).toEqual(['-f', 'concat', '-safe', '0', '-i', '/tmp/c.txt']);
    const inputs = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
    expect(inputs).toEqual(['/tmp/c.txt', '/tmp/audio.m4a']);
    expect(args).toContain('0:v:0');
    expect(args).toContain('1:a:0');
    expect(after(args, '-c')).toBe('copy');
    expect(after(args, '-movflags')).toBe('+faststart');
    expect(args).not.toContain('-shortest');
    expect(args[args.length - 1]).toBe('/tmp/o.mp4');
  });
  it('has no audio input or map for a silent source', () => {
    const args = buildJoinMuxArgs({ concatListPath: '/tmp/c.txt', srcPath: '/tmp/src.mp4', outPath: '/tmp/o.mp4', hasAudio: false });
    expect(args.join(' ')).not.toContain('1:a');
    expect(args).not.toContain('/tmp/src.mp4');
    expect(args).not.toContain('-shortest');
  });
});

describe('buildAudioHashArgs', () => {
  it('hashes the first audio stream packets without decoding', () => {
    expect(buildAudioHashArgs('/tmp/x.mp4')).toEqual(expect.arrayContaining(['-i', '/tmp/x.mp4']));
    const args = buildAudioHashArgs('/tmp/x.mp4');
    expect(after(args, '-map')).toBe('0:a:0');
    expect(after(args, '-c')).toBe('copy');
    expect(after(args, '-f')).toBe('streamhash');
    expect(after(args, '-hash')).toBe('sha256');
    expect(args[args.length - 1]).toBe('-');
  });
});

describe('buildAudioExtractArgs', () => {
  // Matroska drops the AAC priming edit list and rounds to 1 ms: the packets
  // hash the same but the whole song lands ~23 ms late. ISO-BMFF keeps it.
  it('copies only the first audio stream, untouched, into an mp4 container for an mp4 source', () => {
    const args = buildAudioExtractArgs('/tmp/src.mp4', '/tmp/audio.m4a');
    expect(after(args, '-i')).toBe('/tmp/src.mp4');
    expect(after(args, '-map')).toBe('0:a:0');
    expect(args.filter((a) => a === '-map')).toHaveLength(1);
    expect(after(args, '-c')).toBe('copy');
    expect(after(args, '-f')).toBe('mp4');
    expect(args).not.toContain('-vn');
    expect(args).not.toContain('-c:a');
    expect(args[args.length - 1]).toBe('/tmp/audio.m4a');
  });
  it('uses a QuickTime container for a .mov source', () => {
    expect(after(buildAudioExtractArgs('/tmp/src.MOV', '/tmp/audio.mov'), '-f')).toBe('mov');
  });
  it('never writes Matroska', () => {
    expect(buildAudioExtractArgs('/tmp/src.mp4', '/tmp/a.m4a').join(' ')).not.toMatch(/matroska|\.mka/);
  });
});

describe('audioExtractExtFor', () => {
  it('names the extracted audio for its container', () => {
    expect(audioExtractExtFor('/tmp/src.mp4')).toBe('.m4a');
    expect(audioExtractExtFor('/tmp/src.MOV')).toBe('.mov');
    expect(audioExtractExtFor('/tmp/src')).toBe('.m4a');
  });
});

describe('segmentPlanFor (sizing by how heavy the video is)', () => {
  const plan = (w: number, h: number, fps: number, durationSec: number) => segmentPlanFor({ width: w, height: h, fps, durationSec });

  it('1440p24 (the measured reference): about 20 s segments', () => {
    expect(plan(2560, 1440, 24, 600)).toEqual({ ok: true, targetSec: 19.5, maxSec: 39.1, keyframeEverySec: 19 });
  });

  it('vertical 1080×1920 at 25 fps (Raj\'s songs): 20 s target, generous keyframe allowance', () => {
    expect(plan(1080, 1920, 25, 354)).toEqual({ ok: true, targetSec: 20, maxSec: 60, keyframeEverySec: 40 });
  });

  it('1440p60: shorter segments so each chunk still fits', () => {
    const p = plan(2560, 1440, 60, 300);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.targetSec).toBeLessThan(8);
      expect(p.maxSec).toBeGreaterThanOrEqual(8);
    }
  });

  it('every accepted plan keeps one chunk inside the 300 s function and the waves inside 900 s', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [1080, 1920], [2560, 1440], [3840, 2160]]) {
      for (const fps of [24, 25, 30, 50, 60]) {
        for (const d of [60, 344, 600]) {
          const p = plan(w, h, fps, d);
          if (!p.ok) continue;
          const secPerSec = 4.9 * ((w * h * fps) / (2560 * 1440 * 24)) * 1.2;
          expect(p.maxSec * secPerSec).toBeLessThanOrEqual(230 + 1e-6);
          const waves = Math.ceil(Math.ceil(d / p.targetSec) / 20);
          expect(waves * (p.targetSec * 1.25 * secPerSec + 30)).toBeLessThanOrEqual(700);
        }
      }
    }
  });

  it('refuses 4K at 60 fps as too heavy, with what to export instead', () => {
    expect(plan(3840, 2160, 60, 120)).toEqual({
      ok: false,
      message: 'This video is too heavy to render here (3840×2160 at 60 fps). Export it at 1440p and 30 fps or less, and upload again.',
    });
  });

  it('refuses a long 4K30 song as too long for its size, but takes a short one', () => {
    const long = plan(3840, 2160, 30, 600);
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.message).toMatch(/too long for its size/);
    expect(plan(3840, 2160, 30, 120).ok).toBe(true);
  });
});
