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

const analyticsBody = {
  ga4Configured: true,
  days: 28,
  contentViews: null,
  events: null,
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
  expect(mockedFetch).toHaveBeenCalledWith('/api/admin/analytics?days=7');
});

it('gives the traffic-trend chart a screen-reader text alternative', async () => {
  render(<AnalyticsPage />);
  const chart = await screen.findByRole('img', { name: /page views per day/i });
  // summarises the range (min 15 → max 40, latest 33) so non-visual users get the gist
  expect(chart).toHaveAttribute('aria-label', expect.stringContaining('40')); // max
  expect(chart.getAttribute('aria-label')).toMatch(/latest day 33/i);
});
