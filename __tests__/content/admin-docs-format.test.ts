import { formatDocUpdatedAt } from '@/content/admin-docs';

describe('formatDocUpdatedAt', () => {
  it('renders a date-only string with no time-of-day', () => {
    expect(formatDocUpdatedAt('2026-08-21')).toBe('21 Aug 2026');
  });

  it('renders a full ISO timestamp with the UTC time-of-day appended', () => {
    expect(formatDocUpdatedAt('2026-08-21T19:47:00Z')).toBe('21 Aug 2026 · 19:47 UTC');
  });

  it('zero-pads single-digit days, hours and minutes', () => {
    expect(formatDocUpdatedAt('2026-01-05')).toBe('05 Jan 2026');
    expect(formatDocUpdatedAt('2026-01-05T03:07:00Z')).toBe('05 Jan 2026 · 03:07 UTC');
  });

  it('formats in UTC regardless of the runtime timezone', () => {
    // Midnight UTC is a common tripwire — a naive `new Date('2026-08-21')` in
    // a west-of-UTC zone would report the previous day. UTC parsing is the
    // whole point; assert both branches.
    expect(formatDocUpdatedAt('2026-08-21')).toBe('21 Aug 2026');
    expect(formatDocUpdatedAt('2026-08-21T00:00:00Z')).toBe('21 Aug 2026 · 00:00 UTC');
  });

  it('returns empty string for an empty input rather than "Invalid Date"', () => {
    expect(formatDocUpdatedAt('')).toBe('');
  });

  it('returns the raw string for an unparseable input, so a bad entry is visible', () => {
    expect(formatDocUpdatedAt('not-a-date')).toBe('not-a-date');
  });
});
