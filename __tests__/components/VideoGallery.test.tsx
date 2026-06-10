/**
 * Tests for VideoGallery — card metadata, YouTube outbound link, empty state.
 *
 * NOTE: this is a client component that uses `next/image` and the global
 * `gtag` hook (via trackYouTubeOpen). next/image renders an <img> in jsdom;
 * gtag is mocked here so click handlers don't blow up.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { VideoGallery } from '@/components/VideoGallery';
import type { ChannelVideo } from '@/lib/youtube-feed';

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as Record<string, string>)} />;
  },
}));

beforeEach(() => {
  // gtag is read by trackYouTubeOpen via window.gtag; stub it so click
  // handlers in TrackedYouTubeOpen don't throw.
  (window as unknown as { gtag?: () => void }).gtag = jest.fn();
});

const videoFactory = (overrides: Partial<ChannelVideo> = {}): ChannelVideo => ({
  id: 'gfywsN483lI',
  title: 'அந்தி மேகமே',
  description: 'ஒரு அழகான தமிழ் பாடல் — இராஜேஸ்வரன்.',
  publishedAt: '2026-05-27T10:00:00+00:00',
  thumbnail: 'https://i.ytimg.com/vi/gfywsN483lI/hqdefault.jpg',
  watchUrl: 'https://www.youtube.com/watch?v=gfywsN483lI',
  ...overrides,
});

describe('VideoGallery — empty state', () => {
  it('renders the Tamil "coming soon" message + YouTube channel fallback link', () => {
    render(<VideoGallery videos={[]} />);
    expect(screen.getByText(/விரைவில்/)).toBeInTheDocument();
    const channelLink = screen.getByText(/YouTube சேனலுக்கு/);
    expect(channelLink).toBeInTheDocument();
    expect(channelLink.closest('a')?.getAttribute('href')).toMatch(/youtube\.com\/channel\//);
  });
});

describe('VideoGallery — populated state', () => {
  it('renders one card per video with title + description excerpt', () => {
    const videos = [
      videoFactory(),
      videoFactory({ id: 'bPHAQzOhGc8', title: 'அக்கம் பக்கம்', description: '' }),
    ];
    render(<VideoGallery videos={videos} />);

    expect(screen.getByText('அந்தி மேகமே')).toBeInTheDocument();
    expect(screen.getByText('அக்கம் பக்கம்')).toBeInTheDocument();

    // First card has a description; second does not (empty string → block hidden)
    expect(screen.getByText(/ஒரு அழகான தமிழ் பாடல்/)).toBeInTheDocument();
  });

  it('truncates long descriptions to ~140 chars with an ellipsis', () => {
    const long = 'ஒரு '.repeat(80); // ~320 chars
    render(<VideoGallery videos={[videoFactory({ description: long })]} />);
    const node = screen.getByText(/ஒரு/);
    const text = node.textContent ?? '';
    expect(text.length).toBeLessThanOrEqual(141);
    expect(text.endsWith('…')).toBe(true);
  });

  it('renders a tracked YouTube link per card pointing at watchUrl', () => {
    render(<VideoGallery videos={[videoFactory()]} />);
    const ytLink = screen.getByLabelText(/Watch அந்தி மேகமே on YouTube/);
    expect(ytLink.getAttribute('href')).toBe('https://www.youtube.com/watch?v=gfywsN483lI');
    expect(ytLink.getAttribute('target')).toBe('_blank');
    expect(ytLink.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders the play overlay (button) for unactivated cards', () => {
    render(<VideoGallery videos={[videoFactory()]} />);
    expect(screen.getByLabelText('Play: அந்தி மேகமே')).toBeInTheDocument();
  });

  it('moves focus to the embed wrapper and announces now-playing on play (a11y)', () => {
    render(<VideoGallery videos={[videoFactory()]} />);
    fireEvent.click(screen.getByLabelText('Play: அந்தி மேகமே'));

    // Focus moved off the (now-removed) button onto the embed wrapper.
    const wrapper = screen.getByLabelText('Now playing: அந்தி மேகமே');
    expect(wrapper).toHaveFocus();
    expect(wrapper).toHaveAttribute('tabindex', '-1');

    // The polite live region announces the change for screen readers.
    const live = screen.getByText('Now playing: அந்தி மேகமே');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('gives the secondary YouTube link a ≥44px touch target', () => {
    render(<VideoGallery videos={[videoFactory()]} />);
    expect(screen.getByLabelText(/Watch அந்தி மேகமே on YouTube/)).toHaveClass('min-h-[44px]');
  });
});
