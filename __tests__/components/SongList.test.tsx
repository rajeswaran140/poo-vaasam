/**
 * Tests for SongList — the per-row YouTube link added by the /songs audit fix
 * (renders only when youtubeVideoId is set, points at the watch URL, fires
 * the tracked youtube_open event) plus the always-on lyrics link.
 */

import { render, screen } from '@testing-library/react';
import { SongList, type SongRow } from '@/components/music/SongList';
import { MusicPlayerProvider } from '@/components/music/MusicPlayerProvider';

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as Record<string, string>)} />;
  },
}));

beforeEach(() => {
  (window as unknown as { gtag?: () => void }).gtag = jest.fn();
});

const trackFactory = (overrides: Partial<SongRow> = {}): SongRow => ({
  id: 'cnt_001',
  title: 'அந்தி மேகமே',
  artist: 'இராஜ்',
  src: 'https://example.s3.amazonaws.com/anthi.mp3',
  cover: 'https://example.s3.amazonaws.com/anthi.jpg',
  duration: 365,
  addedAt: 1717200000000,
  ...overrides,
});

const renderList = (rows: SongRow[]) =>
  render(
    <MusicPlayerProvider>
      <SongList rows={rows} />
    </MusicPlayerProvider>
  );

describe('SongList — YouTube cross-promotion link', () => {
  it('renders a tracked YouTube link when youtubeVideoId is present', () => {
    renderList([trackFactory({ youtubeVideoId: 'gfywsN483lI' })]);
    const yt = screen.getByLabelText('Watch அந்தி மேகமே on YouTube');
    expect(yt.getAttribute('href')).toBe('https://www.youtube.com/watch?v=gfywsN483lI');
    expect(yt.getAttribute('target')).toBe('_blank');
    expect(yt.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('omits the YouTube link when youtubeVideoId is absent', () => {
    renderList([trackFactory({ youtubeVideoId: undefined })]);
    expect(screen.queryByLabelText(/Watch.*on YouTube/)).not.toBeInTheDocument();
  });

  it('always renders the lyrics link, regardless of youtube state', () => {
    renderList([
      trackFactory({ id: 'cnt_a', youtubeVideoId: 'gfywsN483lI' }),
      trackFactory({ id: 'cnt_b' }),
    ]);
    const lyrics = screen.getAllByLabelText(/பாடல் வரிகள்/);
    expect(lyrics).toHaveLength(2);
    expect(lyrics[0].getAttribute('href')).toBe('/content/cnt_a');
    expect(lyrics[1].getAttribute('href')).toBe('/content/cnt_b');
  });
});

describe('SongList — basic render', () => {
  it('shows title + artist per row', () => {
    renderList([trackFactory({ title: 'அந்தி மேகமே', artist: 'இராஜ்' })]);
    expect(screen.getByText('அந்தி மேகமே')).toBeInTheDocument();
    expect(screen.getByText('இராஜ்')).toBeInTheDocument();
  });

  it('renders a uniform music-note tile, not the per-song cover image', () => {
    const { container } = renderList([
      trackFactory({ cover: 'https://example.s3.amazonaws.com/anthi.jpg' }),
    ]);
    // The cover <img> is gone…
    expect(
      container.querySelector('img[src="https://example.s3.amazonaws.com/anthi.jpg"]')
    ).toBeNull();
    // …replaced by a lucide music-note SVG icon.
    expect(container.querySelector('svg.lucide-music')).toBeInTheDocument();
  });
});
