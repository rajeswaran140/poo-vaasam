import { DEFAULT_LOGO, drawLogo, isLogoKey, logoKey, logoRect, logoStyleOf } from '@/lib/video-text/logo';
import { SAFE_MARGIN } from '@/lib/video-text/draw';

const FRAME = { width: 1920, height: 1080 };

describe('logoStyleOf', () => {
  it('fills defaults: hidden, bottom right, 10% high, 80% opacity, not moved', () => {
    expect(logoStyleOf(undefined)).toEqual(DEFAULT_LOGO);
    expect(logoStyleOf({ logo: { show: true } })).toEqual({ ...DEFAULT_LOGO, show: true });
  });
  it('keeps size and opacity in range and ignores an unknown corner', () => {
    const s = logoStyleOf({ logo: { heightPct: 500, opacity: 0, corner: 'middle' as never } });
    expect(s.heightPct).toBe(100);
    expect(s.opacity).toBe(0.1);
    expect(s.corner).toBe('bottom-right');
  });
});

describe('logoRect', () => {
  const look = (over = {}) => ({ ...DEFAULT_LOGO, show: true, ...over });
  it('sits in its corner inside the safe margin, height = % of the video', () => {
    const img = { width: 400, height: 200 };
    const br = logoRect(img, FRAME, look());
    expect(br.h).toBeCloseTo(108);
    expect(br.w).toBeCloseTo(216);
    expect(br.x + br.w).toBeCloseTo(FRAME.width * (1 - SAFE_MARGIN));
    expect(br.y + br.h).toBeCloseTo(FRAME.height * (1 - SAFE_MARGIN));
    const tl = logoRect(img, FRAME, look({ corner: 'top-left' }));
    expect(tl.x).toBeCloseTo(FRAME.width * SAFE_MARGIN);
    expect(tl.y).toBeCloseTo(FRAME.height * SAFE_MARGIN);
  });
  it('adds the hand move as a share of the frame', () => {
    const a = logoRect({ width: 100, height: 100 }, FRAME, look());
    const b = logoRect({ width: 100, height: 100 }, FRAME, look({ offset: { x: -0.1, y: 0.02 } }));
    expect(b.x - a.x).toBeCloseTo(-192);
    expect(b.y - a.y).toBeCloseTo(21.6);
  });
  it('scales a very wide logo down to fit the frame, keeping its shape', () => {
    const r = logoRect({ width: 2000, height: 100 }, FRAME, look({ heightPct: 50 }));
    expect(r.w).toBeCloseTo(FRAME.width * 0.9);
    expect(r.w / r.h).toBeCloseTo(20);
  });
});

describe('drawLogo', () => {
  it('draws once at the rect with its opacity, and restores the context', () => {
    const calls: unknown[] = [];
    const ctx = {
      globalAlpha: 1,
      imageSmoothingQuality: 'low' as ImageSmoothingQuality,
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      drawImage: (...a: unknown[]) => calls.push(['draw', ctx.globalAlpha, ...a.slice(1)]),
    };
    const img = { width: 100, height: 50 } as unknown as CanvasImageSource & { width: number; height: number };
    drawLogo(ctx, img, FRAME, { ...DEFAULT_LOGO, opacity: 0.5 });
    const r = logoRect(img, FRAME, { ...DEFAULT_LOGO, opacity: 0.5 });
    expect(calls).toEqual(['save', ['draw', 0.5, r.x, r.y, r.w, r.h], 'restore']);
  });
});

describe('logo keys', () => {
  it('lives outside the 30-day video-text folder and is recognised', () => {
    const k = logoKey('image/png', 1700000000000, 'ab-12');
    expect(k).toBe('audio/mastering/video-text-logo/1700000000000_ab-12.png');
    expect(k.startsWith('audio/mastering/video-text/')).toBe(false);
    expect(isLogoKey(k)).toBe(true);
    expect(isLogoKey(logoKey('image/jpeg', 1, 'x'))).toBe(true);
    expect(isLogoKey('audio/mastering/video-text-logo/../secret.png')).toBe(false);
    expect(isLogoKey('audio/mastering/other.png')).toBe(false);
  });
});
