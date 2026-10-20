// __tests__/lib/repair-marks.test.ts
import {
  parseNewMark, parseMarkPatch, sortMarks, parentMarksView, markTimeLabel,
  repairMarksToText, masterDurationSec, MAX_NOTE_CHARS, type RepairMark,
} from '@/lib/repair-marks';

const mark = (over: Partial<RepairMark> = {}): RepairMark => ({
  markId: 'm1', masterJobId: 'job1', start: 102, end: null, reason: 'pronunciation',
  note: '', status: 'open', fixedIn: null, version: 1,
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', ...over,
});

describe('parseNewMark', () => {
  it('accepts a moment and defaults note to empty', () => {
    expect(parseNewMark({ start: 102, reason: 'pronunciation' }, 300))
      .toEqual({ ok: true, value: { start: 102, end: null, reason: 'pronunciation', note: '' } });
  });
  it('accepts a span', () => {
    const r = parseNewMark({ start: 102, end: 109.5, reason: 'melody', note: 'ழ sung as ல' }, 300);
    expect(r).toEqual({ ok: true, value: { start: 102, end: 109.5, reason: 'melody', note: 'ழ sung as ல' } });
  });
  it.each([
    [{ start: -1, reason: 'melody' }],
    [{ start: 'x', reason: 'melody' }],
    [{ start: 10, end: 10, reason: 'melody' }],
    [{ start: 10, end: 5, reason: 'melody' }],
    [{ start: 10, reason: 'not-a-reason' }],
    [{ start: 10, reason: 'melody', note: 'x'.repeat(MAX_NOTE_CHARS + 1) }],
    [null],
  ])('refuses %j', (body) => {
    expect(parseNewMark(body, 300).ok).toBe(false);
  });
  it('refuses a mark past the end of a master whose duration is known', () => {
    expect(parseNewMark({ start: 301, reason: 'melody' }, 300).ok).toBe(false);
    expect(parseNewMark({ start: 290, end: 302, reason: 'melody' }, 300).ok).toBe(false);
  });
  it('allows half a second of slack at the end (the player and the probe round differently)', () => {
    expect(parseNewMark({ start: 300.3, reason: 'melody' }, 300).ok).toBe(true);
  });
  it('skips only the duration bound when the duration is unknown', () => {
    expect(parseNewMark({ start: 9999, reason: 'melody' }, null).ok).toBe(true);
    expect(parseNewMark({ start: 10, end: 5, reason: 'melody' }, null).ok).toBe(false);
  });
});

describe('parseMarkPatch', () => {
  it('needs the version the client last saw', () => {
    expect(parseMarkPatch({ status: 'fixed' }, mark(), 300).ok).toBe(false);
  });
  it('accepts status, note and fixedIn', () => {
    expect(parseMarkPatch({ version: 1, status: 'fixed', fixedIn: 'child1', note: 'ok now' }, mark(), 300))
      .toEqual({ ok: true, version: 1, patch: { status: 'fixed', fixedIn: 'child1', note: 'ok now' } });
  });
  it('validates the merged span, not the patch alone', () => {
    // current is a moment at 102; setting end 100 makes end < start
    expect(parseMarkPatch({ version: 1, end: 100 }, mark(), 300).ok).toBe(false);
    expect(parseMarkPatch({ version: 1, end: 110 }, mark(), 300).ok).toBe(true);
  });
  it('refuses an unknown status and a bad fixedIn', () => {
    expect(parseMarkPatch({ version: 1, status: 'done' }, mark(), 300).ok).toBe(false);
    expect(parseMarkPatch({ version: 1, fixedIn: '../x' }, mark(), 300).ok).toBe(false);
  });
  it('refuses a null start (it would persist as a non-number)', () => {
    expect(parseMarkPatch({ version: 1, start: null }, mark(), 300).ok).toBe(false);
  });
  it('refuses an empty patch', () => {
    expect(parseMarkPatch({ version: 1 }, mark(), 300).ok).toBe(false);
  });
});

describe('ordering and views', () => {
  it('sorts by start, then by creation', () => {
    const a = mark({ markId: 'a', start: 50, createdAt: '2026-10-20T00:00:02.000Z' });
    const b = mark({ markId: 'b', start: 50, createdAt: '2026-10-20T00:00:01.000Z' });
    const c = mark({ markId: 'c', start: 10 });
    expect(sortMarks([a, b, c]).map((m) => m.markId)).toEqual(['c', 'b', 'a']);
  });
  it('puts open parent marks first', () => {
    const fixed = mark({ markId: 'f', start: 1, status: 'fixed' });
    const open = mark({ markId: 'o', start: 99 });
    expect(parentMarksView([fixed, open]).map((m) => m.markId)).toEqual(['o', 'f']);
  });
});

describe('labels and text', () => {
  it('labels a moment and a span', () => {
    expect(markTimeLabel({ start: 102, end: null })).toBe('1:42');
    expect(markTimeLabel({ start: 102, end: 109 })).toBe('1:42–1:49');
  });
  it('writes status only when not open', () => {
    const text = repairMarksToText([
      mark({ start: 102, note: 'ழ' }),
      mark({ markId: 'm2', start: 120, end: 125, reason: 'melody', status: 'fixed' }),
    ], 'பாடல்');
    expect(text).toBe('பாடல்\n1:42 — pronunciation: ழ\n2:00–2:05 — melody [Fixed]');
  });
});

describe('masterDurationSec', () => {
  it('prefers the edited duration, then the source, else null', () => {
    expect(masterDurationSec({ editedDurationSec: 200, source: { durationSec: 300 } })).toBe(200);
    expect(masterDurationSec({ editedDurationSec: null, source: { durationSec: 300 } })).toBe(300);
    expect(masterDurationSec({ editedDurationSec: null, source: null })).toBeNull();
  });
});
