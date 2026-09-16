/** @jest-environment node */
/**
 * The seam preview.
 *
 * The property that matters most is the one a listening test would never catch:
 * the preview must be the SAME graph as the master, trimmed. A preview built
 * from its own recipe would let a seam sound right in the panel and wrong in
 * the delivered file — worse than having no preview, because it would be
 * trusted.
 */
import {
  planSeamPreview,
  seamPreviewKey,
  seamFingerprint,
  isSeamPreviewKey,
  seamWindow,
  seamLevelRegions,
  summariseSeamLevels,
  describeSeamLevels,
  buildSeamPreviewArgs,
  buildSeamLoudnessArgs,
  seamRefusalMessage,
  SEAM_CONTEXT_SEC,
  SEAM_LEVEL_GAP_LU,
  SEAM_PREFIX,
} from '@/lib/seam-preview';
import { buildJoinFilterComplex, DEFAULT_CROSSFADE_CURVE, type MasterJoin } from '@/lib/master-join';
import { NO_EDIT, type MasterEdit } from '@/lib/master-edit';

const A_KEY = 'audio/mastering/1700000000000_ab12_part-a.wav';
const B_KEY = 'audio/mastering/1700000000000_cd34_part-b.wav';
const join = (over: Partial<MasterJoin> = {}): MasterJoin => ({
  partBKey: B_KEY,
  overlapSec: 3,
  curve: DEFAULT_CROSSFADE_CURVE,
  editB: null,
  ...over,
});
const spec = (over: Record<string, unknown> = {}) => ({
  partAKey: A_KEY, partBKey: B_KEY, editA: null as MasterEdit | null, join: join(), ...over,
});

describe('where the seam is', () => {
  it('places the crossfade at the END of Part A, which is what acrossfade does', () => {
    // acrossfade=d=D consumes the last D seconds of the first input, so in the
    // joined output the overlap occupies [aLen - D, aLen]. Every other number
    // here is derived from that one fact.
    const w = seamWindow({ editA: null, partASec: 120, join: join({ overlapSec: 4 }), partBSec: 90 })!;
    expect(w.seamStart).toBe(116);
    expect(w.seamEnd).toBe(120);
  });

  it('keeps context either side so a stumble can be told from a start', () => {
    const w = seamWindow({ editA: null, partASec: 120, join: join({ overlapSec: 4 }), partBSec: 90 })!;
    expect(w.from).toBe(116 - SEAM_CONTEXT_SEC);
    expect(w.to).toBe(120 + SEAM_CONTEXT_SEC);
  });

  it('accounts for Part A being trimmed — the seam moves with it', () => {
    const editA: MasterEdit = { ...NO_EDIT, trimStartSec: 10, trimEndSec: 70 };
    const w = seamWindow({ editA, partASec: 120, join: join({ overlapSec: 4 }), partBSec: 90 })!;
    // A is 60s after trimming, so the seam sits at 56-60 of the JOINED timeline.
    expect(w.seamStart).toBe(56);
    expect(w.seamEnd).toBe(60);
  });

  it('never runs past the end of the joined programme', () => {
    // A 5s Part B leaves only 3s of music after a 2s overlap — a window
    // reaching 8s past the seam would look truncated when nothing is wrong.
    const w = seamWindow({ editA: null, partASec: 30, join: join({ overlapSec: 2 }), partBSec: 5 })!;
    expect(w.to).toBeLessThanOrEqual(30 + 5 - 2);
  });

  it('clamps the start at zero rather than going negative', () => {
    const w = seamWindow({ editA: null, partASec: 4, join: join({ overlapSec: 3 }), partBSec: 60 })!;
    expect(w.from).toBe(0);
  });

  it('returns null when a duration is not readable', () => {
    expect(seamWindow({ editA: null, partASec: Number.NaN, join: join(), partBSec: 90 })).toBeNull();
    expect(seamWindow({ editA: null, partASec: 120, join: join(), partBSec: 0 })).toBeNull();
  });
});

describe('the preview is the master, trimmed', () => {
  const args = () =>
    buildSeamPreviewArgs({
      partAPath: '/tmp/a.wav', partBPath: '/tmp/b.wav',
      editA: null, partASec: 120, join: join({ overlapSec: 4 }), partBSec: 90,
      outPath: '/tmp/seam.mp3',
    })!;

  it('contains the REAL join graph verbatim', () => {
    // If this ever diverges, a seam can sound right here and wrong in the file.
    const real = buildJoinFilterComplex({ editA: null, partASec: 120, join: join({ overlapSec: 4 }), partBSec: 90 });
    const graph = args()[args().indexOf('-filter_complex') + 1];
    expect(graph).toContain(real);
  });

  it('adds only a trim around the seam, and resets the timestamps', () => {
    const graph = args()[args().indexOf('-filter_complex') + 1];
    expect(graph).toContain('atrim=start=108:end=128');
    // Without this the MP3 carries the joined timeline and players show the
    // clip as beginning two minutes in.
    expect(graph).toContain('asetpts=PTS-STARTPTS');
  });

  it('does not seek into the inputs — that would move the seam', () => {
    // The edits are expressed in SOURCE time; seeking the inputs silently
    // changes what every trim refers to.
    expect(args()).not.toContain('-ss');
  });

  it('is an MP3 and never a master', () => {
    const a = args();
    expect(a[a.indexOf('-c:a') + 1]).toBe('libmp3lame');
    expect(a.join(' ')).not.toContain('loudnorm');
  });

  it('returns null rather than args when the durations are unreadable', () => {
    expect(
      buildSeamPreviewArgs({
        partAPath: '/tmp/a.wav', partBPath: '/tmp/b.wav',
        editA: null, partASec: Number.NaN, join: join(), partBSec: 90,
        outPath: '/tmp/seam.mp3',
      })
    ).toBeNull();
  });
});

describe('naming a preview', () => {
  it('is stable for identical settings, so re-asking costs nothing', () => {
    expect(seamPreviewKey(spec())).toBe(seamPreviewKey(spec()));
  });

  it.each([
    ['the overlap', { join: join({ overlapSec: 3.5 }) }],
    ['the curve', { join: join({ curve: 'tri' as const }) }],
    ["Part B's head trim", { join: join({ editB: { ...NO_EDIT, trimStartSec: 0.2 } }) }],
    ["Part A's edit", { editA: { ...NO_EDIT, trimStartSec: 1 } }],
    ['Part B itself', { join: join({ partBKey: 'audio/mastering/other.wav' }), partBKey: 'audio/mastering/other.wav' }],
  ])('changes when %s changes, so a nudge never overwrites what is playing', (_label, over) => {
    expect(seamFingerprint(spec(over))).not.toBe(seamFingerprint(spec()));
  });

  it('lands in its own folder, so a sweep can find previews', () => {
    const key = seamPreviewKey(spec());
    expect(key.startsWith(SEAM_PREFIX)).toBe(true);
    expect(isSeamPreviewKey(key)).toBe(true);
  });

  it('recognises only its own keys', () => {
    expect(isSeamPreviewKey('audio/mastering/a-master-14LUFS.wav')).toBe(false);
    expect(isSeamPreviewKey('audio/poem-music/x.mp3')).toBe(false);
    expect(isSeamPreviewKey(`${SEAM_PREFIX}../escape.mp3`)).toBe(false);
  });
});

describe('planSeamPreview', () => {
  it('accepts a well-formed seam and names its file', () => {
    const plan = planSeamPreview(spec());
    expect(plan).toMatchObject({ ok: true, previewKey: seamPreviewKey(spec()) });
  });

  it.each([
    ['Part A outside the workspace', { partAKey: 'audio/poem-music/a.wav' }],
    ['Part B outside the workspace', { partBKey: 'audio/poem-music/b.wav' }],
    ['a traversal attempt', { partAKey: 'audio/mastering/../../etc/passwd' }],
  ])('refuses %s', (_label, over) => {
    expect(planSeamPreview(spec(over))).toEqual({ ok: false, reason: 'bad-key' });
  });

  it('every refusal has wording', () => {
    for (const r of ['no-part-b', 'bad-key', 'no-join', 'not-measurable'] as const) {
      expect(seamRefusalMessage(r).trim().length).toBeGreaterThan(0);
    }
  });
});

/**
 * The measurement that decides whether nudging is even the right job. Two parts
 * 2 LU apart cannot be joined invisibly at any curve or placement — the
 * crossfade becomes a volume ramp between two different recordings.
 */
describe('the level either side of the seam', () => {
  it('measures A where the crossfade takes it, and B where it enters', () => {
    const r = seamLevelRegions({ editA: null, partASec: 120, join: join({ overlapSec: 4 }), partBSec: 90, windowSec: 6 })!;
    expect(r.a).toEqual({ startSec: 114, seconds: 6 });
    expect(r.b).toEqual({ startSec: 0, seconds: 6 });
  });

  it('expresses both regions in their OWN file-s time, including trims', () => {
    // ffmpeg is handed each file separately, so a region in joined time would
    // measure the wrong seconds.
    const editA: MasterEdit = { ...NO_EDIT, trimStartSec: 10, trimEndSec: 70 };
    const r = seamLevelRegions({
      editA, partASec: 120,
      join: join({ overlapSec: 4, editB: { ...NO_EDIT, trimStartSec: 2.5 } }),
      partBSec: 90, windowSec: 6,
    })!;
    expect(r.a).toEqual({ startSec: 10 + 60 - 6, seconds: 6 });
    expect(r.b).toEqual({ startSec: 2.5, seconds: 6 });
  });

  it('never asks for more audio than a part has', () => {
    const r = seamLevelRegions({ editA: null, partASec: 4, join: join({ overlapSec: 1 }), partBSec: 3, windowSec: 6 })!;
    expect(r.a.seconds).toBe(4);
    expect(r.b.seconds).toBe(3);
  });

  it('seeks before the input, so ffmpeg jumps rather than decoding from zero', () => {
    const a = buildSeamLoudnessArgs({ path: '/tmp/a.wav', startSec: 114, seconds: 6 });
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'));
    expect(a.join(' ')).toContain('ebur128');
    expect(a[a.indexOf('-f') + 1]).toBe('null');
  });

  it('calls a small difference placement, and a big one a mismatch', () => {
    const close = summariseSeamLevels(-14.0, -14.4);
    expect(close.mismatched).toBe(false);
    expect(describeSeamLevels(close)).toMatch(/placement, not level/i);

    const apart = summariseSeamLevels(-14.0, -16.5);
    expect(apart.gapLu).toBe(2.5);
    expect(apart.mismatched).toBe(true);
    expect(describeSeamLevels(apart)).toMatch(/Match the parts/i);
  });

  it('treats the threshold itself as a mismatch', () => {
    expect(summariseSeamLevels(-14, -14 - SEAM_LEVEL_GAP_LU).mismatched).toBe(true);
  });

  it('reports an unmeasurable side as unknown, never as zero', () => {
    // "could not measure" and "identical" must not look the same.
    const none = summariseSeamLevels(null, -14);
    expect(none.gapLu).toBeNull();
    expect(none.mismatched).toBe(false);
    expect(describeSeamLevels(none)).toMatch(/could not be measured/i);
  });
});
