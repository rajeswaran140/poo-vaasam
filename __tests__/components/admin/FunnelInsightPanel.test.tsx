/** @jest-environment jsdom */
/**
 * FunnelInsightPanel — fetches the computed funnel from
 * /api/admin/youtube/funnel and renders the 5 stages, the leak callout, the
 * converter leaderboard and recommendations, with a day-window switcher.
 * adminFetch is mocked.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FunnelInsightPanel } from '@/components/admin/FunnelInsightPanel';
import { adminFetch } from '@/lib/client-auth';
import { computeFunnel, type FunnelInput } from '@/lib/youtube-funnel';

const mockedFetch = adminFetch as jest.Mock;

const INPUT: FunnelInput = {
  days: 28,
  channel: { views: 10000, watchMinutes: 30000, averageViewPercentage: 18, subscribersGained: 120, subscribersLost: 10, uniqueViewers: 8000 },
  trafficSources: [
    { source: 'RELATED_VIDEO', views: 6000, watchMinutes: 15000 },
    { source: 'PLAYLIST', views: 2500, watchMinutes: 9000 },
    { source: 'YT_SEARCH', views: 1500, watchMinutes: 1000 },
  ],
  playlist: { playlistStarts: 1000, viewsPerPlaylistStart: 2.4, averageTimeInPlaylistSeconds: 480 },
  videos: [{ videoId: 'bestSong99', views: 3000, averageViewPercentage: 40, subscribersGained: 60 }],
};

// The route returns { success, ...computeFunnel(input) }; mirror that here.
const funnelBody = () => ({ success: true, ...computeFunnel(INPUT) });

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockResolvedValue({ ok: true, status: 200, json: async () => funnelBody() });
});

it('shows a connect message when Analytics OAuth is not configured (no fetch)', () => {
  render(<FunnelInsightPanel ytaConfigured={false} />);
  expect(screen.getByText(/Connect YouTube Analytics/i)).toBeInTheDocument();
  expect(mockedFetch).not.toHaveBeenCalled();
});

it('fetches on mount and renders the five funnel stages', async () => {
  render(<FunnelInsightPanel ytaConfigured />);
  await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/admin/youtube/funnel?days=28'));
  expect(await screen.findByText('Discovered')).toBeInTheDocument();
  expect(screen.getByText('Watched')).toBeInTheDocument();
  expect(screen.getByText('Watched a 2nd song')).toBeInTheDocument();
  expect(screen.getByText('Returned')).toBeInTheDocument();
  expect(screen.getByText('Subscribed')).toBeInTheDocument();
});

it('surfaces the leak diagnosis and the best-converting song', async () => {
  render(<FunnelInsightPanel ytaConfigured />);
  // avg view % 18 < 25 floor → WATCHED (retention) is the flagged leak
  expect(await screen.findByText(/Biggest leak — WATCHED/)).toBeInTheDocument();
  expect(screen.getByText('bestSong99')).toBeInTheDocument();
});

it('re-fetches with the selected window when a day button is clicked', async () => {
  render(<FunnelInsightPanel ytaConfigured />);
  await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/admin/youtube/funnel?days=28'));
  fireEvent.click(screen.getByRole('button', { name: '90d' }));
  await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/admin/youtube/funnel?days=90'));
});

it('shows an error when the fetch fails', async () => {
  mockedFetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ success: false, error: 'Analytics API 401' }) });
  render(<FunnelInsightPanel ytaConfigured />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/401/);
});
