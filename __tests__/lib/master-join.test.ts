/** @jest-environment node */
/**
 * Two-part assembly — the crossfade graph and the rules around it.
 *
 * The reason this lives in the pre-pass at all is ordering: join first, master
 * the assembled song ONCE. So the tests that matter are the ones pinning that
 * the edits land BEFORE the crossfade, that the overlap can never exceed a
 * part, and that the default curve is the equal-power one.
 *
 * The curve is not a matter of taste. Measured with ffmpeg on two steady tones,
 * at the midpoint of a 3 s crossfade: qsin -21.08 dB against a -21.07 dB
 * reference (flat), tri -24.08 dB (a 3 dB hole). A linear crossfade dips in the
 * middle of every seam.
 */
import {
  parseMasterJoin,
  buildJoinFilterComplex,
  validateJoinAgainstSources,
  joinedDurationSec,
  DEFAULT_CROSSFADE_CURVE,
  MIN_OVERLAP_SECONDS,
  MAX_OVERLAP_SECONDS,
  JOIN_OUTPUT_LABEL,
  type MasterJoin,
} from '@/lib/master-join';
import { NO_EDIT, MIN_MASTER_SECONDS, type MasterEdit } from '@/lib/master-edit';

const join = (over: Partial<MasterJoin> = {}): MasterJoin => ({
  partBKey: 'audio/mastering/1_b_partb.wav',
  overlapSec: 3,
  curve: DEFAULT_CROSSFADE_CURVE,
  editB: null,
  ...over,
});

const edit = (over: Partial<MasterEdit> = {}): MasterEdit => ({ ...NO_EDIT, ...over });

describe('the default curve is equal power, deliberately', () => {
  it('defaults to qsin — a linear crossfade puts a 3 dB hole in every seam', () => {
    expect(DEFAULT_CROSSFADE_CURVE).toBe('qsin');
    const parsed = parseMasterJoin({ partBKey: 'audio/mastering/b.wav', overlapSec: 3 });
    expect(parsed.ok && parsed.join?.curve).toBe('qsin');
  });

  it('emits the SAME curve on both sides of the fade', () => {
    // c1 and c2 diverging is how you get an asymmetric seam that sounds like a
    // level ride rather than a crossfade.
    const fc = buildJoinFilterComplex({ editA: null, partASec: 100, join: join(), partBSec: 100 });
    expect(fc).toContain('acrossfade=d=3:c1=qsin:c2=qsin');
  });

  it('still allows an explicit linear curve for uncorrelated material', () => {
    const parsed = parseMasterJoin({ partBKey: 'a/b.wav', overlapSec: 2, curve: 'tri' });
    expect(parsed.ok && parsed.join?.curve).toBe('tri');
  });
});

describe('parseMasterJoin', () => {
  it('treats an absent join as a plain single-source master, not an error', () => {
    for (const v of [undefined, null]) {
      const r = parseMasterJoin(v);
      expect(r.ok).toBe(true);
      expect(r.ok && r.join).toBeNull();
    }
  });

  it('requires Part B', () => {
    expect(parseMasterJoin({ overlapSec: 3 }).ok).toBe(false);
    expect(parseMasterJoin({ partBKey: '   ', overlapSec: 3 }).ok).toBe(false);
  });

  it('rejects an overlap outside the usable range', () => {
    for (const bad of [0, -1, MIN_OVERLAP_SECONDS - 0.01, MAX_OVERLAP_SECONDS + 0.01, Number.NaN, Infinity]) {
      const r = parseMasterJoin({ partBKey: 'a/b.wav', overlapSec: bad });
      expect(r.ok).toBe(false);
    }
    expect(parseMasterJoin({ partBKey: 'a/b.wav', overlapSec: MIN_OVERLAP_SECONDS }).ok).toBe(true);
    expect(parseMasterJoin({ partBKey: 'a/b.wav', overlapSec: MAX_OVERLAP_SECONDS }).ok).toBe(true);
  });

  it('rejects an unknown curve rather than silently substituting one', () => {
    expect(parseMasterJoin({ partBKey: 'a/b.wav', overlapSec: 3, curve: 'sinc' }).ok).toBe(false);
  });

  it('validates Part B\'s own edit, and flattens a no-op to null', () => {
    const bad = parseMasterJoin({
      partBKey: 'a/b.wav', overlapSec: 3, editB: { trimStartSec: -5 },
    });
    expect(bad.ok).toBe(false);

    const noop = parseMasterJoin({
      partBKey: 'a/b.wav', overlapSec: 3,
      editB: { trimStartSec: 0, trimEndSec: null, fadeInSec: 0, fadeOutSec: 0, curve: 'qsin' },
    });
    expect(noop.ok && noop.join?.editB).toBeNull();
  });
});

describe('joinedDurationSec', () => {
  it('shares the overlap rather than adding it', () => {
    // Verified against ffmpeg on this box: 10s + 10s at d=3 rendered 17.000s.
    expect(joinedDurationSec(10, 10, 3)).toBe(17);
  });

  it('never returns a negative length', () => {
    expect(joinedDurationSec(2, 2, 10)).toBe(0);
  });
});

describe('validateJoinAgainstSources', () => {
  it('accepts a normal seam', () => {
    expect(validateJoinAgainstSources(join(), null, 180, 200)).toEqual({ ok: true });
  });

  it('REFUSES an overlap longer than either part', () => {
    // The dangerous case: acrossfade consumes `d` from A's tail and B's head, so
    // an over-long overlap yields a silently truncated join — which still
    // returns a file and still masters cleanly, so nothing downstream notices.
    expect(validateJoinAgainstSources(join({ overlapSec: 20 }), null, 10, 200).ok).toBe(false);
    expect(validateJoinAgainstSources(join({ overlapSec: 20 }), null, 200, 10).ok).toBe(false);
  });

  it('measures the overlap against the TRIMMED length, not the raw file', () => {
    // Part A is 100s but trimmed to 5s; a 6s crossfade no longer fits, even
    // though it fits the original file comfortably.
    const a = edit({ trimStartSec: 0, trimEndSec: 5 });
    expect(validateJoinAgainstSources(join({ overlapSec: 6 }), a, 100, 100).ok).toBe(false);
    expect(validateJoinAgainstSources(join({ overlapSec: 3 }), a, 100, 100).ok).toBe(true);
  });

  it('measures Part B against ITS trim too', () => {
    const j = join({ overlapSec: 6, editB: edit({ trimStartSec: 95 }) }); // 5s of B left
    expect(validateJoinAgainstSources(j, null, 100, 100).ok).toBe(false);
  });

  it('refuses when a duration could not be read', () => {
    // A crossfade cannot be placed without knowing where the tail is.
    expect(validateJoinAgainstSources(join(), null, 0, 100).ok).toBe(false);
    expect(validateJoinAgainstSources(join(), null, 100, Number.NaN).ok).toBe(false);
  });

  it('refuses a joined result under the minimum master length', () => {
    // Both parts have to be tiny to reach this — a 0.6s Part A joined to a full
    // Part B is perfectly legitimate, so the length rule is about the ASSEMBLED
    // song, never about either half.
    const j = join({ overlapSec: MIN_OVERLAP_SECONDS, editB: edit({ trimEndSec: 0.6 }) });
    const tiny = validateJoinAgainstSources(j, edit({ trimEndSec: 0.6 }), 100, 100);
    expect(tiny.ok).toBe(false);
    if (!tiny.ok) expect(tiny.error).toContain(String(MIN_MASTER_SECONDS));

    // …and the same short Part A against a whole Part B is accepted.
    expect(validateJoinAgainstSources(join({ overlapSec: MIN_OVERLAP_SECONDS }), edit({ trimEndSec: 0.6 }), 100, 100).ok).toBe(true);
  });
});

describe('buildJoinFilterComplex', () => {
  it('edits each part BEFORE the crossfade, in one graph', () => {
    // The ordering IS the feature. Trimming after the crossfade would move the
    // seam the admin placed.
    const fc = buildJoinFilterComplex({
      editA: edit({ trimEndSec: 170 }),
      partASec: 180,
      join: join({ editB: edit({ trimStartSec: 4 }) }),
      partBSec: 200,
    });
    const [legA, legB, cross] = fc.split(';');
    expect(legA).toMatch(/^\[0:a\]atrim=start=0:end=170,asetpts=PTS-STARTPTS/);
    expect(legA).toMatch(/\[a\]$/);
    expect(legB).toMatch(/^\[1:a\]atrim=start=4/);
    expect(legB).toMatch(/\[b\]$/);
    expect(cross).toBe(`[a][b]acrossfade=d=3:c1=qsin:c2=qsin[${JOIN_OUTPUT_LABEL}]`);
  });

  it('passes an unedited part through anull so the graph keeps its shape', () => {
    const fc = buildJoinFilterComplex({ editA: null, partASec: 180, join: join(), partBSec: 200 });
    expect(fc).toBe(`[0:a]anull[a];[1:a]anull[b];[a][b]acrossfade=d=3:c1=qsin:c2=qsin[${JOIN_OUTPUT_LABEL}]`);
  });

  it('keeps Part A as input 0 and Part B as input 1', () => {
    // Reversing them would crossfade the song backwards — B's tail into A's
    // head — and would still produce a plausible-length file.
    const fc = buildJoinFilterComplex({
      editA: edit({ trimStartSec: 1 }), partASec: 180,
      join: join({ editB: edit({ trimStartSec: 2 }) }), partBSec: 200,
    });
    expect(fc.indexOf('[0:a]')).toBeLessThan(fc.indexOf('[1:a]'));
    expect(fc).toContain('[0:a]atrim=start=1');
    expect(fc).toContain('[1:a]atrim=start=2');
  });

  it('carries the de-click ramps into each leg', () => {
    // The seam-side ramps sit inside the crossfade and are inaudible there; the
    // OUTER edges (A's head, B's tail) still need them and no crossfade touches
    // those.
    const fc = buildJoinFilterComplex({
      editA: edit({ trimStartSec: 10 }), partASec: 180,
      join: join({ editB: edit({ trimEndSec: 100 }) }), partBSec: 200,
    });
    expect(fc).toContain('afade=t=in:st=0:d=0.01:curve=tri');   // A's cut head
    expect(fc).toContain('afade=t=out:st=99.99:d=0.01:curve=tri'); // B's cut tail
  });
});
