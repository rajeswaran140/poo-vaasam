/**
 * Tests for site config helpers (channel ID validation + subscribe URL).
 */

import {
  isValidYouTubeChannelId,
  isYouTubeVideosConfigured,
  youtubeSubscribeUrl,
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
