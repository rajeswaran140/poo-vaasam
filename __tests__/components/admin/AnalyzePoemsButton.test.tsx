/** @jest-environment jsdom */
/**
 * Admin "Analyze poems" button — triggers the precompute backfill via adminFetch
 * and surfaces the result. adminFetch + toast are mocked.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnalyzePoemsButton } from '@/components/admin/AnalyzePoemsButton';
import { adminFetch } from '@/lib/client-auth';
import showToast from '@/lib/toast';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/lib/toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const mockedFetch = adminFetch as jest.Mock;

beforeEach(() => jest.clearAllMocks());

it('POSTs the backfill request and shows a result summary', async () => {
  mockedFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      candidates: 2,
      analyzed: [{ id: 'cnt_1', emotion: 'sad' }, { id: 'cnt_2', emotion: 'joyful' }],
      failed: [],
      remaining: 0,
    }),
  });

  render(<AnalyzePoemsButton />);
  fireEvent.click(screen.getByRole('button', { name: /Analyze poems/i }));

  await waitFor(() =>
    expect(mockedFetch).toHaveBeenCalledWith(
      '/api/admin/content/analyze-poems',
      expect.objectContaining({ method: 'POST' })
    )
  );

  expect(showToast.success).toHaveBeenCalledWith(expect.stringContaining('Analyzed 2 poems'));
  expect(await screen.findByRole('status')).toHaveTextContent('2 analyzed');
});

it('reports "nothing to do" when no poems need analysis', async () => {
  mockedFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, candidates: 0, analyzed: [], failed: [], remaining: 0 }),
  });

  render(<AnalyzePoemsButton />);
  fireEvent.click(screen.getByRole('button', { name: /Analyze poems/i }));

  await waitFor(() => expect(showToast.success).toHaveBeenCalledWith(expect.stringContaining('nothing to do')));
});

it('surfaces a server error via a toast', async () => {
  mockedFetch.mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({ success: false, error: 'OpenAI API key not configured' }),
  });

  render(<AnalyzePoemsButton />);
  fireEvent.click(screen.getByRole('button', { name: /Analyze poems/i }));

  await waitFor(() =>
    expect(showToast.error).toHaveBeenCalledWith('OpenAI API key not configured')
  );
});

it('disables the button while a run is in flight', async () => {
  let resolve: (v: unknown) => void = () => {};
  mockedFetch.mockReturnValue(new Promise((r) => { resolve = r; }));

  render(<AnalyzePoemsButton />);
  const btn = screen.getByRole('button', { name: /Analyze poems/i });
  fireEvent.click(btn);

  await waitFor(() => expect(btn).toBeDisabled());
  expect(btn).toHaveTextContent(/Analyzing/i);

  resolve({ ok: true, json: async () => ({ success: true, candidates: 0, analyzed: [], failed: [], remaining: 0 }) });
  await waitFor(() => expect(btn).not.toBeDisabled());
});
