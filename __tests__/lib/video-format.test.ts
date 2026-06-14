import { formatVideoDuration, relativeTimeTamil } from '@/lib/video-format';

describe('formatVideoDuration', () => {
  it('formats minutes:seconds', () => {
    expect(formatVideoDuration('PT4M21S')).toBe('4:21');
    expect(formatVideoDuration('PT45S')).toBe('0:45');
    expect(formatVideoDuration('PT2M')).toBe('2:00');
  });
  it('formats hours:minutes:seconds with zero-padding', () => {
    expect(formatVideoDuration('PT1H2M3S')).toBe('1:02:03');
    expect(formatVideoDuration('PT1H')).toBe('1:00:00');
  });
  it('returns null for missing / unparseable / zero durations', () => {
    expect(formatVideoDuration(undefined)).toBeNull();
    expect(formatVideoDuration('PT')).toBeNull();
    expect(formatVideoDuration('garbage')).toBeNull();
    expect(formatVideoDuration('PT0S')).toBeNull();
  });
});

describe('relativeTimeTamil', () => {
  const now = Date.parse('2026-06-14T12:00:00Z');
  const ago = (sec: number) => new Date(now - sec * 1000).toISOString();

  it('collapses sub-minute and future dates to இப்போது', () => {
    expect(relativeTimeTamil(ago(30), now)).toBe('இப்போது');
    expect(relativeTimeTamil(ago(-100), now)).toBe('இப்போது');
  });
  it('uses singular units at n = 1', () => {
    expect(relativeTimeTamil(ago(60), now)).toBe('1 நிமிடம் முன்');
    expect(relativeTimeTamil(ago(86_400), now)).toBe('1 நாள் முன்');
  });
  it('uses plural units for n > 1', () => {
    expect(relativeTimeTamil(ago(3 * 86_400), now)).toBe('3 நாட்கள் முன்');
    expect(relativeTimeTamil(ago(2 * 604_800), now)).toBe('2 வாரங்கள் முன்');
    expect(relativeTimeTamil(ago(5 * 2_592_000), now)).toBe('5 மாதங்கள் முன்');
  });
  it('returns empty string for an invalid date', () => {
    expect(relativeTimeTamil('not-a-date', now)).toBe('');
  });
});
