/** @jest-environment jsdom */
/**
 * Preview links are shared: a picture shown on its card and on the song
 * timeline is signed once. An image that fails (an hour-old link) asks for a
 * fresh link once, not forever; a failed signing is not cached.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { Thumb, __resetPlayUrlCacheForTests } from '@/components/admin/visual-story/ui-utils';

const mockFetch = adminFetch as jest.Mock;
const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const KEY = 'audio/mastering/visual-story/vs_1/candidates/cd_1.jpg';

beforeEach(() => {
  __resetPlayUrlCacheForTests();
  mockFetch.mockReset();
  let n = 0;
  mockFetch.mockImplementation(async () => json({ success: true, url: `https://signed.example/${++n}` }));
});

it('signs a file once however many previews show it', async () => {
  render(<><Thumb s3Key={KEY} alt="card" /><Thumb s3Key={KEY} alt="timeline" /></>);
  await waitFor(() => expect(screen.getByAltText('timeline')).toHaveAttribute('src', 'https://signed.example/1'));
  expect(screen.getByAltText('card')).toHaveAttribute('src', 'https://signed.example/1');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('asks for a fresh link once when the image fails, then stops', async () => {
  render(<Thumb s3Key={KEY} alt="pic" />);
  const img = await screen.findByAltText('pic');
  fireEvent.error(img);
  await waitFor(() => expect(screen.getByAltText('pic')).toHaveAttribute('src', 'https://signed.example/2'));
  fireEvent.error(screen.getByAltText('pic'));
  await new Promise((r) => setTimeout(r, 20));
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it('does not cache a failed signing', async () => {
  mockFetch.mockResolvedValueOnce(json({ success: false }, false));
  const { unmount } = render(<Thumb s3Key={KEY} alt="pic" />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  unmount();
  render(<Thumb s3Key={KEY} alt="pic" />);
  await waitFor(() => expect(screen.getByAltText('pic')).toHaveAttribute('src', 'https://signed.example/1'));
  expect(mockFetch).toHaveBeenCalledTimes(2);
});
