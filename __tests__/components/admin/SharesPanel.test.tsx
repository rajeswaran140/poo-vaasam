/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SharesPanel } from '@/components/admin/SharesPanel';

const adminFetch = jest.fn();
jest.mock('@/lib/client-auth', () => ({ adminFetch: (...a: unknown[]) => adminFetch(...a) }));

// A high-reach song with a LOW share rate + a small song with a HIGH rate.
const ROWS = [
  { videoId: 'big', title: 'Big Reach Song', views: 40000, shares: 800, sharesPer1k: 20 },
  { videoId: 'viral', title: 'Share Worthy Song', views: 4000, shares: 200, sharesPer1k: 50 },
];

beforeEach(() => {
  adminFetch.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, rows: ROWS }) });
});

it('shows the not-configured notice when Analytics is off', () => {
  render(<SharesPanel ytaConfigured={false} />);
  expect(screen.getByText(/Connect YouTube Analytics/i)).toBeInTheDocument();
  expect(adminFetch).not.toHaveBeenCalled();
});

it('loads and ranks by total shares by default, then re-ranks by rate on toggle', async () => {
  render(<SharesPanel ytaConfigured />);
  // default: ranked by absolute shares → Big Reach Song (800) first
  expect(await screen.findByText('Big Reach Song')).toBeInTheDocument();
  let rowTitles = screen.getAllByText(/(Big Reach|Share Worthy) Song/).map((el) => el.textContent);
  expect(rowTitles[0]).toBe('Big Reach Song');

  // toggle to share-rate → the small, share-worthy song (50/1k) rises to #1
  await userEvent.click(screen.getByRole('button', { name: /Share rate/i }));
  await waitFor(() => {
    rowTitles = screen.getAllByText(/(Big Reach|Share Worthy) Song/).map((el) => el.textContent);
    expect(rowTitles[0]).toBe('Share Worthy Song');
  });
});
