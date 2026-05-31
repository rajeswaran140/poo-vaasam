/** @jest-environment jsdom */
/**
 * Unit tests for ThemeSelect — the inline theme picker in /admin/songs.
 * Covers: option rendering, happy-path PATCH, default-clear path,
 * optimistic-revert on failure, and aria-live status announcements.
 */

jest.mock('@/lib/client-auth', () => ({
  adminFetch: jest.fn(),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeSelect } from '@/components/admin/ThemeSelect';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body } as unknown as Response);
const failResponse = (status: number, body: unknown) =>
  ({ ok: false, status, json: async () => body } as unknown as Response);

beforeEach(() => mockedFetch.mockReset());

it('renders all themes + a "Default" option', () => {
  render(<ThemeSelect songId="cnt_a" initialTheme="love" hasOverride={false} />);
  const select = screen.getByLabelText('Theme') as HTMLSelectElement;
  const options = Array.from(select.options).map((o) => o.value);
  expect(options).toEqual(expect.arrayContaining(['__default__', 'love', 'mother', 'nature', 'tamil', 'homeland']));
});

it('shows the orange "override active" highlight when hasOverride is true', () => {
  render(<ThemeSelect songId="cnt_a" initialTheme="mother" hasOverride={true} />);
  const select = screen.getByLabelText('Theme');
  expect(select.className).toMatch(/orange-50/);
  expect(select).toHaveAttribute('title', expect.stringMatching(/override active/i));
});

it('PATCHes the new theme and announces "Saved" via aria-live', async () => {
  mockedFetch.mockResolvedValueOnce(okResponse({ success: true }));
  render(<ThemeSelect songId="cnt_a" initialTheme="love" hasOverride={false} />);

  fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'homeland' } });

  await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
  const [url, init] = mockedFetch.mock.calls[0];
  expect(url).toBe('/api/admin/songs/cnt_a/theme');
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body)).toEqual({ theme: 'homeland' });

  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
});

it('sends empty-string theme when "Default" is picked (clears override)', async () => {
  mockedFetch.mockResolvedValueOnce(okResponse({ success: true }));
  render(<ThemeSelect songId="cnt_a" initialTheme="mother" hasOverride={true} />);

  fireEvent.change(screen.getByLabelText('Theme'), { target: { value: '__default__' } });

  await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mockedFetch.mock.calls[0][1].body)).toEqual({ theme: '' });
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Reset to default/));
});

it('reverts to the previous theme + announces the error when PATCH fails', async () => {
  mockedFetch.mockResolvedValueOnce(failResponse(500, { success: false, error: 'DB write failed' }));
  render(<ThemeSelect songId="cnt_a" initialTheme="love" hasOverride={true} />);

  const select = screen.getByLabelText('Theme') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'mother' } });

  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Save failed/));
  // Optimistic update was reverted.
  expect(select.value).toBe('love');
});
