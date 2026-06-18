/** @jest-environment node */
/** Music-composition config — samples populated, WhatsApp gating, link format. */

import { MUSIC, hasMusicSamples, hasWhatsApp, whatsappLink } from '@/config/music';

describe('music config', () => {
  it('ships verified full-song sample URLs', () => {
    expect(hasMusicSamples()).toBe(true);
    expect(MUSIC.sampleVideoUrls.length).toBeGreaterThanOrEqual(3);
    for (const url of MUSIC.sampleVideoUrls) {
      expect(url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/);
    }
  });

  it('hides WhatsApp until a real number is set', () => {
    expect(hasWhatsApp()).toBe(false); // number unset by default
  });

  it('builds a wa.me link with url-encoded text', () => {
    const link = whatsappLink('hi there');
    expect(link.startsWith('https://wa.me/')).toBe(true);
    expect(link).toContain('text=hi%20there');
  });
});
