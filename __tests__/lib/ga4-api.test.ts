/** @jest-environment node */
/**
 * Unit tests for src/lib/ga4-api.ts — focused on the env-gate / decoding /
 * mapping logic. The BetaAnalyticsDataClient is mocked so we never reach
 * the real GA4 backend.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const runReport = jest.fn();
jest.mock('@google-analytics/data', () => ({
  BetaAnalyticsDataClient: jest.fn().mockImplementation(() => ({ runReport })),
}));

import {
  isGA4Configured,
  fetchSubscribeClicksBySource,
  fetchTrafficSnapshot,
  fetchAudioPlays,
  fetchYouTubeOpens,
} from '@/lib/ga4-api';

const validKey = Buffer.from(
  JSON.stringify({ client_email: 'sa@example.com', private_key: 'KEY' })
).toString('base64');

const originalEnv = { ...process.env };

beforeEach(() => {
  runReport.mockReset();
  jest.resetModules();
  process.env = { ...originalEnv };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('isGA4Configured', () => {
  it('returns true only when both env vars are set', () => {
    delete process.env.GA4_PROPERTY_ID;
    delete process.env.GA4_SERVICE_ACCOUNT_KEY;
    expect(isGA4Configured()).toBe(false);

    process.env.GA4_PROPERTY_ID = '123';
    expect(isGA4Configured()).toBe(false);

    process.env.GA4_SERVICE_ACCOUNT_KEY = validKey;
    expect(isGA4Configured()).toBe(true);
  });
});

describe('fetchSubscribeClicksBySource', () => {
  beforeEach(() => {
    process.env.GA4_PROPERTY_ID = '123';
    process.env.GA4_SERVICE_ACCOUNT_KEY = validKey;
  });

  it('returns { ok: false } when env is not configured', async () => {
    delete process.env.GA4_PROPERTY_ID;
    const out = await fetchSubscribeClicksBySource();
    expect(out).toEqual({ ok: false, error: expect.any(String) });
    expect(runReport).not.toHaveBeenCalled();
  });

  it('maps rows + computes total when the breakdown succeeds', async () => {
    runReport.mockResolvedValueOnce([{
      rows: [
        { dimensionValues: [{ value: 'home_hero' }], metricValues: [{ value: '42' }] },
        { dimensionValues: [{ value: 'floater' }], metricValues: [{ value: '15' }] },
      ],
    }]);

    const out = await fetchSubscribeClicksBySource(28);
    expect(out).toEqual({
      ok: true,
      data: {
        rows: [
          { source: 'home_hero', eventCount: 42 },
          { source: 'floater', eventCount: 15 },
        ],
        total: 57,
      },
    });
  });

  it('surfaces the upstream error message on hard failure', async () => {
    runReport.mockRejectedValueOnce(new Error('7 PERMISSION_DENIED: insufficient permissions'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await fetchSubscribeClicksBySource();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/PERMISSION_DENIED/);
  });

  it('falls back to total-only when customEvent:source isn\'t registered', async () => {
    // First call (with dimension) fails with INVALID_ARGUMENT.
    runReport.mockRejectedValueOnce(new Error('3 INVALID_ARGUMENT: invalid dimension customEvent:source'));
    // Second call (without dimension) succeeds with a total.
    runReport.mockResolvedValueOnce([{
      rows: [{ metricValues: [{ value: '12' }] }],
    }]);

    const out = await fetchSubscribeClicksBySource();
    expect(out).toEqual({
      ok: true,
      data: { rows: [], total: 12, note: 'dimension-not-registered' },
    });
    expect(runReport).toHaveBeenCalledTimes(2);
    // The fallback request must not carry the dimension.
    const fallbackArgs = runReport.mock.calls[1]?.[0] as any;
    expect(fallbackArgs.dimensions).toBeUndefined();
  });

  it('filters by subscribe_click event name', async () => {
    runReport.mockResolvedValueOnce([{ rows: [] }]);
    await fetchSubscribeClicksBySource();
    const callArgs = runReport.mock.calls[0]?.[0] as any;
    expect(callArgs.dimensionFilter.filter.fieldName).toBe('eventName');
    expect(callArgs.dimensionFilter.filter.stringFilter.value).toBe('subscribe_click');
  });
});

describe('fetchTrafficSnapshot', () => {
  beforeEach(() => {
    process.env.GA4_PROPERTY_ID = '123';
    process.env.GA4_SERVICE_ACCOUNT_KEY = validKey;
  });

  it('returns { ok: false } when env is not configured', async () => {
    delete process.env.GA4_SERVICE_ACCOUNT_KEY;
    const out = await fetchTrafficSnapshot();
    expect(out).toEqual({ ok: false, error: expect.any(String) });
  });

  it('parses users/sessions/pageviews from the totals row', async () => {
    runReport.mockResolvedValueOnce([{
      rows: [{ metricValues: [{ value: '500' }, { value: '750' }, { value: '1800' }] }],
    }]);

    const out = await fetchTrafficSnapshot(28);
    expect(out).toEqual({
      ok: true,
      data: { totalUsers: 500, sessions: 750, pageViews: 1800, daysBack: 28 },
    });
  });

  it('surfaces the upstream error on API failure', async () => {
    runReport.mockRejectedValueOnce(new Error('7 PERMISSION_DENIED: viewer required'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await fetchTrafficSnapshot();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/PERMISSION_DENIED/);
  });
});

describe('fetchAudioPlays', () => {
  beforeEach(() => {
    process.env.GA4_PROPERTY_ID = '123';
    process.env.GA4_SERVICE_ACCOUNT_KEY = validKey;
  });

  it('queries audio_play events broken down by song_title', async () => {
    runReport.mockResolvedValueOnce([{
      rows: [
        { dimensionValues: [{ value: 'அந்தி மேகமே' }], metricValues: [{ value: '120' }] },
        { dimensionValues: [{ value: 'என்ன மாயம்' }], metricValues: [{ value: '75' }] },
      ],
    }]);

    const out = await fetchAudioPlays(28);
    expect(out).toEqual({
      ok: true,
      data: {
        rows: [
          { label: 'அந்தி மேகமே', eventCount: 120 },
          { label: 'என்ன மாயம்', eventCount: 75 },
        ],
        total: 195,
      },
    });

    const args = runReport.mock.calls[0]?.[0] as any;
    expect(args.dimensions[0].name).toBe('customEvent:song_title');
    expect(args.dimensionFilter.filter.stringFilter.value).toBe('audio_play');
  });

  it('falls back to total-only when the song_title dimension is unregistered', async () => {
    runReport.mockRejectedValueOnce(new Error('3 INVALID_ARGUMENT: invalid dimension customEvent:song_title'));
    runReport.mockResolvedValueOnce([{ rows: [{ metricValues: [{ value: '8' }] }] }]);

    const out = await fetchAudioPlays();
    expect(out).toEqual({
      ok: true,
      data: { rows: [], total: 8, note: 'dimension-not-registered' },
    });
  });
});

describe('fetchYouTubeOpens', () => {
  beforeEach(() => {
    process.env.GA4_PROPERTY_ID = '123';
    process.env.GA4_SERVICE_ACCOUNT_KEY = validKey;
  });

  it('queries youtube_open events broken down by destination', async () => {
    runReport.mockResolvedValueOnce([{
      rows: [
        { dimensionValues: [{ value: 'video:abc123' }], metricValues: [{ value: '42' }] },
        { dimensionValues: [{ value: 'channel' }], metricValues: [{ value: '11' }] },
      ],
    }]);

    const out = await fetchYouTubeOpens(28);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.total).toBe(53);
      expect(out.data.rows).toHaveLength(2);
    }
    const args = runReport.mock.calls[0]?.[0] as any;
    expect(args.dimensions[0].name).toBe('customEvent:destination');
    expect(args.dimensionFilter.filter.stringFilter.value).toBe('youtube_open');
  });

  it('returns the hard error when neither query works', async () => {
    runReport.mockRejectedValueOnce(new Error('7 PERMISSION_DENIED: viewer required'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await fetchYouTubeOpens();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/PERMISSION_DENIED/);
  });
});
