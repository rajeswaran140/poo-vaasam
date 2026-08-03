/** @jest-environment node */
/**
 * Trim + fade pre-pass for /admin/mastering.
 *
 * Two things are worth guarding here. The first is the ffmpeg chain itself —
 * the `asetpts` rebase and the fade-out start time are the parts that silently
 * produce a wrong-sounding file rather than an error. The second is the
 * backward-compatibility promise: every existing master request omits these
 * fields entirely and must keep behaving exactly as before.
 */
import {
  parseMasterEdit,
  buildEditFilters,
  buildEditFilterArg,
  editedDurationSec,
  resolvedEndSec,
  validateAgainstSource,
  isNoOpEdit,
  describeEdit,
  NO_EDIT,
  DEFAULT_FADE_CURVE,
  FADE_CURVES,
  MAX_FADE_SECONDS,
  MIN_MASTER_SECONDS,
  type MasterEdit,
} from '@/lib/master-edit';

const edit = (over: Partial<MasterEdit> = {}): MasterEdit => ({ ...NO_EDIT, ...over });

describe('parseMasterEdit — backward compatibility', () => {
  it('treats a missing edit as the identity, not an error', () => {
    for (const input of [undefined, null, {}]) {
      const r = parseMasterEdit(input);
      expect(r).toEqual({ ok: true, edit: NO_EDIT });
    }
  });

  it('the identity edit is a no-op, so the worker can skip the pass', () => {
    expect(isNoOpEdit(NO_EDIT)).toBe(true);
    expect(buildEditFilters(NO_EDIT, 300)).toEqual([]);
    expect(buildEditFilterArg(NO_EDIT, 300)).toBeNull();
  });

  it('a curve alone is still a no-op — it changes nothing without a fade', () => {
    const r = parseMasterEdit({ curve: 'log' });
    expect(r.ok).toBe(true);
    expect(r.ok && isNoOpEdit(r.edit)).toBe(true);
  });
});

describe('parseMasterEdit — validation', () => {
  it('accepts a full, well-formed edit', () => {
    const r = parseMasterEdit({
      trimStartSec: 1.5, trimEndSec: 200, fadeInSec: 2, fadeOutSec: 6, curve: 'esin',
    });
    expect(r).toEqual({
      ok: true,
      edit: { trimStartSec: 1.5, trimEndSec: 200, fadeInSec: 2, fadeOutSec: 6, curve: 'esin' },
    });
  });

  it('defaults the curve rather than demanding one', () => {
    const r = parseMasterEdit({ fadeOutSec: 5 });
    expect(r.ok && r.edit.curve).toBe(DEFAULT_FADE_CURVE);
  });

  it('null trimEndSec means "to the end of the file"', () => {
    const r = parseMasterEdit({ trimEndSec: null, fadeOutSec: 4 });
    expect(r.ok && r.edit.trimEndSec).toBeNull();
  });

  it.each([
    ['a non-object', 'nope'],
    ['an array', [1, 2]],
  ])('rejects %s', (_label, input) => {
    expect(parseMasterEdit(input).ok).toBe(false);
  });

  it.each([
    ['negative trimStartSec', { trimStartSec: -1 }],
    ['NaN trimStartSec', { trimStartSec: Number.NaN }],
    ['Infinity trimStartSec', { trimStartSec: Number.POSITIVE_INFINITY }],
    ['string trimStartSec', { trimStartSec: '5' }],
    ['negative fadeInSec', { fadeInSec: -0.1 }],
    ['negative fadeOutSec', { fadeOutSec: -0.1 }],
    ['unknown curve', { fadeOutSec: 3, curve: 'bounce' }],
  ])('rejects %s', (_label, input) => {
    expect(parseMasterEdit(input).ok).toBe(false);
  });

  it('caps a fade at MAX_FADE_SECONDS — beyond that it is an arrangement change', () => {
    expect(parseMasterEdit({ fadeOutSec: MAX_FADE_SECONDS }).ok).toBe(true);
    const r = parseMasterEdit({ fadeOutSec: MAX_FADE_SECONDS + 0.1 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/at most/);
  });

  it('refuses an inverted or degenerate trim window at parse time', () => {
    expect(parseMasterEdit({ trimStartSec: 100, trimEndSec: 40 }).ok).toBe(false);
    expect(parseMasterEdit({ trimStartSec: 10, trimEndSec: 10 }).ok).toBe(false);
    expect(parseMasterEdit({ trimStartSec: 10, trimEndSec: 10 + MIN_MASTER_SECONDS }).ok).toBe(true);
  });

  it('every advertised curve actually parses', () => {
    for (const c of FADE_CURVES) {
      expect(parseMasterEdit({ fadeOutSec: 1, curve: c }).ok).toBe(true);
    }
  });
});

describe('buildEditFilters — the ffmpeg chain', () => {
  it('rebases timestamps after a trim, or every fade lands in the wrong place', () => {
    // Without asetpts, atrim keeps the SOURCE timestamps: the first sample is
    // still t=30, so `afade=t=in:st=0` would have already finished before the
    // audio starts. This is the single most breakable line in the module.
    const filters = buildEditFilters(edit({ trimStartSec: 30, trimEndSec: 200 }), 300);
    expect(filters[0]).toBe('atrim=start=30:end=200');
    expect(filters[1]).toBe('asetpts=PTS-STARTPTS');
  });

  it('places the fade-out relative to the TRIMMED length, not the source', () => {
    // 30..200 is a 170s master, so a 6s fade-out must start at 164 — not at
    // 194 (source-relative), which would fall outside the file entirely.
    const filters = buildEditFilters(edit({ trimStartSec: 30, trimEndSec: 200, fadeOutSec: 6 }), 300);
    expect(filters).toContain('afade=t=out:st=164:d=6:curve=qsin');
  });

  it('fades the tail of an untrimmed file using the source duration', () => {
    const filters = buildEditFilters(edit({ fadeOutSec: 8 }), 351);
    expect(filters).toEqual(['afade=t=out:st=343:d=8:curve=qsin']);
    // No trim was asked for, so no atrim/asetpts should appear at all.
    expect(filters.join(',')).not.toMatch(/atrim|asetpts/);
  });

  it('omits `end=` when only the head is trimmed', () => {
    const filters = buildEditFilters(edit({ trimStartSec: 2.25 }), 300);
    expect(filters[0]).toBe('atrim=start=2.25');
    expect(filters[0]).not.toMatch(/end=/);
  });

  it('emits fade-in before fade-out, both with the chosen curve', () => {
    const filters = buildEditFilters(edit({ fadeInSec: 3, fadeOutSec: 5, curve: 'log' }), 100);
    expect(filters).toEqual([
      'afade=t=in:st=0:d=3:curve=log',
      'afade=t=out:st=95:d=5:curve=log',
    ]);
  });

  it('clamps a trimEnd past the real end of the file instead of failing', () => {
    // The UI's duration can round a few ms long; that must not produce a
    // filter that asks ffmpeg for audio which does not exist.
    expect(resolvedEndSec(edit({ trimEndSec: 400 }), 351)).toBe(351);
    const filters = buildEditFilters(edit({ trimEndSec: 400, fadeOutSec: 4 }), 351);
    expect(filters).toEqual(['afade=t=out:st=347:d=4:curve=qsin']);
  });

  it('shrinks overlapping fades proportionally rather than double-attenuating', () => {
    // 8 + 4 = 12s of fade on a 6s master would leave the middle attenuated by
    // both, which sounds broken. Scale both by 0.5 and the shape survives.
    const filters = buildEditFilters(edit({ trimStartSec: 0, trimEndSec: 6, fadeInSec: 8, fadeOutSec: 4 }), 300);
    expect(filters).toContain('afade=t=in:st=0:d=4:curve=qsin');
    expect(filters).toContain('afade=t=out:st=4:d=2:curve=qsin');
  });

  it('produces decimals ffmpeg can read, with no float noise', () => {
    const arg = buildEditFilterArg(edit({ trimStartSec: 0.1, trimEndSec: 0.3 + 12, fadeOutSec: 1.1 }), 300);
    expect(arg).not.toMatch(/e[+-]\d/i); // no exponent notation
    expect(arg).not.toMatch(/\d{6,}/); // no 0.30000000000000004
  });

  it('joins the chain with commas for a single -af argument', () => {
    const arg = buildEditFilterArg(edit({ trimStartSec: 10, trimEndSec: 70, fadeOutSec: 5 }), 300);
    expect(arg).toBe('atrim=start=10:end=70,asetpts=PTS-STARTPTS,afade=t=out:st=55:d=5:curve=qsin');
  });
});

describe('editedDurationSec', () => {
  it('is the trimmed window, clamped to the source', () => {
    expect(editedDurationSec(edit({ trimStartSec: 30, trimEndSec: 200 }), 300)).toBe(170);
    expect(editedDurationSec(edit({ trimStartSec: 30 }), 300)).toBe(270);
    expect(editedDurationSec(edit({ trimEndSec: 999 }), 300)).toBe(300);
  });

  it('never goes negative', () => {
    expect(editedDurationSec(edit({ trimStartSec: 400 }), 300)).toBe(0);
  });
});

describe('validateAgainstSource — the check that needs the real file', () => {
  it('passes a sane edit', () => {
    expect(validateAgainstSource(edit({ trimStartSec: 5, trimEndSec: 200, fadeOutSec: 6 }), 300))
      .toEqual({ ok: true });
  });

  it('refuses a trim start at or past the end of the file', () => {
    expect(validateAgainstSource(edit({ trimStartSec: 300 }), 300).ok).toBe(false);
    expect(validateAgainstSource(edit({ trimStartSec: 301 }), 300).ok).toBe(false);
  });

  it('refuses a master shorter than the minimum', () => {
    const r = validateAgainstSource(edit({ trimStartSec: 299.5 }), 300);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/shorter than/);
  });

  it('an unreadable duration blocks only the edits that depend on it', () => {
    // A head trim is placeable without knowing where the file ends; a tail trim
    // or fade-out is not, and guessing would silently misplace the fade.
    expect(validateAgainstSource(edit({ trimStartSec: 5 }), 0).ok).toBe(true);
    expect(validateAgainstSource(edit({ fadeOutSec: 5 }), 0).ok).toBe(false);
    expect(validateAgainstSource(edit({ trimEndSec: 100 }), Number.NaN).ok).toBe(false);
  });
});

describe('describeEdit', () => {
  it('says plainly that nothing was changed', () => {
    expect(describeEdit(NO_EDIT, 300)).toMatch(/No edit/);
  });

  it('names every part of the edit, including the curve', () => {
    const text = describeEdit(edit({ trimStartSec: 2, trimEndSec: 200, fadeInSec: 1, fadeOutSec: 6, curve: 'esin' }), 300);
    expect(text).toContain('starts at 2s');
    expect(text).toContain('ends at 200s');
    expect(text).toContain('1s fade in');
    expect(text).toContain('6s fade out (esin)');
  });

  it('does not claim an end trim when the file simply runs to its end', () => {
    expect(describeEdit(edit({ fadeOutSec: 6 }), 300)).not.toMatch(/ends at/);
  });
});
