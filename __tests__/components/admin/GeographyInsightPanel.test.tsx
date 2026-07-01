/** @jest-environment jsdom */
/**
 * UNIT/COMPONENT TESTS — GeographyInsightPanel.
 *
 * The panel calls the admin API via adminFetch (Bearer auth), so we mock that
 * module rather than global.fetch.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GeographyInsightPanel } from '@/components/admin/GeographyInsightPanel';
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
  render(<GeographyInsightPanel videos={videos} ytaConfigured={false} />);
  expect(screen.getByText(/Connect YouTube Analytics/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Show countries/i })).not.toBeInTheDocument();
});

it('fetches the selected video and renders the ranked country list', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      videoId: 'vA',
      days: 90,
      hasData: true,
      totalAttributedViews: 174,
      totalWatchMinutes: 453,
      countryCount: 2,
      topCountry: { country: 'IN', countryName: 'India', flag: '🇮🇳', views: 149, sharePct: 85.6, averageViewPercentage: 37.9, estimatedMinutesWatched: 379, averageViewDuration: 152 },
      rows: [
        { country: 'IN', countryName: 'India', flag: '🇮🇳', views: 149, sharePct: 85.6, averageViewPercentage: 37.9, estimatedMinutesWatched: 379, averageViewDuration: 152 },
        { country: 'CA', countryName: 'Canada', flag: '🇨🇦', views: 25, sharePct: 14.4, averageViewPercentage: 44.3, estimatedMinutesWatched: 74, averageViewDuration: 178 },
      ],
    }),
  });

  render(<GeographyInsightPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show countries/i }));

  await waitFor(() =>
    expect(adminFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/youtube/geography?videoId=vA')
    )
  );
  // Canada is unique to the row list; wait on it, then assert India shows up
  // (it appears twice — in the ranked row AND the "Top:" summary line).
  expect(await screen.findByText('Canada')).toBeInTheDocument();
  expect(screen.getAllByText('India').length).toBeGreaterThanOrEqual(1);
  // summary line shows the attributed-views total
  expect(screen.getByText(/attributed views/i)).toBeInTheDocument();
});

it('renders the empty state when hasData is false', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      videoId: 'vB',
      days: 90,
      hasData: false,
      rows: [],
      totalAttributedViews: 0,
      totalWatchMinutes: 0,
      countryCount: 0,
      topCountry: null,
    }),
  });

  render(<GeographyInsightPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show countries/i }));
  expect(await screen.findByText(/No finalized country data yet/i)).toBeInTheDocument();
});

it('clears the shown result when the selected video changes', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      videoId: 'vA',
      days: 90,
      hasData: true,
      totalAttributedViews: 10,
      totalWatchMinutes: 5,
      countryCount: 1,
      topCountry: { country: 'IN', countryName: 'India', flag: '🇮🇳', views: 10, sharePct: 100, averageViewPercentage: 30, estimatedMinutesWatched: 5, averageViewDuration: 30 },
      rows: [{ country: 'IN', countryName: 'India', flag: '🇮🇳', views: 10, sharePct: 100, averageViewPercentage: 30, estimatedMinutesWatched: 5, averageViewDuration: 30 }],
    }),
  });

  render(<GeographyInsightPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show countries/i }));
  await screen.findByText(/attributed views/i); // result shown
  // Switching the selected video must drop the stale card so it can't be read
  // under the new video's label.
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'vB' } });
  expect(screen.queryByText(/attributed views/i)).not.toBeInTheDocument();
});

it('labels Shorts in the picker', () => {
  render(<GeographyInsightPanel videos={videos} ytaConfigured />);
  expect(screen.getByRole('option', { name: /Song B · Short/ })).toBeInTheDocument();
});

it('surfaces an error when the request fails', async () => {
  adminFetchMock.mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => ({ success: false, error: 'Analytics API 500: boom' }),
  });

  render(<GeographyInsightPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show countries/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/boom/);
});
