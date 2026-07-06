/** @jest-environment jsdom */
/**
 * MonetizationPanel — fetches /api/admin/youtube/monetization and renders the
 * two YPP tier trackers + a gracefully-degrading revenue line. adminFetch mocked.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, waitFor } from '@testing-library/react';
import { MonetizationPanel } from '@/components/admin/MonetizationPanel';
import { adminFetch } from '@/lib/client-auth';
import { computeYppGates } from '@/lib/ypp-gates';

const mockedFetch = adminFetch as jest.Mock;

const gates = computeYppGates({
  subscribers: 710,
  watchHours365: 4899,
  netSubsPerDay: 3,
  watchHoursPerDay: 20,
});

const body = (over: Record<string, unknown> = {}) => ({
  success: true,
  configured: true,
  subscribers: 710,
  watchHours365: 4899,
  pace: { netSubsPerDay: 3, watchHoursPerDay: 20 },
  gates,
  revenue: { ok: false, error: 'Analytics API 403: insufficient scope' },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockResolvedValue({ ok: true, status: 200, json: async () => body() });
});

it('fetches on mount and renders both tier trackers', async () => {
  render(<MonetizationPanel />);
  await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/admin/youtube/monetization'));
  expect(await screen.findByText(/Tier 1/)).toBeInTheDocument();
  expect(screen.getByText(/Tier 2/)).toBeInTheDocument();
  // progressbars are accessible with aria-valuenow
  const bars = screen.getAllByRole('progressbar');
  expect(bars.length).toBeGreaterThanOrEqual(4);
  expect(bars[0]).toHaveAttribute('aria-valuenow');
});

it('shows the re-auth note when revenue lacks the monetary scope (no crash)', async () => {
  render(<MonetizationPanel />);
  expect(await screen.findByText(/Revenue needs the monetary scope/i)).toBeInTheDocument();
  expect(screen.getByText(/yt-analytics-monetary\.readonly/)).toBeInTheDocument();
});

it('shows an estimated revenue figure when the monetary scope is present', async () => {
  mockedFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body({ revenue: { ok: true, data: { estimatedRevenue: 12.34, days: 28 } } }),
  });
  render(<MonetizationPanel />);
  expect(await screen.findByText(/Estimated revenue/i)).toBeInTheDocument();
  expect(screen.getByText(/\$12\.34/)).toBeInTheDocument();
});

it('renders an ETA toward the binding subscriber target', async () => {
  render(<MonetizationPanel />);
  // Tier2 subs unmet: 290 remaining / 3 per day ≈ 97 days ≈ 14 weeks
  expect(await screen.findByText(/to 1,000 subs/)).toBeInTheDocument();
});

it('shows a connect-Analytics note and still renders subs when not configured', async () => {
  const notConfigured = computeYppGates({ subscribers: 710, watchHours365: 0, netSubsPerDay: 0, watchHoursPerDay: 0 });
  mockedFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () =>
      body({ configured: false, watchHours365: null, pace: null, gates: notConfigured }),
  });
  render(<MonetizationPanel />);
  expect(await screen.findByText(/Connect YouTube Analytics OAuth/i)).toBeInTheDocument();
  expect(screen.getByText(/Tier 1/)).toBeInTheDocument();
});

it('surfaces an error banner on a failed fetch', async () => {
  mockedFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
  render(<MonetizationPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent('boom');
});
