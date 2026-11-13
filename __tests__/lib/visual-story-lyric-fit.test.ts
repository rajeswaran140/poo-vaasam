/**
 * Fit the rows to the sung lines (design 2026-11-13 §5.2), on the real
 * பூவும் காற்றும் timings: 36 lines in the 3-minute window, 13 clips made.
 */
import fixture from '../fixtures/poovum-lines.json';
import { BREAK_GAP_SEC, cutGrid, fitKeepRows, linesInWindow, type FitRowIn, type WindowLine } from '@/lib/visual-story-lyric-fit';

const lines = fixture.lines as WindowLine[];
const W = fixture.windowSec;
const clipRows = (over: Partial<FitRowIn>[] = []): FitRowIn[] =>
  fixture.clipSecs.map((c, i) => ({ clipSec: c, isClip: true, isOwn: false, continuedFrom: false, currentSec: c, ...over[i] }));
const floorT = (s: number) => Math.floor(Math.round(s * 1000) / 100);

describe('cutGrid', () => {
  const grid = cutGrid(lines, W);
  it('never cuts inside a sung line: between two lines less than 4 s apart, only the line start', () => {
    expect(BREAK_GAP_SEC).toBe(4);
    for (let k = 0; k + 1 < lines.length; k++) {
      if (lines[k + 1].startSec - lines[k].endSec >= BREAK_GAP_SEC) continue;
      const a = floorT(lines[k].startSec);
      const b = floorT(lines[k + 1].startSec);
      expect(grid.tenths.filter((t) => t > a && t < b)).toEqual([]);
    }
  });
  it('offers every line start, floored to the tenth', () => {
    for (const l of lines) expect(grid.tenths).toContain(floorT(l.startSec));
  });
  it('clamps the music after line 26 to the start of line 27 (2:21.98 → 1419, never 1420)', () => {
    expect(grid.tenths).toContain(1419);
    expect(grid.tenths).not.toContain(1420);
    expect(grid.tenths).toContain(1300); // inside the break
  });
  it('keeps 0 and the window end out of the grid', () => {
    expect(grid.tenths[0]).toBeGreaterThan(0);
    expect(grid.tenths[grid.tenths.length - 1]).toBeLessThan(W * 10);
  });
});

describe('fitKeepRows on பூவும் காற்றும்', () => {
  it('keeps all 13 clips: every cut on a line start or in the music, none slower than 88 %', () => {
    const t0 = Date.now();
    const fit = fitKeepRows(clipRows(), lines, W);
    expect(Date.now() - t0).toBeLessThan(2000);
    if (!fit.ok) throw new Error(fit.error);
    expect(fit.rows).toHaveLength(13);
    expect(fit.staleCount).toBe(0);
    const grid = new Set(cutGrid(lines, W).tenths);
    let at = 0;
    for (const r of fit.rows) {
      expect(Math.round(r.startSec * 10)).toBe(at);
      at = Math.round(r.endSec * 10);
      expect(r.fit?.kind).not.toBe('stale');
      if (r.fit?.kind === 'slow') expect(r.fit.rate).toBeGreaterThanOrEqual(0.88);
    }
    expect(at).toBe(W * 10);
    for (const r of fit.rows.slice(1)) expect(grid.has(Math.round(r.startSec * 10))).toBe(true);
    expect(fit.rows[1].lines).not.toBeNull();
  });

  it('trim only (no slow-down) needs new clips: 9 of 13', () => {
    const fit = fitKeepRows(clipRows(), lines, W, { minRate: 1 });
    if (!fit.ok) throw new Error(fit.error);
    expect(fit.staleCount).toBe(9);
    expect(fit.rows.filter((r) => r.fit?.kind === 'stale')).toHaveLength(9);
  });

  it('never trims a clip a chained row continues from', () => {
    const fit = fitKeepRows(clipRows([{}, {}, { continuedFrom: true }]), lines, W);
    if (!fit.ok) throw new Error(fit.error);
    expect(fit.rows[2].fit?.kind).not.toBe('trim');
  });

  it('keeps a clip of unknown length at its whole seconds (with a picture row for slack)', () => {
    // பூவும் is tight: 13 rows of at most 15 s with cuts only on line starts leave no room to pin one.
    const picture: FitRowIn = { clipSec: null, isClip: false, isOwn: false, continuedFrom: false, currentSec: 5 };
    const fit = fitKeepRows([...clipRows([{ clipSec: null, currentSec: 14 }]), picture], lines, W);
    if (!fit.ok) throw new Error(fit.error);
    expect(fit.rows[0].durationSec).toBe(14);
    expect(fit.rows[0].fit).toEqual({ kind: 'exact' });
  });
  it('an unknown-length clip that leaves no room makes the fit refuse, never a guess', () => {
    expect(fitKeepRows(clipRows([{ clipSec: null, currentSec: 14 }]), lines, W).ok).toBe(false);
  });

  it('says plainly when the rows cannot cover the window', () => {
    const two = clipRows().slice(0, 2);
    expect(fitKeepRows(two, lines, W)).toEqual({
      ok: false,
      error: 'These 2 rows cannot cover 3:00 with every cut on a line start or in the music. Add or remove a row.',
    });
  });
});

describe('linesInWindow', () => {
  it('keeps the lines that start inside the window, in window time', () => {
    const timed = lines.map((l) => ({ ...l }));
    const got = linesInWindow(timed, 40, 100);
    expect(got[0]).toEqual({ ...lines[5], startSec: 3.1, endSec: 7.86 });
    expect(got.every((l) => l.startSec >= 0 && l.startSec < 60 && l.endSec <= 60)).toBe(true);
    expect(got).toHaveLength(lines.filter((l) => l.startSec >= 40 && l.startSec < 100).length);
  });
});
