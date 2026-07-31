import {
  formatMarkTime,
  addMark,
  removeMark,
  updateMark,
  marksToText,
  dominantReasons,
  reasonLabel,
  type AuditionMark,
} from '@/lib/audition-marks';
import { FAILURE_REASONS } from '@/types/generation';

const mark = (id: string, time: number, reason: AuditionMark['reason'], note = ''): AuditionMark => ({
  id,
  time,
  reason,
  note,
});

describe('formatMarkTime', () => {
  it('reads the way a note about a take is written', () => {
    expect(formatMarkTime(102)).toBe('1:42');
    expect(formatMarkTime(5)).toBe('0:05');
  });

  it('never shows a negative or NaN time', () => {
    expect(formatMarkTime(-1)).toBe('0:00');
    expect(formatMarkTime(Number.NaN)).toBe('0:00');
  });
});

describe('addMark keeps the list in time order', () => {
  it('inserts a late mark at the end', () => {
    const m = addMark([mark('a', 10, 'melody')], mark('b', 60, 'mixing'));
    expect(m.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('inserts an EARLIER mark in its place — the list is the output, read top to bottom', () => {
    const m = addMark([mark('a', 60, 'melody')], mark('b', 10, 'mixing'));
    expect(m.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the original list', () => {
    const orig = [mark('a', 10, 'melody')];
    addMark(orig, mark('b', 5, 'lyrics'));
    expect(orig).toHaveLength(1);
  });
});

describe('removeMark / updateMark', () => {
  it('removes by id', () => {
    expect(removeMark([mark('a', 1, 'melody'), mark('b', 2, 'rhythm')], 'a').map((m) => m.id)).toEqual([
      'b',
    ]);
  });

  it('updates a reason in place', () => {
    const m = updateMark([mark('a', 1, 'melody')], 'a', { reason: 'pronunciation' });
    expect(m[0].reason).toBe('pronunciation');
  });

  it('re-sorts when a time is corrected', () => {
    const m = updateMark([mark('a', 10, 'melody'), mark('b', 20, 'rhythm')], 'b', { time: 1 });
    expect(m.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('leaves other marks alone', () => {
    const m = updateMark([mark('a', 1, 'melody'), mark('b', 2, 'rhythm')], 'a', { note: 'x' });
    expect(m.find((x) => x.id === 'b')?.note).toBe('');
  });
});

describe('marksToText — the paste target is a human-read notes field', () => {
  it('renders one line per mark, in time order', () => {
    const t = marksToText([mark('a', 102, 'pronunciation', 'ழ sounds like ல'), mark('b', 8, 'melody')]);
    expect(t.split('\n')[0]).toContain('0:08');
    expect(t).toContain('1:42 — pronunciation: ழ sounds like ல');
  });

  it('omits the colon when there is no note', () => {
    expect(marksToText([mark('a', 8, 'melody')])).toBe('0:08 — melody');
  });

  it('includes the title when given', () => {
    expect(marksToText([mark('a', 8, 'melody')], 'ஈழத்து மண்ணே')).toContain('ஈழத்து மண்ணே');
  });

  it('is empty for no marks, so nothing useless gets copied', () => {
    expect(marksToText([])).toBe('');
  });
});

describe('dominantReasons — the verdict-shaped output', () => {
  it('ranks by count, which is what a failureReason actually is', () => {
    const marks = [
      mark('a', 1, 'pronunciation'),
      mark('b', 2, 'pronunciation'),
      mark('c', 3, 'mixing'),
    ];
    expect(dominantReasons(marks)[0]).toEqual({ reason: 'pronunciation', count: 2 });
  });

  it('breaks ties deterministically, so the same take reads the same twice', () => {
    const a = dominantReasons([mark('a', 1, 'rhythm'), mark('b', 2, 'melody')]);
    const b = dominantReasons([mark('b', 2, 'melody'), mark('a', 1, 'rhythm')]);
    expect(a).toEqual(b);
  });

  it('is empty for no marks', () => {
    expect(dominantReasons([])).toEqual([]);
  });
});

describe('vocabulary', () => {
  it('reuses the Music Lab failure taxonomy verbatim, so no translation is needed later', () => {
    // A mark's reason must be assignable to a Generation's failureReason.
    for (const r of FAILURE_REASONS) {
      expect(() => mark('x', 0, r)).not.toThrow();
    }
  });

  it('labels the snake_case value for humans', () => {
    expect(reasonLabel('vocal_delivery')).toBe('vocal delivery');
    expect(reasonLabel('melody')).toBe('melody');
  });
});

describe('marksToText sorts defensively', () => {
  it('orders by time even when handed an unsorted array', () => {
    // Callers may build the list another way; the output must still read
    // straight through against the song.
    const t = marksToText([mark('a', 102, 'pronunciation'), mark('b', 8, 'melody')]);
    expect(t.split('\n')[0]).toContain('0:08');
    expect(t.split('\n')[1]).toContain('1:42');
  });
});
