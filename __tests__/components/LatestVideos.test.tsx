/** @jest-environment jsdom */
/**
 * LatestVideos — the home-page client island that fetches the fresh public feed,
 * drops Shorts, caps at 4, and self-hides when there's nothing to show.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { LatestVideos } from '@/components/LatestVideos';

jest.mock('@/components/SubscribeButton', () => ({
  SubscribeButton: () => <button>Subscribe</button>,
}));
jest.mock('@/components/TrackedYouTubeOpen', () => ({
  TrackedYouTubeOpen: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const long = (id: string) => ({
  id,
  title: `T-${id}`,
  thumbnail: `https://t/${id}.jpg`,
  watchUrl: `https://youtu.be/${id}`,
  duration: 'PT5M0S',
});
const short = (id: string) => ({ ...long(id), duration: 'PT45S' });
const feedResponse = (videos: unknown[]) => ({ ok: true, json: async () => ({ data: { videos } }) });

afterEach(() => jest.restoreAllMocks());

it('renders long-form videos, drops Shorts, caps at 4', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(feedResponse([long('a'), short('s1'), long('b'), long('c'), long('d'), long('e')])) as jest.Mock;

  render(<LatestVideos />);
  expect(await screen.findByRole('heading', { name: /சமீபத்திய காணொளிகள்/ })).toBeInTheDocument();

  // Exactly 4 video links (youtu.be), Shorts excluded.
  const videoLinks = screen
    .getAllByRole('link')
    .filter((a) => a.getAttribute('href')?.includes('youtu.be'));
  expect(videoLinks).toHaveLength(4);
  expect(screen.queryByText('T-s1')).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/youtube/videos');
});

it('renders nothing when the feed is empty', async () => {
  global.fetch = jest.fn().mockResolvedValue(feedResponse([])) as jest.Mock;
  const { container } = render(<LatestVideos />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it('renders nothing (no throw) when the fetch fails', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network')) as jest.Mock;
  const { container } = render(<LatestVideos />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
