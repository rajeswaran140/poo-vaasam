/**
 * Tests for SongList — the per-row YouTube link added by the /songs audit fix
 * (renders only when youtubeVideoId is set, points at the watch URL, fires
 * the tracked youtube_open event) plus the always-on lyrics link.
 */

import { render, screen } from '@testing-library/react';
import { SongList, type SongRow } from '@/components/music/SongList';
import { MusicPlayerProvider } from '@/components/music/MusicPlayerProvider';
import { isAudioPlaybackEnabled } from '@/config/features';

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as Record<string, string>)} />;
  },
}));

// Control the on-site-playback flag per test.
jest.mock('@/config/features', () => ({
  ...jest.requireActual('@/config/features'),
  isAudioPlaybackEnabled: jest.fn(() => false),
}));
const mockPlayback = isAudioPlaybackEnabled as jest.Mock;

beforeEach(() => {
  (window as unknown as { gtag?: () => void }).gtag = jest.fn();
  mockPlayback.mockReturnValue(false); // default: on-site playback OFF (funnel to YouTube)
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

describe('SongList — playback funnel (AUDIO_PLAYBACK off)', () => {
  it('routes a YouTube-linked song entirely to YouTube (no redundant secondary chip)', () => {
    renderList([trackFactory({ youtubeVideoId: 'gfywsN483lI' })]);
    // The whole row is a Watch-on-YouTube link…
    const yt = screen.getByLabelText('Watch அந்தி மேகமே on YouTube');
    expect(yt.getAttribute('href')).toBe('https://www.youtube.com/watch?v=gfywsN483lI');
    // …and the separate "YouTube ↗" chip is dropped (would be a duplicate link).
    expect(screen.queryByText('YouTube ↗')).not.toBeInTheDocument();
  });

  it('keeps a song WITHOUT a YouTube link on-site playable (fallback → no dead-end)', () => {
    renderList([trackFactory({ youtubeVideoId: undefined })]);
    // No YouTube routing; the row stays a play control (a button).
    expect(screen.queryByLabelText(/Watch.*on YouTube/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /இராஜ்/ })).toBeInTheDocument();
  });

  it('when playback is ON, a YouTube song plays on-site and the YouTube chip is secondary', () => {
    mockPlayback.mockReturnValue(true);
    renderList([trackFactory({ youtubeVideoId: 'gfywsN483lI' })]);
    // Secondary cross-promo chip returns; the row itself is a play button.
    expect(screen.getByText('YouTube ↗')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /இராஜ்/ })).toBeInTheDocument();
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
