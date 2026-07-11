/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchScorecardPanel } from '@/components/admin/SearchScorecardPanel';
import { adminFetch } from '@/lib/client-auth';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const adminFetchMock = adminFetch as jest.Mock;

const scorecard = [
  { query: 'tamil father grief song', intent: 'english_diaspora', conversion: 'high', position: null, opportunity: 0, gap: 0.9 },
  { query: 'appa padal', intent: 'tamil_search', conversion: 'low', position: 2, opportunity: 0.17, gap: 0.1 },
];
const scorecardResp = { ok: true, json: async () => ({ success: true, label: 'Anbai', scorecard }) };

afterEach(() => jest.restoreAllMocks());
beforeEach(() => adminFetchMock.mockReset());

it('auto-loads and renders the scorecard, showing observed positions + gaps', async () => {
  adminFetchMock.mockResolvedValue(scorecardResp);
  render(<SearchScorecardPanel />);

  // 'appa padal' + 'not found' + '#2' are table-only (not form options), so
  // awaiting them proves the async scorecard table rendered.
  expect(await screen.findByText('appa padal')).toBeInTheDocument();
  expect(screen.getByText('not found')).toBeInTheDocument(); // position null
  expect(screen.getByText('#2')).toBeInTheDocument();
});

it('logs a spot-check (POSTs the observation) then reloads', async () => {
  adminFetchMock.mockImplementation(async (_url: string, opts?: { method?: string }) =>
    opts?.method === 'POST' ? { ok: true, json: async () => ({ success: true }) } : scorecardResp
  );

  render(<SearchScorecardPanel />);
  await screen.findByText('appa padal'); // initial table load complete

  fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'tamil father grief song' } });
  fireEvent.change(screen.getByLabelText('Position'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: /^Log$/i }));

  await waitFor(() => {
    const post = adminFetchMock.mock.calls.find((c) => (c[1] as { method?: string })?.method === 'POST');
    expect(post).toBeTruthy();
    const body = JSON.parse((post![1] as { body: string }).body);
    expect(body).toMatchObject({ query: 'tamil father grief song', position: 3, videoId: 'kOpNZHlE9FE' });
  });
});
