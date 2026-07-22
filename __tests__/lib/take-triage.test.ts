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
  isDerivedOutput,
  isScannable,
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

// Identity is the content hash, so a verdict follows the audio when takes get
// reorganised between sittings. Re-listening to a take because it moved is the
// exact waste this tool exists to prevent.
describe('mergeScan — rename survival via content hash', () => {
  const hashed = (file: string, hash: string) => ({ file, hash });

  function withHashes(): TriageManifest {
    let m = mergeScan(emptyManifest('/takes'), [hashed('a.mp3', 'H1'), hashed('b.mp3', 'H2')]);
    m = (setDecision(m, 'a.mp3', 'instrumental', { note: 'keeper arrangement', now: NOW }) as { manifest: TriageManifest }).manifest;
    return m;
  }

  it('carries the verdict to the new path when a file is renamed', () => {
    const m = mergeScan(withHashes(), [hashed('renamed.mp3', 'H1'), hashed('b.mp3', 'H2')]);
    const moved = m.takes.find((t) => t.hash === 'H1');
    expect(moved?.file).toBe('renamed.mp3');
    expect(moved?.decision).toBe('instrumental');
    expect(moved?.note).toBe('keeper arrangement');
    expect(moved?.missing).toBeUndefined();
    expect(m.takes).toHaveLength(2); // not orphaned + re-added
  });

  it('follows a file moved into a different folder', () => {
    const m = mergeScan(withHashes(), [hashed('sorted/keepers/a.mp3', 'H1'), hashed('b.mp3', 'H2')]);
    expect(m.takes.find((t) => t.hash === 'H1')?.file).toBe('sorted/keepers/a.mp3');
    expect(m.takes.find((t) => t.hash === 'H1')?.decision).toBe('instrumental');
  });

  it('still flags missing when the content is genuinely gone', () => {
    const m = mergeScan(withHashes(), [hashed('b.mp3', 'H2')]);
    expect(m.takes.find((t) => t.hash === 'H1')?.missing).toBe(true);
  });

  // A wrong transfer is worse than re-triaging: it would put a verdict on the
  // wrong audio, silently.
  it('does not let two rows claim the same duplicate file', () => {
    let m = mergeScan(emptyManifest('/takes'), [hashed('one.mp3', 'DUP'), hashed('two.mp3', 'DUP')]);
    m = (setDecision(m, 'one.mp3', 'keep', { now: NOW }) as { manifest: TriageManifest }).manifest;
    m = (setDecision(m, 'two.mp3', 'discard', { now: NOW }) as { manifest: TriageManifest }).manifest;
    const after = mergeScan(m, [hashed('one.mp3', 'DUP'), hashed('two.mp3', 'DUP')]);
    expect(after.takes).toHaveLength(2);
    expect(after.takes.find((t) => t.file === 'one.mp3')?.decision).toBe('keep');
    expect(after.takes.find((t) => t.file === 'two.mp3')?.decision).toBe('discard');
  });

  // The guard only bites when BOTH rows fall through to hash matching — i.e. one
  // copy of a duplicated take was deleted and the survivor renamed. Without it,
  // two rows point at the same file and neither is flagged missing, so the
  // manifest quietly claims a verdict for audio that no longer exists.
  // (Found by mutation testing — the earlier duplicate test matched by path and
  // never reached this code.)
  it('lets only ONE row claim a renamed duplicate; the other is flagged missing', () => {
    let m = mergeScan(emptyManifest('/takes'), [hashed('one.mp3', 'DUP'), hashed('two.mp3', 'DUP')]);
    m = (setDecision(m, 'one.mp3', 'keep', { now: NOW }) as { manifest: TriageManifest }).manifest;
    m = (setDecision(m, 'two.mp3', 'discard', { now: NOW }) as { manifest: TriageManifest }).manifest;

    // one copy deleted, the survivor renamed → both rows must go to hash matching
    const after = mergeScan(m, [hashed('survivor.mp3', 'DUP')]);

    const claimedRows = after.takes.filter((t) => t.file === 'survivor.mp3');
    expect(claimedRows).toHaveLength(1);
    const missingRows = after.takes.filter((t) => t.missing);
    expect(missingRows).toHaveLength(1);
    expect(after.takes).toHaveLength(2);
  });

  it('prefers a path match over a hash match, so identical copies stay put', () => {
    let m = mergeScan(emptyManifest('/takes'), [hashed('x.mp3', 'SAME'), hashed('y.mp3', 'SAME')]);
    m = (setDecision(m, 'y.mp3', 'hook', { now: NOW }) as { manifest: TriageManifest }).manifest;
    const after = mergeScan(m, [hashed('y.mp3', 'SAME'), hashed('x.mp3', 'SAME')]);
    expect(after.takes.find((t) => t.file === 'y.mp3')?.decision).toBe('hook');
    expect(after.takes.find((t) => t.file === 'x.mp3')?.decision).toBe('undecided');
  });

  it('degrades to path matching for rows written before hashing existed', () => {
    let legacy = mergeScan(emptyManifest('/takes'), scan('old.mp3')); // no hash
    legacy = (setDecision(legacy, 'old.mp3', 'keep', { now: NOW }) as { manifest: TriageManifest }).manifest;
    const same = mergeScan(legacy, [hashed('old.mp3', 'H9')]);
    expect(same.takes[0].decision).toBe('keep');
    expect(same.takes[0].hash).toBe('H9'); // backfilled going forward
    const renamed = mergeScan(legacy, [hashed('new.mp3', 'H9')]);
    expect(renamed.takes.find((t) => t.file === 'old.mp3')?.missing).toBe(true); // can't match without a stored hash
  });

  it('handles a rename and a genuinely new file in the same scan', () => {
    const m = mergeScan(withHashes(), [hashed('moved.mp3', 'H1'), hashed('b.mp3', 'H2'), hashed('fresh.mp3', 'H3')]);
    expect(m.takes).toHaveLength(3);
    expect(m.takes.find((t) => t.hash === 'H1')?.decision).toBe('instrumental');
    expect(m.takes.find((t) => t.hash === 'H3')?.decision).toBe('undecided');
  });
});

// Found by running Demucs for real: its `-instrumental` output, written into
// the triage root, came back on the next scan as a NEW undecided take. You'd
// re-triage your own derived files, and could feed an instrumental back into
// Demucs.
describe('isDerivedOutput / isScannable', () => {
  it('flags this toolchain’s own outputs', () => {
    expect(isDerivedOutput('sorted/amma-instrumental.mp3')).toBe(true);
    expect(isDerivedOutput('x-master.wav')).toBe(true);
    expect(isDerivedOutput('hooks/opening-short.mp4')).toBe(true);
    expect(isDerivedOutput('htdemucs/song-no_vocals.wav')).toBe(true);
  });

  it('does NOT flag an ordinary take, even one that mentions instruments', () => {
    expect(isDerivedOutput('take-042.mp3')).toBe(false);
    expect(isDerivedOutput('flute-and-veena-ballad.mp3')).toBe(false); // not a SUFFIX
    expect(isDerivedOutput('instrumental-intro-take.mp3')).toBe(false); // suffix is at the END
  });

  it('is case-insensitive on the suffix', () => {
    expect(isDerivedOutput('AMMA-INSTRUMENTAL.MP3')).toBe(true);
  });

  it('honours user --exclude substrings without touching derived rules', () => {
    expect(isScannable('rejects/take-1.mp3', ['rejects'])).toBe(false);
    expect(isScannable('keepers/take-1.mp3', ['rejects'])).toBe(true);
    expect(isScannable('take-1.mp3')).toBe(true);
    expect(isScannable('take-1-instrumental.mp3')).toBe(false); // derived, even with no --exclude
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
