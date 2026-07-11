/** @jest-environment jsdom */
/**
 * COMPONENT TESTS — SongCockpit (the one-selection, at-a-glance per-song view).
 * Mocks adminFetch, routing by URL to the three per-song endpoints.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { SongCockpit } from '@/components/admin/SongCockpit';
import { adminFetch } from '@/lib/client-auth';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const adminFetchMock = adminFetch as jest.Mock;

const videos = [
  { id: 'vA', title: 'Song A', durationSeconds: 300 },
  { id: 'vB', title: 'Song B', durationSeconds: 45 },
];

const daily = {
  success: true,
  hasData: true,
  summary: { totalViews: 210, totalSubscribers: 4, totalWatchMinutes: 700, bestDay: { date: '2026-07-09', views: 120 }, last7Views: 150, prev7Views: 60 },
};
const geo = {
  success: true,
  hasData: true,
  countryCount: 2,
  rows: [
    { country: 'IN', countryName: 'India', flag: '🇮🇳', views: 100, sharePct: 80 },
    { country: 'CA', countryName: 'Canada', flag: '🇨🇦', views: 25, sharePct: 20 },
  ],
};
const search = {
  success: true,
  hasData: true,
  totalSearchViews: 49,
  terms: [{ term: 'tamil father grief song', views: 42 }, { term: 'appa song', views: 7 }],
};
const ok = (body: unknown) => ({ ok: true, json: async () => body });

afterEach(() => jest.restoreAllMocks());
beforeEach(() => adminFetchMock.mockReset());

it('shows a config notice when Analytics is not connected', () => {
  render(<SongCockpit videos={videos} ytaConfigured={false} />);
  expect(screen.getByText(/Connect YouTube Analytics/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /View song/i })).not.toBeInTheDocument();
});

it('loads all three sections for one selected song', async () => {
  adminFetchMock.mockImplementation(async (url: string) =>
    ok(url.includes('video-daily') ? daily : url.includes('geography') ? geo : search)
  );

  render(<SongCockpit videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /View song/i }));

  // Trend
  expect(await screen.findByText('210')).toBeInTheDocument();
  // Audience
  expect(screen.getByText('India')).toBeInTheDocument();
  expect(screen.getByText('Canada')).toBeInTheDocument();
  // Discovery
  expect(screen.getByText('tamil father grief song')).toBeInTheDocument();

  // Each per-song endpoint was called for the selected video.
  const urls = adminFetchMock.mock.calls.map((c) => c[0] as string);
  expect(urls.some((u) => u.includes('/video-daily?videoId=vA'))).toBe(true);
  expect(urls.some((u) => u.includes('/geography?videoId=vA'))).toBe(true);
  expect(urls.some((u) => u.includes('/search-terms?videoId=vA'))).toBe(true);
});

it('is resilient: one failing section still shows the others', async () => {
  adminFetchMock.mockImplementation(async (url: string) => {
    if (url.includes('geography')) return { ok: false, status: 502, json: async () => ({ success: false, error: 'geo boom' }) };
    return ok(url.includes('video-daily') ? daily : search);
  });

  render(<SongCockpit videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /View song/i }));

  // Geography errored...
  expect(await screen.findByText('geo boom')).toBeInTheDocument();
  // ...but trend + discovery still rendered.
  expect(screen.getByText('210')).toBeInTheDocument();
  expect(screen.getByText('tamil father grief song')).toBeInTheDocument();
});
