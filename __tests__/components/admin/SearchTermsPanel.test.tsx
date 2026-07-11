/** @jest-environment jsdom */
/**
 * COMPONENT TESTS — SearchTermsPanel (the /admin search-discovery panel).
 * Mocks adminFetch (Bearer auth) rather than global.fetch.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchTermsPanel } from '@/components/admin/SearchTermsPanel';
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
  render(<SearchTermsPanel videos={videos} ytaConfigured={false} />);
  expect(screen.getByText(/Connect YouTube Analytics/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Show search terms/i })).not.toBeInTheDocument();
});

it('fetches the selected video and renders the ranked search-term list', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      videoId: 'vA',
      days: 90,
      hasData: true,
      totalSearchViews: 49,
      terms: [
        { term: 'tamil father grief song', views: 42, estimatedMinutesWatched: 300 },
        { term: 'appa ninaivu paadal', views: 7, estimatedMinutesWatched: 55 },
      ],
    }),
  });

  render(<SearchTermsPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show search terms/i }));

  await waitFor(() =>
    expect(adminFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/youtube/search-terms?videoId=vA')
    )
  );
  expect(await screen.findByText('tamil father grief song')).toBeInTheDocument();
  expect(screen.getByText('appa ninaivu paadal')).toBeInTheDocument();
  expect(screen.getByText(/search-driven views/i)).toBeInTheDocument();
});

it('renders the honest empty state when no search views yet', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, videoId: 'vB', days: 90, hasData: false, totalSearchViews: 0, terms: [] }),
  });

  render(<SearchTermsPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show search terms/i }));
  expect(await screen.findByText(/No search-driven views yet/i)).toBeInTheDocument();
  // The honesty caveat — empty ≠ "not ranking".
  expect(screen.getByText(/personalized app rank can be #1/i)).toBeInTheDocument();
});

it('surfaces an error when the request fails', async () => {
  adminFetchMock.mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => ({ success: false, error: 'Analytics API 500: boom' }),
  });

  render(<SearchTermsPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show search terms/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/boom/);
});

it('labels Shorts in the picker', () => {
  render(<SearchTermsPanel videos={videos} ytaConfigured />);
  expect(screen.getByRole('option', { name: /Song B · Short/ })).toBeInTheDocument();
});
