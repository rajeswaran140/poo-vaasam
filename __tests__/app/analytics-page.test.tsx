/** @jest-environment jsdom */
/**
 * /admin/analytics page — accessibility of the day-range toggle + traffic-trend
 * chart. adminFetch is mocked and routed by URL (the page and the embedded
 * MonetizationPanel each fetch their own endpoint).
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AnalyticsPage from '@/app/(admin)/admin/analytics/page';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;

// A share carrying a songId writes BOTH `share` and `share_song`; the API
// excludes derived types from `total`/`totals` and exposes them under byType.
const events = {
  total: 14,
  totals: [
    { type: 'share', count: 10 },
    { type: 'inbound', count: 4 },
  ],
  byType: {
    share: [{ target: 'whatsapp', count: 10 }],
    inbound: [{ target: 'whatsapp', count: 4 }],
    share_song: [{ target: 'cnt_b', count: 7 }],
    inbound_song: [{ target: 'cnt_b', count: 3 }],
  },
};

const analyticsBody = {
  ga4Configured: true,
  days: 28,
  contentViews: null,
  events,
  songTitles: { cnt_b: 'நிலா' },
  ga4: {
    snapshot: { data: { totalUsers: 100, sessions: 120, pageViews: 300, daysBack: 28 } },
    timeseries: {
      data: {
        points: [
          { date: '2026-07-17', users: 10, sessions: 12, pageViews: 40 },
          { date: '2026-07-18', users: 6, sessions: 7, pageViews: 15 },
          { date: '2026-07-19', users: 9, sessions: 10, pageViews: 33 },
        ],
        daysBack: 28,
      },
    },
    topPages: { data: [] },
    sources: { data: [] },
    geo: { data: [] },
    devices: { data: [] },
    audioPlays: { data: { rows: [], total: 0 } },
    subscribeClicks: { data: { rows: [], total: 0 } },
    youtubeOpens: { data: { rows: [], total: 0 } },
  },
};

const monetizationBody = {
  success: true,
  configured: true,
  subscribers: 1000,
  watchHours365: 9383,
  pace: null,
  gates: null,
  revenue: { ok: false, error: 'not configured' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () =>
        url.includes('/api/admin/youtube/monetization') ? monetizationBody : analyticsBody,
    }),
  );
});

it('marks the active day-range button with aria-pressed, and moves it on click', async () => {
  render(<AnalyticsPage />);
  const btn28 = await screen.findByRole('button', { name: 'Show last 28 days' });
  const btn7 = screen.getByRole('button', { name: 'Show last 7 days' });
  const btn90 = screen.getByRole('button', { name: 'Show last 90 days' });

  // 28 is the default selection
  expect(btn28).toHaveAttribute('aria-pressed', 'true');
  expect(btn7).toHaveAttribute('aria-pressed', 'false');
  expect(btn90).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(btn7);
  await waitFor(() => expect(btn7).toHaveAttribute('aria-pressed', 'true'));
  expect(btn28).toHaveAttribute('aria-pressed', 'false');
  // and it re-fetched for the new range
  expect(mockedFetch).toHaveBeenCalledWith(
    '/api/admin/analytics?days=7',
    expect.objectContaining({ signal: expect.anything() })
  );
});

it('gives the traffic-trend chart a screen-reader text alternative', async () => {
  render(<AnalyticsPage />);
  const chart = await screen.findByRole('img', { name: /page views per day/i });
  // summarises the range (min 15 → max 40, latest 33) so non-visual users get the gist
  expect(chart).toHaveAttribute('aria-label', expect.stringContaining('40')); // max
  expect(chart.getAttribute('aria-label')).toMatch(/latest day 33/i);
});

// This whole block previously rendered with `events: null` in the fixture, so
// none of it was exercised — which is how the derived-type leak shipped.
describe('first-party events', () => {
  it('shows the action total from the API without re-adding derived counters', async () => {
    render(<AnalyticsPage />);
    // 10 shares + 4 inbound = 14 actions; the 7 share_song + 3 inbound_song
    // rows are the SAME actions attributed to a song, not 24 events.
    expect(await screen.findByText(/14 in last 28d/)).toBeInTheDocument();
    expect(screen.queryByText(/24 in last 28d/)).not.toBeInTheDocument();
  });

  it('labels the action cards and never renders a raw derived type name', async () => {
    render(<AnalyticsPage />);
    expect(await screen.findByText('Shares (10)')).toBeInTheDocument();
    expect(screen.getByText('Inbound visits (by source) (4)')).toBeInTheDocument();
    // The old bug rendered a card literally titled "share_song (7)".
    expect(screen.queryByText(/share_song \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/inbound_song \(/)).not.toBeInTheDocument();
  });

  it('surfaces the per-song breakdown as titles, in its own section', async () => {
    render(<AnalyticsPage />);
    expect(await screen.findByText('Most-forwarded songs')).toBeInTheDocument();
    expect(screen.getByText('Songs driving inbound visits')).toBeInTheDocument();
    // resolved via songTitles, not shown as the opaque cnt_b id
    expect(screen.getAllByText('நிலா').length).toBeGreaterThan(0);
    expect(screen.queryByText('cnt_b')).not.toBeInTheDocument();
  });

  it('hides the per-song section entirely when nothing is song-attributed', async () => {
    mockedFetch.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          url.includes('/api/admin/youtube/monetization')
            ? monetizationBody
            : { ...analyticsBody, events: { ...events, byType: { share: events.byType.share } } },
      }),
    );
    render(<AnalyticsPage />);
    await screen.findByText('Shares (10)');
    expect(screen.queryByText('Most-forwarded songs')).not.toBeInTheDocument();
  });
});

describe('range switching', () => {
  // Both requests used to resolve and the LAST one home won, so a slow 7d
  // response could overwrite 90d data and render it under the 7d label.
  it('ignores a superseded in-flight response', async () => {
    const slow28 = { ...analyticsBody, days: 28, events: { ...events, total: 28 } };
    const fast7 = { ...analyticsBody, days: 7, events: { ...events, total: 7 } };

    mockedFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/admin/youtube/monetization')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => monetizationBody });
      }
      const is28 = url.includes('days=28');
      return Promise.resolve({
        ok: true,
        status: 200,
        // The 28d body resolves LATE; by then its request has been aborted.
        json: async () => {
          if (is28) await new Promise((r) => setTimeout(r, 50));
          return init?.signal?.aborted ? Promise.reject(new Error('aborted')) : (is28 ? slow28 : fast7);
        },
      });
    });

    render(<AnalyticsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show last 7 days' }));

    await waitFor(() => expect(screen.getByText(/7 in last 7d/)).toBeInTheDocument());
    // give the superseded 28d response time to land
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.getByText(/7 in last 7d/)).toBeInTheDocument();
    expect(screen.queryByText(/28 in last 28d/)).not.toBeInTheDocument();
  });

  it('aborts the previous request when the range changes', async () => {
    render(<AnalyticsPage />);
    const btn7 = await screen.findByRole('button', { name: 'Show last 7 days' });
    const firstCall = mockedFetch.mock.calls.find((c) => String(c[0]).includes('/api/admin/analytics'));
    const firstSignal = (firstCall?.[1] as RequestInit).signal;

    fireEvent.click(btn7);
    await waitFor(() => expect(firstSignal?.aborted).toBe(true));
  });
});

describe('error states', () => {
  it('explains a 403 in admin terms instead of showing "HTTP 403"', async () => {
    mockedFetch.mockImplementation((url: string) =>
      url.includes('/api/admin/youtube/monetization')
        ? Promise.resolve({ ok: true, status: 200, json: async () => monetizationBody })
        : Promise.resolve({ ok: false, status: 403, json: async () => ({}) }),
    );
    render(<AnalyticsPage />);
    expect(await screen.findByText(/isn’t an admin on this environment/i)).toBeInTheDocument();
    expect(screen.queryByText(/HTTP 403/)).not.toBeInTheDocument();
  });

  it('tells the admin to sign in again on a 401', async () => {
    mockedFetch.mockImplementation((url: string) =>
      url.includes('/api/admin/youtube/monetization')
        ? Promise.resolve({ ok: true, status: 200, json: async () => monetizationBody })
        : Promise.resolve({ ok: false, status: 401, json: async () => ({}) }),
    );
    render(<AnalyticsPage />);
    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
  });
});
