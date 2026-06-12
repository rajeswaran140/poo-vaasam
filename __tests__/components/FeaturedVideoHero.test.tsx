/**
 * FeaturedVideoHero — poster facade that swaps to an autoplaying inline embed on
 * click (the click is the user gesture that makes the play a *counted* YouTube
 * view). Also exposes a persistent Watch-on-YouTube fallback link.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { FeaturedVideoHero } from '@/components/FeaturedVideoHero';
import type { ChannelVideo } from '@/lib/youtube-feed';

jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, string>)} />,
}));

beforeEach(() => {
  // trackYouTubeOpen reads window.gtag; stub it so click handlers don't throw.
  (window as unknown as { gtag?: () => void }).gtag = jest.fn();
});

const video: ChannelVideo = {
  id: 'gfywsN483lI',
  title: 'அந்தி மேகமே',
  description: 'ஒரு அழகான தமிழ் பாடல்.',
  publishedAt: '2026-05-27T10:00:00+00:00',
  thumbnail: 'https://tamil-web-media.s3.us-east-1.amazonaws.com/images/video-thumbs/gfywsN483lI.jpg',
  watchUrl: 'https://www.youtube.com/watch?v=gfywsN483lI',
};

it('shows the poster (no embed) before any interaction', () => {
  const { container } = render(<FeaturedVideoHero video={video} />);
  expect(screen.getByRole('button', { name: /Play: அந்தி மேகமே/ })).toBeInTheDocument();
  expect(screen.getByAltText('அந்தி மேகமே')).toBeInTheDocument();
  // No iframe loaded yet — performance + nothing plays unprompted.
  expect(container.querySelector('iframe')).toBeNull();
});

it('always offers a Watch-on-YouTube fallback that opens the video on YouTube', () => {
  render(<FeaturedVideoHero video={video} />);
  const link = screen.getByRole('link', { name: /YouTube/ });
  expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=gfywsN483lI');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

it('swaps the poster for an autoplaying embed when the visitor clicks play', () => {
  const { container } = render(<FeaturedVideoHero video={video} />);

  fireEvent.click(screen.getByRole('button', { name: /Play: அந்தி மேகமே/ }));

  const iframe = container.querySelector('iframe');
  expect(iframe).not.toBeNull();
  // autoplay=1 → starts on the click gesture, which is what makes it a counted view.
  expect(iframe?.getAttribute('src')).toBe(
    'https://www.youtube.com/embed/gfywsN483lI?autoplay=1&rel=0'
  );
  // Poster button is gone once playing.
  expect(screen.queryByRole('button', { name: /Play:/ })).not.toBeInTheDocument();
});
