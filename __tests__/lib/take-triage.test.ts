/** @jest-environment node */
/**
 * Take triage — the rules that decide whether hours of listening survive a
 * rescan. The merge semantics matter more than anything else here: silently
 * losing a decision on a 2,450-file manifest would be unrecoverable, because
 * there is no way to tell which verdicts went missing.
 */

import {
  TAKE_DECISIONS,
  emptyManifest,
  mergeScan,
  setDecision,
  stats,
  nextUndecided,
  exportQueue,
  exportRecipes,
  type TriageManifest,
} from '@/lib/take-triage';

const NOW = '2026-07-22T12:00:00.000Z';
const scan = (...files: string[]) => files.map((file) => ({ file }));

function seeded(): TriageManifest {
  let m = mergeScan(emptyManifest('/takes'), scan('a.mp3', 'b.mp3', 'c.mp3'));
  m = (setDecision(m, 'a.mp3', 'instrumental', { now: NOW }) as { manifest: TriageManifest }).manifest;
  m = (setDecision(m, 'b.mp3', 'discard', { note: 'vocals unusable', now: NOW }) as { manifest: TriageManifest }).manifest;
  return m;
}

describe('mergeScan', () => {
  it('adds newly-seen files as undecided', () => {
    const m = mergeScan(emptyManifest('/takes'), scan('x.mp3', 'y.mp3'));
    expect(m.takes.map((t) => t.file)).toEqual(['x.mp3', 'y.mp3']);
    expect(m.takes.every((t) => t.decision === 'undecided')).toBe(true);
  });

  // The rule that protects the listening work.
  it('never overwrites an existing decision on rescan', () => {
    const m = mergeScan(seeded(), scan('a.mp3', 'b.mp3', 'c.mp3'));
    expect(m.takes.find((t) => t.file === 'a.mp3')?.decision).toBe('instrumental');
    expect(m.takes.find((t) => t.file === 'b.mp3')?.decision).toBe('discard');
    expect(m.takes.find((t) => t.file === 'b.mp3')?.note).toBe('vocals unusable');
  });

  it('flags a vanished file as missing rather than dropping its verdict', () => {
    const m = mergeScan(seeded(), scan('a.mp3', 'c.mp3')); // b.mp3 moved/renamed
    const b = m.takes.find((t) => t.file === 'b.mp3');
    expect(b).toBeDefined();
    expect(b?.missing).toBe(true);
    expect(b?.decision).toBe('discard'); // verdict survives
  });

  it('un-flags a file that reappears, decision intact', () => {
    const gone = mergeScan(seeded(), scan('a.mp3', 'c.mp3'));
    const back = mergeScan(gone, scan('a.mp3', 'b.mp3', 'c.mp3'));
    const b = back.takes.find((t) => t.file === 'b.mp3');
    expect(b?.missing).toBeUndefined();
    expect(b?.decision).toBe('discard');
  });

  it('fills probe gaps without wiping measurements from an earlier probe', () => {
    let m = mergeScan(emptyManifest('/takes'), [{ file: 'a.mp3', durationSec: 210, lufs: -12 }]);
    m = mergeScan(m, [{ file: 'a.mp3' }]); // a cheap rescan with no --probe
    expect(m.takes[0].durationSec).toBe(210);
    expect(m.takes[0].lufs).toBe(-12);
  });

  it('adds a recipe discovered on a later scan', () => {
    let m = mergeScan(emptyManifest('/takes'), scan('a.mp3'));
    m = mergeScan(m, [{ file: 'a.mp3', recipe: 'Kapi raga, 82 BPM' }]);
    expect(m.takes[0].recipe).toBe('Kapi raga, 82 BPM');
  });

  it('does not duplicate rows across repeated scans', () => {
    const once = mergeScan(emptyManifest('/takes'), scan('a.mp3', 'b.mp3'));
    const twice = mergeScan(once, scan('a.mp3', 'b.mp3'));
    expect(twice.takes).toHaveLength(2);
  });
});

describe('setDecision', () => {
  it('records the decision, note and timestamp', () => {
    const r = setDecision(seeded(), 'c.mp3', 'hook', { note: 'strong 20s opening', now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.manifest.takes.find((t) => t.file === 'c.mp3');
    expect(c).toMatchObject({ decision: 'hook', note: 'strong 20s opening', decidedAt: NOW });
  });

  it('rejects a file that is not in the manifest instead of inventing a row', () => {
    const r = setDecision(seeded(), 'nope.mp3', 'keep', { now: NOW });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('nope.mp3');
  });

  it('is immutable — the original manifest is untouched', () => {
    const before = seeded();
    setDecision(before, 'c.mp3', 'keep', { now: NOW });
    expect(before.takes.find((t) => t.file === 'c.mp3')?.decision).toBe('undecided');
  });
});

describe('stats', () => {
  it('counts by decision and reports progress', () => {
    const s = stats(seeded());
    expect(s.total).toBe(3);
    expect(s.decided).toBe(2);
    expect(s.remaining).toBe(1);
    expect(s.byDecision.instrumental).toBe(1);
    expect(s.byDecision.discard).toBe(1);
    expect(s.progress).toBeCloseTo(2 / 3);
  });

  it('returns null progress for an empty manifest rather than a fake 0% or 100%', () => {
    expect(stats(emptyManifest('/takes')).progress).toBeNull();
  });

  it('surfaces missing files so a broken manifest is visible', () => {
    expect(stats(mergeScan(seeded(), scan('a.mp3'))).missing).toBe(2);
  });

  it('has a bucket for every decision, including unused ones', () => {
    const s = stats(emptyManifest('/takes'));
    for (const d of TAKE_DECISIONS) expect(s.byDecision[d]).toBe(0);
  });
});

describe('nextUndecided', () => {
  it('returns undecided takes in stable order so a session resumes', () => {
    const m = mergeScan(emptyManifest('/takes'), scan('a.mp3', 'b.mp3', 'c.mp3'));
    expect(nextUndecided(m, 2).map((t) => t.file)).toEqual(['a.mp3', 'b.mp3']);
    expect(nextUndecided(m, 2).map((t) => t.file)).toEqual(['a.mp3', 'b.mp3']);
  });

  it('skips missing files — there is nothing to listen to', () => {
    const m = mergeScan(mergeScan(emptyManifest('/takes'), scan('a.mp3', 'b.mp3')), scan('b.mp3'));
    expect(nextUndecided(m, 5).map((t) => t.file)).toEqual(['b.mp3']);
  });
});

describe('exportQueue', () => {
  it('returns only files with the requested decision', () => {
    expect(exportQueue(seeded(), 'instrumental')).toEqual(['a.mp3']);
    expect(exportQueue(seeded(), 'keep')).toEqual([]);
  });

  // A batch Demucs run that dies halfway on a stale path wastes an hour.
  it('excludes missing files so a batch run cannot fail on a stale path', () => {
    const m = mergeScan(seeded(), scan('b.mp3', 'c.mp3')); // a.mp3 (instrumental) gone
    expect(exportQueue(m, 'instrumental')).toEqual([]);
  });
});

describe('exportRecipes', () => {
  it('keeps the recipe and verdict for discards — the data outlives the audio', () => {
    let m = mergeScan(emptyManifest('/takes'), [{ file: 'a.mp3', recipe: 'Kapi 82bpm' }]);
    m = (setDecision(m, 'a.mp3', 'discard', { note: 'flat vocal', now: NOW }) as { manifest: TriageManifest }).manifest;
    expect(exportRecipes(m)).toEqual([{ file: 'a.mp3', decision: 'discard', note: 'flat vocal', recipe: 'Kapi 82bpm' }]);
  });

  it('omits takes carrying neither a recipe nor a note', () => {
    expect(exportRecipes(mergeScan(emptyManifest('/takes'), scan('bare.mp3')))).toEqual([]);
  });
});
