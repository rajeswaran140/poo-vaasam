/** @jest-environment jsdom */
/**
 * Unit tests for src/lib/analytics-events.ts — verify that the helpers
 * call window.gtag with the right shape and no-op when gtag is missing.
 */

import { trackSubscribeClick, trackAudioPlay, trackYouTubeOpen, trackShare, trackInbound } from '@/lib/analytics-events';

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

describe('trackShare', () => {
  const original = (window as unknown as { gtag?: unknown }).gtag;
  afterEach(() => { (window as unknown as { gtag?: unknown }).gtag = original; });

  it('fires share with method + share_channel (channel only)', () => {
    const spy = jest.fn();
    (window as unknown as { gtag: unknown }).gtag = spy;
    trackShare('whatsapp');
    expect(spy).toHaveBeenCalledWith('event', 'share', { method: 'whatsapp', share_channel: 'whatsapp' });
  });

  it('adds source_song_id + status_asset_id for an attributed Status share', () => {
    const spy = jest.fn();
    (window as unknown as { gtag: unknown }).gtag = spy;
    trackShare('whatsapp_status', { songId: 'cnt_9', assetId: 'kaathoda-lolakku-short' });
    expect(spy).toHaveBeenCalledWith('event', 'share', {
      method: 'whatsapp_status',
      share_channel: 'whatsapp_status',
      source_song_id: 'cnt_9',
      status_asset_id: 'kaathoda-lolakku-short',
    });
  });

  it('no-ops when gtag is missing', () => {
    delete (window as unknown as { gtag?: unknown }).gtag;
    expect(() => trackShare('whatsapp_status', { songId: 'cnt_9' })).not.toThrow();
  });
});

/**
 * The FIRST-PARTY BEACON payload — not just the GA4 call.
 *
 * These assertions exist because the 2026-07-14 audit found `trackShare` handing
 * `songId` to GA4 and then dropping it before `beacon()`. Per-song share
 * attribution therefore never reached DynamoDB, and the only copy that had it
 * (GA4) was never read back — so "which song do people forward?" was
 * unanswerable. The old suite couldn't catch it: it only ever asserted on gtag.
 */
describe('first-party beacon payload', () => {
  const originalGtag = (window as unknown as { gtag?: unknown }).gtag;
  let sendBeacon: jest.Mock;

  // jsdom's Blob has no .text(), so read it the long way round.
  const bodyOf = (call: unknown[]): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(JSON.parse(String(reader.result)));
      reader.readAsText(call[1] as Blob);
    });

  beforeEach(() => {
    sendBeacon = jest.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
    delete (window as unknown as { gtag?: unknown }).gtag; // isolate the beacon
  });
  afterEach(() => {
    (window as unknown as { gtag?: unknown }).gtag = originalGtag;
  });

  it('posts the share to /api/events keyed by channel', async () => {
    trackShare('whatsapp');
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe('/api/events');
    expect(await bodyOf(sendBeacon.mock.calls[0])).toEqual({ type: 'share', target: 'whatsapp' });
  });

  it('carries songId through to the beacon, not just to GA4', async () => {
    trackShare('whatsapp', { songId: 'cnt_9' });
    expect(await bodyOf(sendBeacon.mock.calls[0])).toEqual({
      type: 'share',
      target: 'whatsapp',
      songId: 'cnt_9',
    });
  });

  it('carries songId on a Status share too', async () => {
    trackShare('whatsapp_status', { songId: 'cnt_9', assetId: 'kaathoda-lolakku-short' });
    expect(await bodyOf(sendBeacon.mock.calls[0])).toMatchObject({
      type: 'share',
      target: 'whatsapp_status',
      songId: 'cnt_9',
    });
  });

  it('omits songId entirely when there is none (no empty-string keys)', async () => {
    trackShare('copy');
    expect(await bodyOf(sendBeacon.mock.calls[0])).not.toHaveProperty('songId');
  });

  it('carries songId on an inbound landing', async () => {
    trackInbound('whatsapp', 'cnt_9');
    expect(await bodyOf(sendBeacon.mock.calls[0])).toEqual({
      type: 'inbound',
      target: 'whatsapp',
      songId: 'cnt_9',
    });
  });

  it('still posts an inbound landing with no song attached', async () => {
    trackInbound('whatsapp');
    expect(await bodyOf(sendBeacon.mock.calls[0])).toEqual({ type: 'inbound', target: 'whatsapp' });
  });

  it('never throws when sendBeacon is unavailable', () => {
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true });
    expect(() => trackShare('whatsapp', { songId: 'cnt_9' })).not.toThrow();
  });
});

describe('trackInbound', () => {
  const original = (window as unknown as { gtag?: unknown }).gtag;
  afterEach(() => { (window as unknown as { gtag?: unknown }).gtag = original; });

  it('fires inbound_visit with source only', () => {
    const spy = jest.fn();
    (window as unknown as { gtag: unknown }).gtag = spy;
    trackInbound('whatsapp');
    expect(spy).toHaveBeenCalledWith('event', 'inbound_visit', { source: 'whatsapp' });
  });

  it('includes source_song_id when the landing carries the shared song', () => {
    const spy = jest.fn();
    (window as unknown as { gtag: unknown }).gtag = spy;
    trackInbound('whatsapp', 'cnt_9');
    expect(spy).toHaveBeenCalledWith('event', 'inbound_visit', { source: 'whatsapp', source_song_id: 'cnt_9' });
  });
});
