/** @jest-environment jsdom */
/**
 * UNIT/COMPONENT TESTS — RetentionInsightPanel.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RetentionInsightPanel } from '@/components/admin/RetentionInsightPanel';

const videos = [
  { id: 'vA', title: 'Song A', durationSeconds: 300 },
  { id: 'vB', title: 'Song B', durationSeconds: 240 },
];
const benchmark = { id: 'vBench', title: 'Best Song' };

afterEach(() => jest.restoreAllMocks());

it('shows a config notice when Analytics is not connected', () => {
  render(<RetentionInsightPanel videos={videos} ytaConfigured={false} />);
  expect(screen.getByText(/Connect YouTube Analytics/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Analyse retention/i })).not.toBeInTheDocument();
});

it('analyses the selected video and renders a verdict + checkpoints', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
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
  global.fetch = fetchMock as unknown as typeof fetch;

  render(<RetentionInsightPanel videos={videos} benchmark={benchmark} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Analyse retention/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/youtube/retention?videoId=vA'),
      expect.objectContaining({ credentials: 'same-origin' })
    )
  );
  // benchmark id threaded into the query
  expect(fetchMock.mock.calls[0][0]).toContain('benchmarkId=vBench');
  // verdict + a checkpoint value rendered
  expect(await screen.findByText(/Weak hook/i)).toBeInTheDocument();
  expect(screen.getByText('40%')).toBeInTheDocument(); // hold10pct
});

it('renders the new-upload empty state when hasData is false', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, videoId: 'vA', hasData: false, benchmarkId: null, curve: [], summary: {}, verdict: 'unknown', holdAtCheckpoint: null, benchmarkHoldAtCheckpoint: null }),
  }) as unknown as typeof fetch;

  render(<RetentionInsightPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Analyse retention/i }));
  expect(await screen.findByText(/Not enough data yet/i)).toBeInTheDocument();
  expect(screen.getByText(/needs ~1–3 days/i)).toBeInTheDocument();
});

it('surfaces an error when the request fails', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => ({ success: false, error: 'Analytics API 500: boom' }),
  }) as unknown as typeof fetch;

  render(<RetentionInsightPanel videos={videos} ytaConfigured />);
  fireEvent.click(screen.getByRole('button', { name: /Analyse retention/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/boom/);
});
