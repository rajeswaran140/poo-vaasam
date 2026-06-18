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

  it('enables WhatsApp with a valid international number', () => {
    expect(hasWhatsApp()).toBe(true);
    expect(MUSIC.whatsappNumber).toMatch(/^\d{11,15}$/); // country code + number
  });

  it('builds a wa.me link to the configured number with url-encoded text', () => {
    const link = whatsappLink('hi there');
    expect(link).toBe(`https://wa.me/${MUSIC.whatsappNumber}?text=hi%20there`);
  });
});
