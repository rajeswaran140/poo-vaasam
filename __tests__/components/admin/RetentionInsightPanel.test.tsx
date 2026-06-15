/** @jest-environment jsdom */
/**
 * UNIT/COMPONENT TESTS — RetentionInsightPanel.
 *
 * The panel calls the admin API via adminFetch (Bearer auth), so we mock that
 * module rather than global.fetch.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RetentionInsightPanel } from '@/components/admin/RetentionInsightPanel';
import { adminFetch } from '@/lib/client-auth';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const adminFetchMock = adminFetch as jest.Mock;

const videos = [
  { id: 'vA', title: 'Song A', durationSeconds: 300 },
  { id: 'vB', title: 'Song B', durationSeconds: 240 },
];
const benchmark = { id: 'vBench', title: 'Best Song' };

afterEach(() => jest.restoreAllMocks());
beforeEach(() => adminFetchMock.mockReset());

it('shows a config notice when Analytics is not connected', () => {
  render(<RetentionInsightPanel videos={videos} ytaConfigured={false} />);
  expect(screen.getByText(/Connect YouTube Analytics/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Analyse retention/i })).not.toBeInTheDocument();
});

it('analyses the selected video via Bearer-authenticated adminFetch', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      videoId: 'vA',
      hasData: true,
      benchmarkId: 'vBench',
      curve: [{ ratio: 0, watchRatio: 1 }, { ratio: 0.1, watchRatio: 0.4 }, { ratio: 1, watchRatio: 0.05 }],
      summary: { hold5pct: 0.55, hold10pct: 0.4, hold25pct: 0.22, hold50pct: 0.12, holdEnd: 0.05, hold15s: 0.55, hold30s: 0.45 },
      verdict: 'weak',
      holdAtCheckpoint: 0.4,
      benchmarkHoldAtCheckpoint: 0.73,
    }),
  });

  render(<RetentionInsightPanel videos={videos} benchmark={benchmark} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Analyse retention/i }));

  await waitFor(() =>
    expect(adminFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/youtube/retention?videoId=vA')
    )
  );
  // benchmark id threaded into the query
  expect(adminFetchMock.mock.calls[0][0]).toContain('benchmarkId=vBench');
  // verdict + a checkpoint value rendered
  expect(await screen.findByText(/Weak hook/i)).toBeInTheDocument();
  expect(screen.getByText('40%')).toBeInTheDocument(); // hold10pct
});

it('renders the new-upload empty state when hasData is false', async () => {
  adminFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, videoId: 'vA', hasData: false, benchmarkId: null, curve: [], summary: {}, verdict: 'unknown', holdAtCheckpoint: null, benchmarkHoldAtCheckpoint: null }),
  });

  render(<RetentionInsightPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Analyse retention/i }));
  expect(await screen.findByText(/Not enough data yet/i)).toBeInTheDocument();
  expect(screen.getByText(/needs ~1–3 days/i)).toBeInTheDocument();
});

it('labels Shorts in the picker and warns when a Short is selected', () => {
  const withShort = [
    { id: 'vS', title: 'Clip', durationSeconds: 45 },
    { id: 'vL', title: 'Long Song', durationSeconds: 300 },
  ];
  render(<RetentionInsightPanel videos={withShort} ytaConfigured />);
  // The Short option is labelled.
  expect(screen.getByRole('option', { name: /Clip · Short/ })).toBeInTheDocument();
  // Default selection is the first (the Short) → the long-form caveat shows.
  expect(screen.getByText(/the hook verdict is tuned for long-form/i)).toBeInTheDocument();
  // Switching to the long video hides the caveat.
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'vL' } });
  expect(screen.queryByText(/tuned for long-form/i)).not.toBeInTheDocument();
});

it('surfaces an error when the request fails', async () => {
  adminFetchMock.mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => ({ success: false, error: 'Analytics API 500: boom' }),
  });

  render(<RetentionInsightPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Analyse retention/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/boom/);
});
