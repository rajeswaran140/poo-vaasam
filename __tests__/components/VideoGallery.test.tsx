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

describe('VideoGallery — on-site song links (Search → site → YouTube funnel)', () => {
  const SONG_PATH = '/content/cnt_abc123';

  it('links the card title + footer to the on-site song page when a mapping exists', () => {
    render(<VideoGallery videos={[videoFactory()]} songPathById={{ gfywsN483lI: SONG_PATH }} />);

    // Title becomes an internal link to the song page (strong anchor text).
    const titleLink = screen.getByRole('link', { name: 'அந்தி மேகமே' });
    expect(titleLink).toHaveAttribute('href', SONG_PATH);

    // Footer routes to the song page instead of straight to YouTube...
    const songLink = screen.getByLabelText(/பாடல் பக்கத்திற்குச் செல்லவும்/);
    expect(songLink).toHaveAttribute('href', SONG_PATH);
    // ...and the YouTube outbound text link is replaced (the page has the CTA).
    expect(screen.queryByLabelText(/on YouTube/)).not.toBeInTheDocument();
  });

  it('falls back to the YouTube link for a video without an on-site page', () => {
    render(<VideoGallery videos={[videoFactory()]} songPathById={{ someOtherId: SONG_PATH }} />);

    expect(screen.getByLabelText(/Watch அந்தி மேகமே on YouTube/)).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=gfywsN483lI'
    );
    // Title stays plain text (not a link) when there is no on-site page.
    expect(screen.queryByRole('link', { name: 'அந்தி மேகமே' })).not.toBeInTheDocument();
  });
});

describe('VideoGallery — duration & upload-date metadata', () => {
  it('renders a YouTube-style duration badge when a duration is known', () => {
    render(<VideoGallery videos={[videoFactory({ duration: 'PT4M21S' })]} />);
    expect(screen.getByText('4:21')).toBeInTheDocument();
  });

  it('omits the duration badge when the duration is unknown', () => {
    render(<VideoGallery videos={[videoFactory({ duration: undefined })]} />);
    expect(screen.queryByText(/^\d+:\d{2}$/)).not.toBeInTheDocument();
  });

  it('shows a Tamil relative upload date using the shared `now`', () => {
    // publishedAt is 2026-05-27; pin now to exactly 3 days later.
    render(<VideoGallery videos={[videoFactory()]} now={Date.parse('2026-05-30T10:00:00Z')} />);
    expect(screen.getByText('3 நாட்கள் முன்')).toBeInTheDocument();
  });
});

describe('VideoGallery — pagination ("Load more")', () => {
  const three = () => [
    videoFactory({ id: 'aaaaaaaaaaa', title: 'One' }),
    videoFactory({ id: 'bbbbbbbbbbb', title: 'Two' }),
    videoFactory({ id: 'ccccccccccc', title: 'Three' }),
  ];

  it('renders only initialCount cards, with a "Load more (N)" button', () => {
    render(<VideoGallery videos={three()} initialCount={2} />);
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    expect(screen.queryByText('Three')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /மேலும் காண்க \(1\)/ })).toBeInTheDocument();
  });

  it('reveals the remaining cards on click, then hides the button', () => {
    render(<VideoGallery videos={three()} initialCount={2} />);
    fireEvent.click(screen.getByRole('button', { name: /மேலும் காண்க/ }));
    expect(screen.getByText('Three')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /மேலும் காண்க/ })).not.toBeInTheDocument();
  });

  it('shows no "Load more" button when the videos fit within initialCount', () => {
    render(<VideoGallery videos={[videoFactory({ title: 'Only' })]} initialCount={9} />);
    expect(screen.queryByRole('button', { name: /மேலும் காண்க/ })).not.toBeInTheDocument();
  });
});
