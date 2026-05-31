/** @jest-environment jsdom */
/**
 * Unit tests for src/lib/analytics-events.ts — verify that the helpers
 * call window.gtag with the right shape and no-op when gtag is missing.
 */

import { trackSubscribeClick, trackAudioPlay, trackYouTubeOpen } from '@/lib/analytics-events';

describe('trackSubscribeClick', () => {
  const original = (window as unknown as { gtag?: unknown }).gtag;
  afterEach(() => {
    (window as unknown as { gtag?: unknown }).gtag = original;
  });

  it('fires a subscribe_click event with source param via window.gtag', () => {
    const spy = jest.fn();
    (window as unknown as { gtag: unknown }).gtag = spy;

    trackSubscribeClick('home_hero');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('event', 'subscribe_click', { source: 'home_hero' });
  });

  it('no-ops silently when gtag is missing (script not yet loaded)', () => {
    delete (window as unknown as { gtag?: unknown }).gtag;
    expect(() => trackSubscribeClick('floater')).not.toThrow();
  });

  it('no-ops silently when gtag is not a function', () => {
    (window as unknown as { gtag?: unknown }).gtag = 'not a function';
    expect(() => trackSubscribeClick('footer')).not.toThrow();
  });
});

describe('trackAudioPlay', () => {
  const original = (window as unknown as { gtag?: unknown }).gtag;
  afterEach(() => { (window as unknown as { gtag?: unknown }).gtag = original; });

  it('fires audio_play with song_id + song_title', () => {
    const spy = jest.fn();
    (window as unknown as { gtag: unknown }).gtag = spy;

    trackAudioPlay('cnt_123', 'அந்தி மேகமே');

    expect(spy).toHaveBeenCalledWith('event', 'audio_play', {
      song_id: 'cnt_123',
      song_title: 'அந்தி மேகமே',
    });
  });

  it('no-ops when gtag is missing', () => {
    delete (window as unknown as { gtag?: unknown }).gtag;
    expect(() => trackAudioPlay('cnt_123', 'x')).not.toThrow();
  });
});

describe('trackYouTubeOpen', () => {
  const original = (window as unknown as { gtag?: unknown }).gtag;
  afterEach(() => { (window as unknown as { gtag?: unknown }).gtag = original; });

  it('fires youtube_open with destination only when source is omitted', () => {
    const spy = jest.fn();
    (window as unknown as { gtag: unknown }).gtag = spy;

    trackYouTubeOpen('channel');

    expect(spy).toHaveBeenCalledWith('event', 'youtube_open', { destination: 'channel' });
  });

  it('includes source when provided', () => {
    const spy = jest.fn();
    (window as unknown as { gtag: unknown }).gtag = spy;

    trackYouTubeOpen('video:abc123', 'home_latest_videos');

    expect(spy).toHaveBeenCalledWith('event', 'youtube_open', {
      destination: 'video:abc123',
      source: 'home_latest_videos',
    });
  });

  it('no-ops when gtag is missing', () => {
    delete (window as unknown as { gtag?: unknown }).gtag;
    expect(() => trackYouTubeOpen('channel')).not.toThrow();
  });
});
