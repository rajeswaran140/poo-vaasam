import { isoDuration } from '@/lib/iso-duration';

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
