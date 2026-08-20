/** @jest-environment jsdom */
/**
 * UNIT/COMPONENT TESTS — RevenueGeographyPanel.
 *
 * The panel calls the admin API via adminFetch (Bearer auth), so we mock that
 * module rather than global.fetch.
 *
 * Beyond the shared panel contract (config gate, clear-on-change, error), the
 * cases here are about not asserting things the data doesn't say: a missing
 * channel baseline must not render as "1.00× average", and a market with
 * revenue but no attributed views must not render a fabricated RPM.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RevenueGeographyPanel } from '@/components/admin/RevenueGeographyPanel';
import { adminFetch } from '@/lib/client-auth';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const adminFetchMock = adminFetch as jest.Mock;

const videos = [
  { id: 'vA', title: 'Song A', durationSeconds: 300 },
  { id: 'vB', title: 'Song B', durationSeconds: 45 },
];

const row = (over: Record<string, unknown>) => ({
  country: 'IN',
  countryName: 'India',
  flag: '🇮🇳',
  views: 900,
  estimatedRevenue: 1,
  estimatedAdRevenue: 1,
  estimatedRedPartnerRevenue: 0,
  adImpressions: 700,
  monetizedPlaybacks: 600,
  viewSharePct: 90,
  revenueSharePct: 20,
  rpm: 1.111,
  valueIndex: 0.222,
  ...over,
});

const CANADA = row({
  country: 'CA',
  countryName: 'Canada',
  flag: '🇨🇦',
  views: 100,
  estimatedRevenue: 4,
  viewSharePct: 10,
  revenueSharePct: 80,
  rpm: 40,
  valueIndex: 8,
});

const okResult = (over: Record<string, unknown> = {}) => ({
  success: true,
  videoId: 'vA',
  days: 28,
  hasData: true,
  rows: [CANADA, row({})],
  attributedViews: 1000,
  attributedRevenue: 5,
  totalViews: 1250,
  totalRevenue: 5,
  totalAdRevenue: 5,
  totalPremiumRevenue: 0,
  totalAdImpressions: 820,
  totalMonetizedPlaybacks: 690,
  rpm: 5,
  rpmBasis: 'video-totals',
  monetizedPlaybackRate: 0.69,
  servingAds: true,
  countryCount: 2,
  topRevenueCountry: CANADA,
  rpmIndex: 11.7,
  channelRpm: 0.427,
  ...over,
});

afterEach(() => jest.restoreAllMocks());
beforeEach(() => adminFetchMock.mockReset());

it('shows a config notice when Analytics is not connected', () => {
  render(<RevenueGeographyPanel videos={videos} ytaConfigured={false} />);
  expect(screen.getByText(/Connect YouTube Analytics/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Show earnings/i })).not.toBeInTheDocument();
});

it('fetches the selected video and ranks countries by revenue', async () => {
  adminFetchMock.mockResolvedValue({ ok: true, json: async () => okResult() });

  render(<RevenueGeographyPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show earnings/i }));

  await waitFor(() =>
    expect(adminFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/youtube/revenue-geography?videoId=vA')
    )
  );
  expect(await screen.findByText('Canada')).toBeInTheDocument();
  expect(screen.getByText('India')).toBeInTheDocument();
  // Canada earns 80% of the money on 10% of the views.
  expect(screen.getByText(/\$4\.00 · 80% of revenue · 10% of views/)).toBeInTheDocument();
  expect(screen.getByText('8.00× value')).toBeInTheDocument();
  expect(screen.getByText('0.22× value')).toBeInTheDocument();
});

it('shows the song RPM indexed against the channel', async () => {
  adminFetchMock.mockResolvedValue({ ok: true, json: async () => okResult() });
  render(<RevenueGeographyPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show earnings/i }));
  expect(await screen.findByText(/11\.70× channel average/)).toBeInTheDocument();
  // The song's own RPM, three decimals — sub-cent RPMs are normal here, so two
  // would round most of this catalogue to $0.00.
  expect(screen.getByText('$5.000')).toBeInTheDocument();
  // …and the baseline it's indexed against, so the multiple is interpretable.
  expect(screen.getByText(/channel \$0\.427/)).toBeInTheDocument();
  expect(screen.getByText(/69% of views carried an ad/)).toBeInTheDocument();
});

it('says the baseline is missing rather than rendering 1.00× average', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => okResult({ rpmIndex: null, channelRpm: null }),
  });
  render(<RevenueGeographyPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show earnings/i }));
  expect(await screen.findByText(/No channel baseline available/i)).toBeInTheDocument();
  expect(screen.queryByText(/× channel average/)).not.toBeInTheDocument();
});

it('renders an em dash, not a number, for a market with revenue but no attributed views', async () => {
  const norway = row({
    country: 'NO',
    countryName: 'Norway',
    flag: '🇳🇴',
    views: 0,
    estimatedRevenue: 0.23,
    viewSharePct: 0,
    revenueSharePct: 4,
    rpm: null,
    valueIndex: null,
  });
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => okResult({ rows: [CANADA, norway] }),
  });
  render(<RevenueGeographyPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show earnings/i }));
  expect(await screen.findByText('Norway')).toBeInTheDocument();
  expect(screen.getByText('RPM —')).toBeInTheDocument();
  // No fabricated value badge for a row we can't compute one for.
  expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
});

it('warns that the rates are overstated when they fell back to the country rows', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => okResult({ rpmBasis: 'country-attributed' }),
  });
  render(<RevenueGeographyPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show earnings/i }));
  expect(await screen.findByText(/overstate both/i)).toBeInTheDocument();
});

it('shows no such warning on the corrected path', async () => {
  adminFetchMock.mockResolvedValue({ ok: true, json: async () => okResult() });
  render(<RevenueGeographyPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show earnings/i }));
  await screen.findByText('Canada');
  expect(screen.queryByText(/overstate both/i)).not.toBeInTheDocument();
});

it('flags a video that served no ads at all', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => okResult({ servingAds: false, totalAdImpressions: 0 }),
  });
  render(<RevenueGeographyPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show earnings/i }));
  expect(await screen.findByText(/consistent with monetization being off/i)).toBeInTheDocument();
});

it('does not show the ads-off note when ads are running', async () => {
  adminFetchMock.mockResolvedValue({ ok: true, json: async () => okResult() });
  render(<RevenueGeographyPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show earnings/i }));
  await screen.findByText('Canada');
  expect(screen.queryByText(/monetization being off/i)).not.toBeInTheDocument();
});

it('renders the empty state when hasData is false', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => okResult({ hasData: false, rows: [], topRevenueCountry: null }),
  });
  render(<RevenueGeographyPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show earnings/i }));
  expect(await screen.findByText(/No revenue rows yet/i)).toBeInTheDocument();
});

it('clears the shown result when the selected video changes', async () => {
  adminFetchMock.mockResolvedValue({ ok: true, json: async () => okResult() });
  render(<RevenueGeographyPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show earnings/i }));
  await screen.findByText('Canada');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'vB' } });
  expect(screen.queryByText('Canada')).not.toBeInTheDocument();
});

it('labels Shorts in the picker', () => {
  render(<RevenueGeographyPanel videos={videos} ytaConfigured />);
  expect(screen.getByRole('option', { name: /Song B · Short/ })).toBeInTheDocument();
});

it('surfaces an error when the request fails', async () => {
  adminFetchMock.mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => ({ success: false, error: 'Analytics API 403: insufficient scopes' }),
  });
  render(<RevenueGeographyPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Show earnings/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/insufficient scopes/);
});
