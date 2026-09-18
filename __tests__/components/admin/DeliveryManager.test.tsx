/** @jest-environment jsdom */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { DeliveryManager } from '@/components/admin/DeliveryManager';

const mockedFetch = adminFetch as jest.Mock;
const json = (b: unknown, s = 200) => ({ ok: s < 400, status: s, json: async () => b }) as unknown as Response;
const TOKEN = 'e'.repeat(43);

beforeEach(() => { jest.clearAllMocks(); mockedFetch.mockReset(); });

it('lists existing deliveries with their usage', async () => {
  mockedFetch.mockResolvedValueOnce(json({ success: true, deliveries: [
    { token: TOKEN, filename: 'Song.mp3', label: 'Anton — karaoke', downloadCount: 1,
      maxDownloads: 3, expiresAt: '2026-09-21T00:00:00.000Z', revokedAt: null },
  ] }));
  render(<DeliveryManager />);
  expect(await screen.findByText('Anton — karaoke')).toBeInTheDocument();
  expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();
});

it('creates a link and shows the URL for copying', async () => {
  mockedFetch.mockResolvedValueOnce(json({ success: true, deliveries: [] }));
  render(<DeliveryManager />);
  await screen.findByText(/No delivery links/i);

  await act(async () => {
    fireEvent.change(screen.getByLabelText(/S3 key/i), { target: { value: 'deliveries/a.mp3' } });
    fireEvent.change(screen.getByLabelText(/Filename/i), { target: { value: 'a.mp3' } });
    fireEvent.change(screen.getByLabelText(/Label/i), { target: { value: 'Buyer' } });
  });

  mockedFetch.mockResolvedValueOnce(json({ success: true, url: `https://tamilagaval.com/d/${TOKEN}`, delivery: {} }, 201));
  mockedFetch.mockResolvedValueOnce(json({ success: true, deliveries: [] }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create link/i })); });

  await waitFor(() => expect(screen.getByDisplayValue(`https://tamilagaval.com/d/${TOKEN}`)).toBeInTheDocument());

  expect(mockedFetch).toHaveBeenCalledWith('/api/admin/deliveries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'Buyer' }),
  });
  // Real refresh assertion: the list GET fires once on mount and again after create.
  const getCalls = mockedFetch.mock.calls.filter(([url, init]) => url === '/api/admin/deliveries' && init === undefined);
  expect(getCalls).toHaveLength(2);
});

it('surfaces a rejected key instead of failing silently', async () => {
  mockedFetch.mockResolvedValueOnce(json({ success: true, deliveries: [] }));
  render(<DeliveryManager />);
  await screen.findByText(/No delivery links/i);

  await act(async () => {
    fireEvent.change(screen.getByLabelText(/S3 key/i), { target: { value: 'audio/x.mp3' } });
    fireEvent.change(screen.getByLabelText(/Filename/i), { target: { value: 'a.mp3' } });
    fireEvent.change(screen.getByLabelText(/Label/i), { target: { value: 'B' } });
  });
  mockedFetch.mockResolvedValueOnce(json({ success: false, error: 'Key must be under deliveries/' }, 400));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create link/i })); });

  expect(await screen.findByRole('alert')).toHaveTextContent(/deliveries\//);
});

it('revokes a link and refreshes the list', async () => {
  mockedFetch.mockResolvedValueOnce(json({ success: true, deliveries: [
    { token: TOKEN, filename: 'Song.mp3', label: 'Anton — karaoke', downloadCount: 1,
      maxDownloads: 3, expiresAt: '2026-09-21T00:00:00.000Z', revokedAt: null },
  ] }));
  render(<DeliveryManager />);
  await screen.findByText('Anton — karaoke');

  mockedFetch.mockResolvedValueOnce(json({ success: true }));
  mockedFetch.mockResolvedValueOnce(json({ success: true, deliveries: [
    { token: TOKEN, filename: 'Song.mp3', label: 'Anton — karaoke', downloadCount: 1,
      maxDownloads: 3, expiresAt: '2026-09-21T00:00:00.000Z', revokedAt: '2026-09-15T00:00:00.000Z' },
  ] }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Revoke/i })); });

  expect(mockedFetch).toHaveBeenCalledWith(`/api/admin/deliveries/${TOKEN}/revoke`, { method: 'POST' });
  expect(await screen.findByText('revoked')).toBeInTheDocument();
  const getCalls = mockedFetch.mock.calls.filter(([url, init]) => url === '/api/admin/deliveries' && init === undefined);
  expect(getCalls).toHaveLength(2);
});

it('surfaces a failed revoke instead of pretending the link is dead', async () => {
  mockedFetch.mockResolvedValueOnce(json({ success: true, deliveries: [
    { token: TOKEN, filename: 'Song.mp3', label: 'Anton — karaoke', downloadCount: 1,
      maxDownloads: 3, expiresAt: '2026-09-21T00:00:00.000Z', revokedAt: null },
  ] }));
  render(<DeliveryManager />);
  await screen.findByText('Anton — karaoke');

  mockedFetch.mockResolvedValueOnce(json({ success: false, error: 'Session expired' }, 401));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Revoke/i })); });

  expect(await screen.findByRole('alert')).toHaveTextContent(/Session expired/);
  expect(screen.getByRole('button', { name: /Revoke/i })).toBeInTheDocument();
});

it('shows an honest error instead of hanging on Loading… when the list fetch fails', async () => {
  mockedFetch.mockRejectedValueOnce(new Error('Network error'));
  render(<DeliveryManager />);

  expect(await screen.findByRole('alert')).toHaveTextContent(/Network error/);
});

/**
 * The link used to appear once, in a box after creation — close the tab before
 * emailing it and the only way back was minting a second link.
 */
it('shows the delivery link on every active row, ready to copy', async () => {
  mockedFetch.mockResolvedValueOnce(json({
    success: true,
    deliveries: [{
      token: 'a'.repeat(43), filename: 'Song.mp3', label: 'Anton — Sevvanthi',
      downloadCount: 1, maxDownloads: 5, expiresAt: '2026-09-25T00:00:00.000Z',
      revokedAt: null, url: 'https://tamilagaval.com/d/' + 'a'.repeat(43),
    }],
  }));
  render(<DeliveryManager />);

  const field = await screen.findByLabelText(/Delivery link for Anton — Sevvanthi/i);
  expect(field).toHaveValue('https://tamilagaval.com/d/' + 'a'.repeat(43));
  expect(field).toHaveAttribute('readonly');
});

it('does not offer a link for a revoked row', async () => {
  mockedFetch.mockResolvedValueOnce(json({
    success: true,
    deliveries: [{
      token: 'b'.repeat(43), filename: 'Song.mp3', label: 'Anton — old',
      downloadCount: 1, maxDownloads: 5, expiresAt: '2026-09-25T00:00:00.000Z',
      revokedAt: '2026-09-18T00:00:00.000Z', url: 'https://tamilagaval.com/d/' + 'b'.repeat(43),
    }],
  }));
  render(<DeliveryManager />);

  expect(await screen.findByText(/revoked/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Delivery link for/i)).not.toBeInTheDocument();
});

/**
 * The S3 key is the field that gets typed wrong, and a label saying "must be
 * under deliveries/" does not show what a whole key looks like. The colour is
 * set explicitly because the browser default is near-invisible.
 */
it('shows a readable example in each field', async () => {
  mockedFetch.mockResolvedValueOnce(json({ success: true, deliveries: [] }));
  render(<DeliveryManager />);

  const key = await screen.findByLabelText(/S3 key/i);
  expect(key).toHaveAttribute('placeholder', expect.stringContaining('deliveries/'));
  expect(key.className).toContain('placeholder:text-gray-500');
  expect(key.className).toContain('dark:placeholder:text-gray-400');
});
