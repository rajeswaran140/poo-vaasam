/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TopSongMonitorPanel } from '@/components/admin/TopSongMonitorPanel';
import { adminFetch } from '@/lib/client-auth';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const adminFetchMock = adminFetch as jest.Mock;

const rows = [
  { videoId: 'a', title: 'Song A', views: 500, viewsDeltaPct: -50, avgViewDuration: 167, watchDeltaPct: 2, impressions: null, ctr: null, diagnosis: 'distribution' },
  { videoId: 'b', title: 'Song B', views: 300, viewsDeltaPct: -6, avgViewDuration: 120, watchDeltaPct: 0, impressions: 9000, ctr: 5.5, diagnosis: 'stable' },
];
const monitorResp = { ok: true, json: async () => ({ success: true, days: 7, rows }) };

afterEach(() => jest.restoreAllMocks());
beforeEach(() => adminFetchMock.mockReset());

it('gates on Analytics config', () => {
  render(<TopSongMonitorPanel ytaConfigured={false} />);
  expect(screen.getByText(/Connect YouTube Analytics/i)).toBeInTheDocument();
});

it('auto-loads the monitor and shows a per-song diagnosis', async () => {
  adminFetchMock.mockResolvedValue(monitorResp);
  render(<TopSongMonitorPanel ytaConfigured />);

  // Diagnosis badges + delta are table-only (titles also appear as <option>s).
  expect(await screen.findByText('Reduced reach')).toBeInTheDocument(); // 'distribution'
  expect(screen.getByText('Stable')).toBeInTheDocument();
  expect(screen.getByText('-50%')).toBeInTheDocument();
});

it('logs Studio impressions + CTR then reloads', async () => {
  adminFetchMock.mockImplementation(async (_url: string, opts?: { method?: string }) =>
    opts?.method === 'POST' ? { ok: true, json: async () => ({ success: true }) } : monitorResp
  );

  render(<TopSongMonitorPanel ytaConfigured />);
  await screen.findByText('Reduced reach'); // loaded

  fireEvent.change(screen.getByLabelText('Song'), { target: { value: 'a' } });
  fireEvent.change(screen.getByLabelText('Impressions'), { target: { value: '12345' } });
  fireEvent.change(screen.getByLabelText('CTR %'), { target: { value: '6.6' } });
  fireEvent.click(screen.getByRole('button', { name: /Log impressions/i }));

  await waitFor(() => {
    const post = adminFetchMock.mock.calls.find((c) => (c[1] as { method?: string })?.method === 'POST');
    expect(post).toBeTruthy();
    const body = JSON.parse((post![1] as { body: string }).body);
    expect(body).toMatchObject({ videoId: 'a', impressions: 12345, ctr: 6.6 });
  });
});
