/**
 * Tests for site config helpers (channel ID validation + subscribe URL).
 */

import {
  isValidYouTubeChannelId,
  isYouTubeVideosConfigured,
  youtubeSubscribeUrl,
  isContentSectionLive,
  liveContentSections,
  isFacebookConfigured,
  isInstagramConfigured,
  isWhatsAppConfigured,
  socialProfileUrls,
  SITE,
} from '@/config/site';

describe('isValidYouTubeChannelId', () => {
  it('accepts a well-formed channel ID (UC + 22 chars)', () => {
    expect(isValidYouTubeChannelId('UC' + 'a'.repeat(22))).toBe(true);
    expect(isValidYouTubeChannelId('UCq-Fj5jknLsUf-MWSy4_brA')).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isValidYouTubeChannelId('')).toBe(false);
    expect(isValidYouTubeChannelId('UCtooshort')).toBe(false);
    expect(isValidYouTubeChannelId('XX' + 'a'.repeat(22))).toBe(false);
    expect(isValidYouTubeChannelId('@SomeHandle')).toBe(false);
  });
});

describe('isYouTubeVideosConfigured', () => {
  it('reflects whether SITE.youtube.channelId is a valid ID', () => {
    expect(isYouTubeVideosConfigured()).toBe(isValidYouTubeChannelId(SITE.youtube.channelId));
  });
});

describe('youtubeSubscribeUrl', () => {
  it('appends the subscribe-confirmation param to the channel URL', () => {
    expect(youtubeSubscribeUrl()).toBe(`${SITE.youtube.channelUrl}?sub_confirmation=1`);
  });
});

describe('social profiles', () => {
  it('detects a configured Facebook URL and an unset Instagram URL', () => {
    expect(isFacebookConfigured()).toBe(/facebook\.com\//.test(SITE.facebook.url));
    // Instagram is intentionally empty until the Business account exists.
    expect(isInstagramConfigured()).toBe(/instagram\.com\//.test(SITE.instagram.url));
  });

  it('gates WhatsApp on a real channel link (hidden until Raj creates it)', () => {
    // Empty by default → hidden site-wide.
    expect(isWhatsAppConfigured()).toBe(/whatsapp\.com\/channel\//.test(SITE.whatsapp.url));
    // Only a proper channel link counts — a bare number / wa.me does not.
    expect(/whatsapp\.com\/channel\//.test('https://whatsapp.com/channel/ABC123')).toBe(true);
    expect(/whatsapp\.com\/channel\//.test('https://wa.me/15551234567')).toBe(false);
  });

  it('socialProfileUrls() lists only configured profiles (for JSON-LD sameAs)', () => {
    const urls = socialProfileUrls();
    expect(urls).toContain(SITE.youtube.channelUrl);
    if (isFacebookConfigured()) expect(urls).toContain(SITE.facebook.url);
    // No instagram.com entry while Instagram is unconfigured.
    expect(urls.some((u) => /instagram\.com\//.test(u))).toBe(isInstagramConfigured());
    // No empty strings leak in.
    expect(urls.every((u) => u.length > 0)).toBe(true);
  });
});

describe('isContentSectionLive', () => {
  it('is true for live sections (songs, poems) so they stay indexable', () => {
    expect(isContentSectionLive('SONGS')).toBe(true);
    expect(isContentSectionLive('POEMS')).toBe(true);
  });

  it('is false for still-empty sections (lyrics, stories, essays) → noindex', () => {
    expect(isContentSectionLive('LYRICS')).toBe(false);
    expect(isContentSectionLive('STORIES')).toBe(false);
    expect(isContentSectionLive('ESSAYS')).toBe(false);
  });

  it('is false for an unknown type', () => {
    expect(isContentSectionLive('NOPE')).toBe(false);
  });

  it('agrees with liveContentSections()', () => {
    const liveTypes = liveContentSections().map((s) => s.type);
    for (const t of ['SONGS', 'POEMS', 'LYRICS', 'STORIES', 'ESSAYS']) {
      expect(isContentSectionLive(t)).toBe(liveTypes.includes(t as typeof liveTypes[number]));
    }
  });
});
