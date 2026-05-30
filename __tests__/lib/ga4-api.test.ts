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

  it('returns [] when env is not configured', async () => {
    delete process.env.GA4_PROPERTY_ID;
    const out = await fetchSubscribeClicksBySource();
    expect(out).toEqual([]);
    expect(runReport).not.toHaveBeenCalled();
  });

  it('maps rows into { source, eventCount } shape', async () => {
    runReport.mockResolvedValueOnce([{
      rows: [
        { dimensionValues: [{ value: 'home_hero' }], metricValues: [{ value: '42' }] },
        { dimensionValues: [{ value: 'floater' }], metricValues: [{ value: '15' }] },
      ],
    }]);

    const out = await fetchSubscribeClicksBySource(28);
    expect(out).toEqual([
      { source: 'home_hero', eventCount: 42 },
      { source: 'floater', eventCount: 15 },
    ]);
  });

  it('returns [] and logs on API failure', async () => {
    runReport.mockRejectedValueOnce(new Error('quota exceeded'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await fetchSubscribeClicksBySource();
    expect(out).toEqual([]);
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

  it('returns null when env is not configured', async () => {
    delete process.env.GA4_SERVICE_ACCOUNT_KEY;
    const out = await fetchTrafficSnapshot();
    expect(out).toBeNull();
  });

  it('parses users/sessions/pageviews from the totals row', async () => {
    runReport.mockResolvedValueOnce([{
      rows: [{ metricValues: [{ value: '500' }, { value: '750' }, { value: '1800' }] }],
    }]);

    const out = await fetchTrafficSnapshot(28);
    expect(out).toEqual({
      totalUsers: 500,
      sessions: 750,
      pageViews: 1800,
      daysBack: 28,
    });
  });

  it('returns null on API failure', async () => {
    runReport.mockRejectedValueOnce(new Error('permission denied'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await fetchTrafficSnapshot();
    expect(out).toBeNull();
  });
});
