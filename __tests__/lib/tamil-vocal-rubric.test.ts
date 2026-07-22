/** @jest-environment node */
/**
 * Tamil vocal rubric — the scoring model for the engine A/B (docs/TAMIL_VOCAL_AB.md).
 *
 * The behaviour that matters most is the intelligibility GATE: a take that
 * sounds lovely but mispronounces meaning-bearing phonemes must never come out
 * as releasable, because that is precisely the failure a generic "vocals 0-10"
 * score hides.
 */

import {
  TAMIL_VOCAL_AXES,
  MAX_AXIS_SCORE,
  scoreTamilVocal,
  blindLabels,
} from '@/lib/tamil-vocal-rubric';

describe('axis definitions', () => {
  it('covers the five documented failure modes', () => {
    expect(TAMIL_VOCAL_AXES.map((a) => a.key)).toEqual([
      'retroflex', 'vowelLength', 'wordBoundary', 'gemination', 'prosody',
    ]);
  });

  it('gives every axis one anchor per score point, so a score is never unlabelled', () => {
    for (const a of TAMIL_VOCAL_AXES) {
      expect(a.anchors).toHaveLength(MAX_AXIS_SCORE + 1);
      expect(a.anchors.every((t) => t.trim().length > 0)).toBe(true);
      expect(a.probes.length).toBeGreaterThan(0);
    }
  });

  it('weights meaning-bearing axes above aesthetic ones', () => {
    const w = Object.fromEntries(TAMIL_VOCAL_AXES.map((a) => [a.key, a.weight]));
    expect(w.retroflex).toBeGreaterThan(w.prosody);
    expect(w.vowelLength).toBeGreaterThan(w.prosody);
  });
});

describe('scoreTamilVocal', () => {
  const perfect = { retroflex: 4, vowelLength: 4, wordBoundary: 4, gemination: 4, prosody: 4 };

  it('returns nulls when nothing has been scored', () => {
    const r = scoreTamilVocal({});
    expect(r).toMatchObject({ composite: null, intelligibility: null, verdict: null, scored: 0 });
  });

  it('scores a flawless take 100 and releasable', () => {
    const r = scoreTamilVocal(perfect);
    expect(r.composite).toBe(100);
    expect(r.intelligibility).toBe(100);
    expect(r.verdict).toBe('releasable');
    expect(r.scored).toBe(5);
  });

  it('scores a total failure 0 and unusable', () => {
    const r = scoreTamilVocal({ retroflex: 0, vowelLength: 0, wordBoundary: 0, gemination: 0, prosody: 0 });
    expect(r.composite).toBe(0);
    expect(r.verdict).toBe('unusable');
  });

  // The whole reason this rubric exists rather than a single 0-10 rating.
  it('refuses to call a pretty-but-mispronounced take releasable', () => {
    const prettyButWrong = {
      retroflex: 0,      // ழ/ள/ல collapsed — says the wrong word
      vowelLength: 1,
      gemination: 1,
      wordBoundary: 4,   // flawless phrasing
      prosody: 4,        // moving delivery
    };
    const r = scoreTamilVocal(prettyButWrong);
    expect(r.intelligibility).toBeLessThan(50);
    expect(r.verdict).toBe('unusable');
  });

  it('ranks a plain-but-correct take above a pretty-but-wrong one', () => {
    const plainCorrect = scoreTamilVocal({ retroflex: 4, vowelLength: 4, gemination: 4, wordBoundary: 2, prosody: 0 });
    const prettyWrong = scoreTamilVocal({ retroflex: 0, vowelLength: 1, gemination: 1, wordBoundary: 4, prosody: 4 });
    expect(plainCorrect.composite!).toBeGreaterThan(prettyWrong.composite!);
    expect(plainCorrect.verdict).toBe('releasable');
    expect(prettyWrong.verdict).toBe('unusable');
  });

  it('holds back a take with adequate intelligibility but a weak composite', () => {
    const r = scoreTamilVocal({ retroflex: 3, vowelLength: 3, gemination: 3, wordBoundary: 0, prosody: 0 });
    expect(r.intelligibility).toBe(75);
    expect(r.composite).toBeLessThan(65);
    expect(r.verdict).toBe('needs-work');
  });

  // These two pin the GATE itself. Both have a composite that a composite-only
  // rule would grade differently, so they fail if the verdict ever stops being
  // driven by intelligibility. (Found by mutation testing — the earlier cases
  // happened to agree under both rules and proved nothing.)
  it('holds back a take with one collapsed phoneme axis despite a strong composite', () => {
    const r = scoreTamilVocal({ retroflex: 1, vowelLength: 4, wordBoundary: 4, gemination: 4, prosody: 4 });
    expect(r.composite).toBe(80); // a composite-only rule would call this releasable
    expect(r.intelligibility).toBe(72);
    expect(r.verdict).toBe('needs-work');
  });

  it('passes a phonetically perfect but musically plain take', () => {
    const r = scoreTamilVocal({ retroflex: 4, vowelLength: 4, wordBoundary: 0, gemination: 4, prosody: 0 });
    expect(r.composite).toBe(73); // a composite-only rule would call this needs-work
    expect(r.intelligibility).toBe(100);
    expect(r.verdict).toBe('releasable');
  });

  it('withholds a verdict until the intelligibility axes are scored', () => {
    expect(scoreTamilVocal({ prosody: 4, wordBoundary: 4 }).verdict).toBeNull();
  });

  it('scores partial input over only the axes actually filled in', () => {
    // retroflex alone at full marks → 100%, not penalised for unscored axes.
    expect(scoreTamilVocal({ retroflex: 4 }).intelligibility).toBe(100);
    expect(scoreTamilVocal({ retroflex: 2 }).intelligibility).toBe(50);
  });
});

describe('blindLabels', () => {
  const takes = ['suno-a', 'suno-b', 'eleven-a', 'eleven-b', 'lyria-a'];

  it('labels every take exactly once, losing nothing', () => {
    const out = blindLabels(takes, 7);
    expect(out).toHaveLength(takes.length);
    expect(out.map((o) => o.label)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect([...out.map((o) => o.take)].sort()).toEqual([...takes].sort());
  });

  it('is deterministic for a seed, so the mapping is recoverable afterwards', () => {
    expect(blindLabels(takes, 42)).toEqual(blindLabels(takes, 42));
  });

  it('actually shuffles — a different seed gives a different order', () => {
    const orders = new Set([1, 2, 3, 4, 5].map((s) => blindLabels(takes, s).map((o) => o.take).join(',')));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('does not simply return input order (which would defeat blinding)', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const anyShuffled = seeds.some(
      (s) => blindLabels(takes, s).map((o) => o.take).join(',') !== takes.join(',')
    );
    expect(anyShuffled).toBe(true);
  });

  it('handles empty and single-item inputs without throwing', () => {
    expect(blindLabels([], 1)).toEqual([]);
    expect(blindLabels(['only'], 1)).toEqual([{ label: 'A', take: 'only' }]);
  });
});
