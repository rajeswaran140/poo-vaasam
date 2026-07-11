/** @jest-environment jsdom */
/**
 * COMPONENT TESTS — SongTrendPanel (per-song daily trend). Mocks adminFetch.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SongTrendPanel } from '@/components/admin/SongTrendPanel';
import { adminFetch } from '@/lib/client-auth';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const adminFetchMock = adminFetch as jest.Mock;

const videos = [
  { id: 'vA', title: 'Song A', durationSeconds: 300 },
  { id: 'vB', title: 'Song B', durationSeconds: 45 },
];

afterEach(() => jest.restoreAllMocks());
beforeEach(() => adminFetchMock.mockReset());

it('shows a config notice when Analytics is not connected', () => {
  render(<SongTrendPanel videos={videos} ytaConfigured={false} />);
  expect(screen.getByText(/Connect YouTube Analytics/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Show daily trend/i })).not.toBeInTheDocument();
});

it('fetches the selected song and renders the summary + daily bars', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      videoId: 'vA',
      days: 28,
      hasData: true,
      summary: {
        totalViews: 210,
        totalSubscribers: 4,
        totalWatchMinutes: 700,
        bestDay: { date: '2026-07-09', views: 120 },
        last7Views: 150,
        prev7Views: 60,
      },
      rows: [
        { date: '2026-07-08', views: 90, subscribersGained: 1, estimatedMinutesWatched: 300 },
        { date: '2026-07-09', views: 120, subscribersGained: 3, estimatedMinutesWatched: 400 },
      ],
    }),
  });

  render(<SongTrendPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show daily trend/i }));

  await waitFor(() =>
    expect(adminFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/youtube/video-daily?videoId=vA')
    )
  );
  // Summary totals + best day + a daily row.
  expect(await screen.findByText('210')).toBeInTheDocument(); // total views
  expect(screen.getByText(/Best day:/i)).toBeInTheDocument();
  expect(screen.getByText('2026-07-08')).toBeInTheDocument();
  // 7-vs-prior trend badge: (150-60)/60 = +150% up.
  expect(screen.getByText(/150%/)).toBeInTheDocument();
});

it('renders the empty state when hasData is false', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      videoId: 'vB',
      days: 28,
      hasData: false,
      summary: { totalViews: 0, totalSubscribers: 0, totalWatchMinutes: 0, bestDay: null, last7Views: 0, prev7Views: 0 },
      rows: [],
    }),
  });

  render(<SongTrendPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show daily trend/i }));
  expect(await screen.findByText(/No finalized daily data yet/i)).toBeInTheDocument();
});

it('surfaces an error when the request fails', async () => {
  adminFetchMock.mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => ({ success: false, error: 'Analytics API 500: boom' }),
  });

  render(<SongTrendPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show daily trend/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/boom/);
});
