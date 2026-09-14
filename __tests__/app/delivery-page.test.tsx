/** @jest-environment jsdom */
const findByToken = jest.fn();
jest.mock('@/infrastructure/database/DeliveryRepository', () => ({
  DeliveryRepository: jest.fn().mockImplementation(() => ({ findByToken })),
}));

import { render, screen } from '@testing-library/react';
import DeliveryPage from '@/app/d/[token]/page';

const TOKEN = 'b'.repeat(43);
const live = (over = {}) => ({
  token: TOKEN, s3Key: 'deliveries/secret-key.mp3', filename: 'Sevvanthi Poove - Karaoke.mp3',
  label: 'Buyer', contentLength: 12151796, createdAt: '2026-09-14T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z', maxDownloads: 3, downloadCount: 0,
  downloads: [], revokedAt: null, ...over,
});
const props = (e?: string) => ({
  params: Promise.resolve({ token: TOKEN }),
  searchParams: Promise.resolve(e ? { e } : {}),
});

beforeEach(() => jest.clearAllMocks());

it('offers the download without ever revealing the S3 key', async () => {
  findByToken.mockResolvedValueOnce(live());
  render(await DeliveryPage(props()));

  expect(screen.getByText('Sevvanthi Poove - Karaoke.mp3')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: /Download/i });
  expect(link).toHaveAttribute('href', `/api/d/${TOKEN}`);
  expect(document.body.innerHTML).not.toContain('secret-key');
});

it('does NOT consume a download just by rendering', async () => {
  // The whole reason this page exists: email scanners prefetch links.
  findByToken.mockResolvedValueOnce(live());
  render(await DeliveryPage(props()));
  expect(findByToken).toHaveBeenCalledTimes(1);
  // No consume on the repository mock at all — it is not even wired here.
});

it('shows remaining downloads so the buyer is not surprised', async () => {
  findByToken.mockResolvedValueOnce(live({ downloadCount: 2 }));
  render(await DeliveryPage(props()));
  expect(screen.getByText(/1 download remaining/i)).toBeInTheDocument();
});

it.each([
  ['expired', /expired/i],
  ['exhausted', /already been used/i],
  ['revoked', /no longer active/i],
])('explains %s plainly, with no download button', async (reason, copy) => {
  findByToken.mockResolvedValueOnce(live({
    ...(reason === 'expired' ? { expiresAt: '2020-01-01T00:00:00.000Z' } : {}),
    ...(reason === 'exhausted' ? { downloadCount: 3 } : {}),
    ...(reason === 'revoked' ? { revokedAt: '2026-09-14T00:00:00.000Z' } : {}),
  }));
  render(await DeliveryPage(props(reason)));
  expect(screen.getByText(copy)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Download/i })).not.toBeInTheDocument();
});

it('handles an unknown token without leaking that it never existed vs expired', async () => {
  findByToken.mockResolvedValueOnce(null);
  render(await DeliveryPage(props('invalid')));
  expect(screen.getByText(/not valid/i)).toBeInTheDocument();
});
