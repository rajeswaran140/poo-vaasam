import { isoDuration, isoDurationToSeconds } from '@/lib/iso-duration';

describe('isoDuration', () => {
  it('formats seconds as schema.org ISO-8601 (PTxMyS)', () => {
    expect(isoDuration(336)).toBe('PT5M36S'); // எங்கள் தேசம் = 5:36
    expect(isoDuration(185)).toBe('PT3M5S');
    expect(isoDuration(60)).toBe('PT1M0S');
    expect(isoDuration(59)).toBe('PT0M59S');
  });

  it('floors fractional seconds', () => {
    expect(isoDuration(125.9)).toBe('PT2M5S');
  });

  it('clamps zero / negative / non-finite to PT0M0S', () => {
    expect(isoDuration(0)).toBe('PT0M0S');
    expect(isoDuration(-10)).toBe('PT0M0S');
    expect(isoDuration(NaN)).toBe('PT0M0S');
    expect(isoDuration(Infinity)).toBe('PT0M0S');
  });
});

describe('isoDurationToSeconds', () => {
  it('parses minutes/seconds (the common song case)', () => {
    expect(isoDurationToSeconds('PT5M36S')).toBe(336);
    expect(isoDurationToSeconds('PT3M5S')).toBe(185);
    expect(isoDurationToSeconds('PT1M0S')).toBe(60);
  });

  it('parses the hour component YouTube can emit', () => {
    expect(isoDurationToSeconds('PT1H2M3S')).toBe(3723);
    expect(isoDurationToSeconds('PT1H')).toBe(3600);
  });

  it('parses seconds-only (Shorts)', () => {
    expect(isoDurationToSeconds('PT50S')).toBe(50);
  });

  it('round-trips with isoDuration', () => {
    expect(isoDurationToSeconds(isoDuration(336))).toBe(336);
    expect(isoDurationToSeconds(isoDuration(59))).toBe(59);
  });

  it('returns 0 for empty / garbage / unparseable input', () => {
    expect(isoDurationToSeconds('')).toBe(0);
    expect(isoDurationToSeconds('PT')).toBe(0);
    expect(isoDurationToSeconds('garbage')).toBe(0);
    expect(isoDurationToSeconds('P1DT2H')).toBe(0); // day component not handled → 0
    expect(isoDurationToSeconds(undefined as unknown as string)).toBe(0);
  });
});
