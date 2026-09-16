/** @jest-environment node */
/**
 * The clock parser behind the short's "Start at" field.
 *
 * It exists because the operator's method is to pick the section with the best
 * LYRICS, and a lyric sheet is read in minutes and seconds. Typing "1:36" has
 * to mean 96 seconds, and typing rubbish has to mean "you decide" rather than
 * an accidental 0:00 — a short that silently starts at the top of the song is
 * exactly the failure this whole picker exists to prevent.
 */
import { parseClock, formatClock } from '@/components/admin/ShortWindowFields';

describe('parseClock', () => {
  it.each([
    ['1:36', 96],
    ['0:08', 8],
    ['12:05', 725],
    ['1:36.5', 96.5],
    ['96', 96],
    ['96.5', 96.5],
    ['  1:36  ', 96],
  ])('reads %s as %ss', (text, seconds) => {
    expect(parseClock(text)).toBe(seconds);
  });

  it.each([['', '1:60', 'abc', '1:2:3', '-5', '1:', ':30']].flat())(
    'returns null for %p rather than guessing',
    (text) => {
      expect(parseClock(text)).toBeNull();
    }
  );
});

describe('formatClock', () => {
  it.each([
    [96, '1:36'],
    [8, '0:08'],
    [725, '12:05'],
    [0, '0:00'],
  ])('writes %ss as %s', (seconds, text) => {
    expect(formatClock(seconds)).toBe(text);
  });

  it('shows tenths only when they carry information', () => {
    expect(formatClock(96.5)).toBe('1:36.5');
    expect(formatClock(96)).toBe('1:36');
  });

  it('round-trips through parseClock', () => {
    for (const s of [0, 8, 96, 96.5, 725]) {
      expect(parseClock(formatClock(s))).toBe(s);
    }
  });

  it('never renders a negative clock', () => {
    expect(formatClock(-5)).toBe('0:00');
  });
});
