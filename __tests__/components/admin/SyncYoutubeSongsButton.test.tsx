/** @jest-environment jsdom */
/**
 * Admin "Sync songs from YouTube" panel — scan (dry-run) lists missing songs,
 * ticking drives the create count, and Create posts the selected ids.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SyncYoutubeSongsButton } from '@/components/admin/SyncYoutubeSongsButton';
import { adminFetch } from '@/lib/client-auth';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/lib/toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const mockedFetch = adminFetch as jest.Mock;
const missing = [
  { id: 'aaaaaaaaaaa', title: 'Song A', watchUrl: 'x' },
  { id: 'bbbbbbbbbbb', title: 'Song B', watchUrl: 'y' },
];

beforeEach(() => jest.clearAllMocks());

it('scans, lists the missing songs, and creates the selected ones', async () => {
  mockedFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, dryRun: true, missing }) });

  render(<SyncYoutubeSongsButton />);
  fireEvent.click(screen.getByRole('button', { name: /Sync songs from YouTube/i }));

  expect(await screen.findByText('Song A')).toBeInTheDocument();
  expect(screen.getByText('Song B')).toBeInTheDocument();

  // Both selected by default → the create button offers 2.
  const createBtn = await screen.findByRole('button', { name: /Create 2 pages/i });

  mockedFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      success: true,
      dryRun: false,
      created: [
        { id: 'cnt1', videoId: 'aaaaaaaaaaa', title: 'Song A' },
        { id: 'cnt2', videoId: 'bbbbbbbbbbb', title: 'Song B' },
      ],
      failed: [],
      needsRedeploy: true,
    }),
  });
  fireEvent.click(createBtn);

  await waitFor(() =>
    expect(mockedFetch).toHaveBeenLastCalledWith(
      '/api/admin/content/sync-youtube-songs',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"dryRun":false') })
    )
  );
  // The created songs drop out of the list.
  await waitFor(() => expect(screen.queryByText('Song A')).not.toBeInTheDocument());
});

it('unchecking a song lowers the create count', async () => {
  mockedFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, missing }) });

  render(<SyncYoutubeSongsButton />);
  fireEvent.click(screen.getByRole('button', { name: /Sync songs from YouTube/i }));
  await screen.findByText('Song A');

  fireEvent.click(screen.getAllByRole('checkbox')[0]); // uncheck the first
  expect(screen.getByRole('button', { name: /Create 1 page/i })).toBeInTheDocument();
});

it('surfaces a scan error via toast', async () => {
  const showToast = jest.requireMock('@/lib/toast').default;
  mockedFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ success: false, error: 'YouTube channel not configured' }) });

  render(<SyncYoutubeSongsButton />);
  fireEvent.click(screen.getByRole('button', { name: /Sync songs from YouTube/i }));

  await waitFor(() => expect(showToast.error).toHaveBeenCalledWith('YouTube channel not configured'));
});
