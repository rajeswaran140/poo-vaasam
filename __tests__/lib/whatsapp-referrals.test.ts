/** @jest-environment node */
/**
 * The WhatsApp REFERRAL COEFFICIENT — the return leg of the share loop.
 *
 * Everything else in the codebase measures the OUTBOUND half (clicks on our own
 * share buttons, or YouTube's native share button). Nothing measured whether a
 * WhatsApp share ever produced a view back. This is that number:
 *
 *     whatsappPer1k = WhatsApp-referred YouTube views per 1,000 channel views
 *
 * Measured 2026-07-14 it sat at ~12 per 1,000 (1.2%) and was flat across weeks
 * where channel views nearly tripled — i.e. WhatsApp is currently an echo of
 * reach, not an independent source of it. That flat baseline is what any
 * WhatsApp intervention has to move, so the number has to be trustworthy.
 *
 * The subtlety worth testing: YouTube reports WhatsApp under SEVERAL distinct
 * `insightTrafficSourceDetail` strings — "WhatsApp", "whatsapp.com" and
 * "WhatsApp Business" all appear in the live data. Counting only one of them
 * undercounts the coefficient by ~40%.
 */

jest.mock('@/lib/youtube-analytics', () => ({
  isYouTubeAnalyticsConfigured: jest.fn(() => true),
  fetchExternalReferrers: jest.fn(),
  fetchChannelAnalyticsSnapshot: jest.fn(),
}));

import {
  isWhatsAppSource,
  computeReferralCoefficient,
  fetchReferralCoefficient,
} from '@/lib/whatsapp-referrals';
import * as yta from '@/lib/youtube-analytics';

const mockConfigured = yta.isYouTubeAnalyticsConfigured as jest.Mock;
const mockReferrers = yta.fetchExternalReferrers as jest.Mock;
const mockSnapshot = yta.fetchChannelAnalyticsSnapshot as jest.Mock;

describe('isWhatsAppSource', () => {
  it.each(['WhatsApp', 'whatsapp.com', 'WhatsApp Business', 'WHATSAPP', 'web.whatsapp.com'])(
    'recognises %s as WhatsApp',
    (s) => expect(isWhatsAppSource(s)).toBe(true)
  );

  it.each(['facebook.com', 'Google Search', 'Facebook Messenger', 'viber.com', 'Instagram', ''])(
    'does not treat %s as WhatsApp',
    (s) => expect(isWhatsAppSource(s)).toBe(false)
  );
});

describe('computeReferralCoefficient (pure)', () => {
  // Shape mirrors the live Jun 1 – Jul 11 2026 data.
  const referrers = [
    { source: 'WhatsApp', views: 1578, estimatedMinutesWatched: 3000 },
    { source: 'whatsapp.com', views: 958, estimatedMinutesWatched: 1800 },
    { source: 'WhatsApp Business', views: 64, estimatedMinutesWatched: 120 },
    { source: 'facebook.com', views: 26, estimatedMinutesWatched: 40 },
    { source: 'Google Search', views: 20, estimatedMinutesWatched: 30 },
  ];

  it('MERGES every WhatsApp variant into one figure', () => {
    const c = computeReferralCoefficient({ windowDays: 41, channelViews: 213_046, referrers });
    expect(c.whatsappViews).toBe(1578 + 958 + 64); // 2600 — not just 1578
  });

  it('computes the coefficient as WhatsApp views per 1,000 channel views', () => {
    const c = computeReferralCoefficient({ windowDays: 41, channelViews: 213_046, referrers });
    expect(c.whatsappPer1k).toBeCloseTo(12.2, 1); // 2600 / 213046 * 1000 — the live baseline
  });

  it('counts ALL external referrers separately from the WhatsApp subset', () => {
    const c = computeReferralCoefficient({ windowDays: 41, channelViews: 213_046, referrers });
    expect(c.externalViews).toBe(2646);
    expect(c.whatsappShareOfExternal).toBeCloseTo(98.3, 1); // WhatsApp is ~all of external
  });

  it('ranks the source breakdown by views, descending', () => {
    const c = computeReferralCoefficient({ windowDays: 41, channelViews: 213_046, referrers });
    expect(c.sources.map((s) => s.source)).toEqual([
      'WhatsApp', 'whatsapp.com', 'WhatsApp Business', 'facebook.com', 'Google Search',
    ]);
    expect(c.sources[0].isWhatsApp).toBe(true);
    expect(c.sources[3].isWhatsApp).toBe(false);
  });

  it('guards divide-by-zero when the channel has no views in the window', () => {
    const c = computeReferralCoefficient({ windowDays: 7, channelViews: 0, referrers });
    expect(c.whatsappPer1k).toBe(0);
    expect(c.whatsappShareOfExternal).toBeCloseTo(98.3, 1); // still meaningful
  });

  it('handles no external referrers at all', () => {
    const c = computeReferralCoefficient({ windowDays: 7, channelViews: 5000, referrers: [] });
    expect(c).toMatchObject({
      whatsappViews: 0,
      externalViews: 0,
      whatsappPer1k: 0,
      whatsappShareOfExternal: 0,
      sources: [],
    });
  });

  it('handles external traffic that contains no WhatsApp', () => {
    const c = computeReferralCoefficient({
      windowDays: 7,
      channelViews: 5000,
      referrers: [{ source: 'facebook.com', views: 40, estimatedMinutesWatched: 10 }],
    });
    expect(c.whatsappViews).toBe(0);
    expect(c.whatsappPer1k).toBe(0);
    expect(c.externalViews).toBe(40);
    expect(c.whatsappShareOfExternal).toBe(0);
  });

  it('echoes the window so a reader cannot misread the denominator', () => {
    const c = computeReferralCoefficient({ windowDays: 28, channelViews: 100, referrers: [] });
    expect(c).toMatchObject({ windowDays: 28, channelViews: 100 });
  });
});

describe('fetchReferralCoefficient (orchestration)', () => {
  beforeEach(() => {
    mockConfigured.mockReturnValue(true);
    mockReferrers.mockReset();
    mockSnapshot.mockReset();
  });

  it('joins the EXT_URL breakdown with channel views over the SAME window', async () => {
    mockSnapshot.mockResolvedValueOnce({ ok: true, data: { views: 47_044, daysBack: 7 } });
    mockReferrers.mockResolvedValueOnce({
      ok: true,
      data: [
        { source: 'WhatsApp', views: 400, estimatedMinutesWatched: 800 },
        { source: 'whatsapp.com', views: 153, estimatedMinutesWatched: 300 },
        { source: 'facebook.com', views: 41, estimatedMinutesWatched: 20 },
      ],
    });

    const res = await fetchReferralCoefficient(7);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.whatsappViews).toBe(553);
    expect(res.data.whatsappPer1k).toBeCloseTo(11.8, 1); // matches the live Jul 6–11 read
    // Both upstream reports must use the same window or the ratio is nonsense.
    expect(mockSnapshot).toHaveBeenCalledWith(7);
    expect(mockReferrers).toHaveBeenCalledWith(7);
  });

  it('fails when the OAuth env is not configured, without calling upstream', async () => {
    mockConfigured.mockReturnValue(false);
    const res = await fetchReferralCoefficient(28);
    expect(res).toMatchObject({ ok: false });
    expect(mockReferrers).not.toHaveBeenCalled();
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it('propagates a failed channel-views fetch rather than reporting a 0 denominator', async () => {
    mockSnapshot.mockResolvedValueOnce({ ok: false, error: 'Analytics API 503' });
    mockReferrers.mockResolvedValueOnce({ ok: true, data: [] });
    const res = await fetchReferralCoefficient(28);
    expect(res).toMatchObject({ ok: false, error: 'Analytics API 503' });
  });

  it('propagates a failed referrers fetch rather than reporting a 0 coefficient', async () => {
    mockSnapshot.mockResolvedValueOnce({ ok: true, data: { views: 1000, daysBack: 28 } });
    mockReferrers.mockResolvedValueOnce({ ok: false, error: 'Analytics API 429' });
    const res = await fetchReferralCoefficient(28);
    expect(res).toMatchObject({ ok: false, error: 'Analytics API 429' });
  });
});
