/** @jest-environment node */
/**
 * Tests for src/lib/youtube-analytics.ts — env-gate, token refresh,
 * happy-path row mapping, channel snapshot mapping, error handling.
 *
 * We mock global fetch directly (no SDK) since this client is hand-rolled.
 */

import {
  fetchVideoAnalytics,
  fetchChannelAnalyticsSnapshot,
  fetchSearchTerms,
  fetchVideoDailySeries,
  dateRange,
  SEARCH_TERMS_MAX_RESULTS,
} from '@/lib/youtube-analytics';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  // Also strip the legacy YOUTUBE_REFRESH_TOKEN name in case the ambient env
  // still has it during the migration window — the runtime code no longer
  // reads it (P3.H phase 3 dropped the fallback), so leaving it set would
  // just be misleading noise.
  delete process.env.YOUTUBE_REFRESH_TOKEN;
  process.env.YOUTUBE_OAUTH_CLIENT_ID = 'test-id';
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET = 'test-secret';
  process.env.YOUTUBE_ANALYTICS_REFRESH_TOKEN = 'test-refresh';
  jest.restoreAllMocks();
  jest.resetModules();
});

afterAll(() => {
  process.env = originalEnv;
});

const tokenOk = () =>
  new Response(JSON.stringify({ access_token: 'fresh-token', expires_in: 3600 }), { status: 200 });

const reportOk = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('isYouTubeAnalyticsConfigured', () => {
  it('returns true only when all 3 env vars are set', async () => {
    delete process.env.YOUTUBE_ANALYTICS_REFRESH_TOKEN;
    // Re-import fresh to pick up env change (module-level read).
    let mod = await import('@/lib/youtube-analytics');
    expect(mod.isYouTubeAnalyticsConfigured()).toBe(false);
    process.env.YOUTUBE_ANALYTICS_REFRESH_TOKEN = 'r';
    mod = await import('@/lib/youtube-analytics');
    expect(mod.isYouTubeAnalyticsConfigured()).toBe(true);
  });

  it('ignores the deprecated YOUTUBE_REFRESH_TOKEN name (phase-3 cleanup 2026-08-21)', async () => {
    // Regression guard: the legacy fallback was intentionally dropped in P3.H
    // phase 3 so a stale developer shell (or a rollback that left the old
    // Amplify var in place) can't silently keep an app half-configured. The
    // ONLY env var the gate consults is the scope-descriptive name.
    delete process.env.YOUTUBE_ANALYTICS_REFRESH_TOKEN;
    process.env.YOUTUBE_REFRESH_TOKEN = 'legacy-only';
    jest.resetModules();
    const mod = await import('@/lib/youtube-analytics');
    expect(mod.isYouTubeAnalyticsConfigured()).toBe(false);
  });
});

describe('fetchVideoAnalytics', () => {
  it('returns ok=false when env is incomplete', async () => {
    delete process.env.YOUTUBE_ANALYTICS_REFRESH_TOKEN;
    jest.resetModules();
    const { fetchVideoAnalytics: fresh } = await import('@/lib/youtube-analytics');
    const out = await fresh(28);
    expect(out.ok).toBe(false);
  });

  it('refreshes the token, runs the report, maps rows by index', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return tokenOk();
      if (url.startsWith('https://youtubeanalytics.googleapis.com/v2/reports')) {
        return reportOk({
          rows: [
            ['vid_abc', 1200, 480, 240, 3],
            ['vid_xyz', 600, 120, 120, 1],
          ],
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const out = await fetchVideoAnalytics(28);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data).toHaveLength(2);
      expect(out.data[0]).toEqual({
        videoId: 'vid_abc',
        views: 1200,
        estimatedMinutesWatched: 480,
        averageViewDuration: 240,
        subscribersGained: 3,
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2); // token + report
  });

  it('busts the token cache on 401 + surfaces the error string', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return tokenOk();
      return new Response('unauthorised', { status: 401 });
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await fetchVideoAnalytics();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/401/);
  });
});

describe('fetchSearchTerms (real YT-search queries — viewer truth)', () => {
  it('returns ok=false when env is incomplete', async () => {
    delete process.env.YOUTUBE_ANALYTICS_REFRESH_TOKEN;
    jest.resetModules();
    const { fetchSearchTerms: fresh } = await import('@/lib/youtube-analytics');
    expect((await fresh('kOpNZHlE9FE')).ok).toBe(false);
  });

  it('scopes the report to YT_SEARCH + the video and maps term rows', async () => {
    let reportUrl = '';
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return tokenOk();
      reportUrl = url;
      return reportOk({
        rows: [
          ['tamil father grief song', 42, 300],
          ['appa ninaivu paadal', 7, 55],
        ],
      });
    });

    const out = await fetchSearchTerms('kOpNZHlE9FE', 90);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data).toHaveLength(2);
      expect(out.data[0]).toEqual({
        term: 'tamil father grief song',
        views: 42,
        estimatedMinutesWatched: 300,
      });
    }
    const decoded = decodeURIComponent(reportUrl);
    expect(decoded).toContain('dimensions=insightTrafficSourceDetail');
    expect(decoded).toContain('insightTrafficSourceType==YT_SEARCH');
    expect(decoded).toContain('video==kOpNZHlE9FE');
  });

  // Regression: the query shipped maxResults=50, which insightTrafficSourceDetail
  // rejects with a 500 (its hard cap is 25) — so EVERY search-terms call failed and
  // SEARCHSNAP never persisted a single row. Verified live 2026-07-14: 25 OK, 26 500.
  it('never asks for more than the 25-result cap insightTrafficSourceDetail enforces', async () => {
    let reportUrl = '';
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return tokenOk();
      reportUrl = url;
      return reportOk({ rows: [] });
    });

    await fetchSearchTerms(undefined, 28);

    const maxResults = Number(new URL(reportUrl).searchParams.get('maxResults'));
    expect(maxResults).toBe(SEARCH_TERMS_MAX_RESULTS);
    expect(maxResults).toBeLessThanOrEqual(25);
  });

  it('omits the video filter for a channel-wide query', async () => {
    let reportUrl = '';
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return tokenOk();
      reportUrl = url;
      return reportOk({ rows: [] });
    });
    const out = await fetchSearchTerms(undefined, 28);
    expect(out.ok).toBe(true);
    const decoded = decodeURIComponent(reportUrl);
    expect(decoded).toContain('insightTrafficSourceType==YT_SEARCH');
    expect(decoded).not.toContain('video==');
  });
});

describe('fetchVideoDailySeries (per-song daily views/subs)', () => {
  it('requires a videoId', async () => {
    expect((await fetchVideoDailySeries('')).ok).toBe(false);
  });

  it('scopes to the video with a day dimension and maps daily rows', async () => {
    let reportUrl = '';
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return tokenOk();
      reportUrl = url;
      return reportOk({
        rows: [
          ['2026-07-08', 120, 3, 400, 62.5],
          ['2026-07-09', 90, 1, 300, 58],
        ],
      });
    });

    const out = await fetchVideoDailySeries('kOpNZHlE9FE', 28);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data).toHaveLength(2);
      expect(out.data[0]).toEqual({
        date: '2026-07-08',
        views: 120,
        subscribersGained: 3,
        estimatedMinutesWatched: 400,
        averageViewPercentage: 62.5,
      });
    }
    const decoded = decodeURIComponent(reportUrl);
    expect(decoded).toContain('dimensions=day');
    expect(decoded).toContain('filters=video==kOpNZHlE9FE');
  });
});

describe('fetchChannelAnalyticsSnapshot', () => {
  it('maps the single totals row into the snapshot shape', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return tokenOk();
      return reportOk({ rows: [[5000, 1800, 180, 7, 2]] });
    });
    const out = await fetchChannelAnalyticsSnapshot(28);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data).toEqual({
        views: 5000,
        estimatedMinutesWatched: 1800,
        averageViewDuration: 180,
        subscribersGained: 7,
        subscribersLost: 2,
        daysBack: 28,
      });
    }
  });

  it('zeros out when YouTube returns no rows', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return tokenOk();
      return reportOk({});
    });
    const out = await fetchChannelAnalyticsSnapshot(7);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.views).toBe(0);
      expect(out.data.daysBack).toBe(7);
    }
  });
});

// Defined last so the token-call-count assertions above run before this test
// mints (and caches) a token on the shared module instance.
describe('dateRange', () => {
  it('returns exactly daysBack finalized days ending yesterday (today excluded)', () => {
    const { startDate, endDate } = dateRange(7);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    expect(endDate).toBe(yesterday);
    expect(endDate).not.toBe(today); // partial/non-finalized current day excluded
    const days =
      Math.round(
        (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) /
          86_400_000
      ) + 1; // inclusive
    expect(days).toBe(7);
  });
});

describe('fetchVideoAnalytics pagination', () => {
  it('pages the report via startIndex until a short page, aggregating rows', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => [`v${i + 1}`, 10, 5, 30, 1]);
    const page2 = Array.from({ length: 3 }, (_, i) => [`v${i + 51}`, 10, 5, 30, 1]);
    let reportCalls = 0;
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return tokenOk();
      if (url.startsWith('https://youtubeanalytics.googleapis.com/v2/reports')) {
        reportCalls++;
        return reportOk({ rows: url.includes('startIndex=51') ? page2 : page1 });
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const out = await fetchVideoAnalytics(28);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data).toHaveLength(53); // 50 + 3, nothing truncated
    expect(reportCalls).toBe(2); // second page was short → stopped
  });
});
