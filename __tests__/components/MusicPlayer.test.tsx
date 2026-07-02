import { render, screen, fireEvent, within } from '@testing-library/react';
import { MusicPlayerProvider, formatTime, type Track } from '@/components/music/MusicPlayerProvider';
import { SongsPlaylist, type SongRow } from '@/components/music/SongsPlaylist';

// This suite exercises the on-site player (Play-all / shuffle / repeat), which
// only renders when on-site playback is ON — force the flag on for these tests.
jest.mock('@/config/features', () => ({
  ...jest.requireActual('@/config/features'),
  isAudioPlaybackEnabled: jest.fn(() => true),
}));

/** The hero's primary CTA carries a Tamil accessible name. */
const PLAY_ALL = 'அனைத்தையும் இயக்கு';

const STORAGE_KEY = 'tamilagaval:player:v1';

// jsdom doesn't implement media playback or the Media Session API.
beforeAll(() => {
  window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = jest.fn();
  (window as any).MediaMetadata = class {
    constructor(init: Record<string, unknown>) { Object.assign(this, init); }
  };
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: { metadata: null, playbackState: 'none', setActionHandler: jest.fn() },
  });
});
beforeEach(() => sessionStorage.clear());
afterEach(() => jest.clearAllMocks());

const renderList = (tracks: Track[]) =>
  render(
    <MusicPlayerProvider>
      <SongsPlaylist tracks={tracks} />
    </MusicPlayerProvider>
  );
const audioSrc = (c: HTMLElement) => c.querySelector('audio')?.getAttribute('src') ?? null;

const tracks: Track[] = [
  { id: 's1', title: 'பூ வாசம்', artist: 'இளையராஜா', src: 'https://s3.example/a.mp3', cover: 'https://s3.example/c.jpg', duration: 185 },
  { id: 's2', title: 'No Audio Song', artist: 'Anon', src: '' },
];
const three: Track[] = [
  { id: 'a', title: 'Track A', artist: 'x', src: 'a.mp3', duration: 60 },
  { id: 'b', title: 'Track B', artist: 'x', src: 'b.mp3', duration: 60 },
  { id: 'c', title: 'Track C', artist: 'x', src: 'c.mp3', duration: 60 },
];

describe('formatTime', () => {
  it('formats seconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(185)).toBe('3:05');
  });
  it('guards against bad input', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-10)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
  });
});

describe('SongList + global player', () => {
  it('renders the track list (titles, artists, durations)', () => {
    renderList(tracks);
    expect(screen.getByText('பூ வாசம்')).toBeInTheDocument();
    expect(screen.getByText('No Audio Song')).toBeInTheDocument();
    expect(screen.getByText('3:05')).toBeInTheDocument();
  });

  it('shows no player bar until a track is selected', () => {
    renderList(tracks);
    expect(screen.queryByLabelText('Seek')).not.toBeInTheDocument();
  });

  it('plays a song and reveals the persistent bar when a playable row is clicked', () => {
    renderList(tracks);
    fireEvent.click(screen.getByText('பூ வாசம்'));
    expect(screen.getByLabelText('Seek')).toBeInTheDocument();
    expect(screen.getByLabelText('Previous')).toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('does not play for a song with no audio', () => {
    renderList(tracks);
    fireEvent.click(screen.getByText('No Audio Song'));
    expect(screen.queryByLabelText('Seek')).not.toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('exposes Play-all, Shuffle and Repeat controls', () => {
    renderList(tracks);
    expect(screen.getByRole('button', { name: PLAY_ALL })).toBeInTheDocument();
    expect(screen.getByLabelText('Shuffle')).toBeInTheDocument();
    expect(screen.getByLabelText('Repeat')).toBeInTheDocument();
  });

  it('Play-all starts the queue', () => {
    const { container } = renderList(three);
    fireEvent.click(screen.getByRole('button', { name: PLAY_ALL }));
    expect(audioSrc(container)).toBe('a.mp3');
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('Shuffle toggles its pressed state', () => {
    renderList(tracks);
    const shuffle = screen.getByLabelText('Shuffle');
    expect(shuffle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(shuffle);
    expect(shuffle).toHaveAttribute('aria-pressed', 'true');
  });

  it('Next and Previous move through the queue', () => {
    const { container } = renderList(three);
    fireEvent.click(screen.getByText('Track A'));
    expect(audioSrc(container)).toBe('a.mp3');
    fireEvent.click(screen.getByLabelText('Next'));
    expect(audioSrc(container)).toBe('b.mp3');
    fireEvent.click(screen.getByLabelText('Previous'));
    expect(audioSrc(container)).toBe('a.mp3');
  });

  it('autoplays the next track when the current one ends', () => {
    const { container } = renderList(three);
    fireEvent.click(screen.getByText('Track A'));
    fireEvent.ended(container.querySelector('audio')!);
    expect(audioSrc(container)).toBe('b.mp3');
  });

  it('stops at the end of the queue when repeat is off', () => {
    const { container } = renderList(three);
    fireEvent.click(screen.getByText('Track C'));
    fireEvent.ended(container.querySelector('audio')!);
    expect(audioSrc(container)).toBe('c.mp3');
  });

  it('repeat-all wraps from the last track to the first', () => {
    const { container } = renderList(three);
    fireEvent.click(screen.getByText('Track C'));
    fireEvent.click(screen.getByLabelText('Repeat')); // off -> all
    fireEvent.ended(container.querySelector('audio')!);
    expect(audioSrc(container)).toBe('a.mp3');
  });

  it('repeat-one replays the same track on end', () => {
    const { container } = renderList(three);
    fireEvent.click(screen.getByText('Track B'));
    fireEvent.click(screen.getByLabelText('Repeat')); // off -> all
    fireEvent.click(screen.getByLabelText('Repeat all')); // all -> one
    (window.HTMLMediaElement.prototype.play as jest.Mock).mockClear();
    fireEvent.ended(container.querySelector('audio')!);
    expect(audioSrc(container)).toBe('b.mp3');
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });
});

describe('player bar: buffering, errors, a11y', () => {
  it('wraps the bar in a labelled "Now playing" region', () => {
    renderList(tracks);
    fireEvent.click(screen.getByText('பூ வாசம்'));
    expect(screen.getByRole('region', { name: 'இசை இயக்கி' })).toBeInTheDocument();
  });

  it('shows a buffering state while waiting, and clears it on canplay', () => {
    const { container } = renderList(tracks);
    fireEvent.click(screen.getByText('பூ வாசம்'));
    const audio = container.querySelector('audio')!;
    expect(screen.getByLabelText('Play')).toHaveAttribute('aria-busy', 'false');
    fireEvent.waiting(audio);
    expect(screen.getByLabelText('Play')).toHaveAttribute('aria-busy', 'true');
    fireEvent.canPlay(audio);
    expect(screen.getByLabelText('Play')).toHaveAttribute('aria-busy', 'false');
  });

  it('surfaces an error alert when the audio fails to load', () => {
    const { container } = renderList(tracks);
    fireEvent.click(screen.getByText('பூ வாசம்'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.error(container.querySelector('audio')!);
    expect(screen.getByRole('alert')).toHaveTextContent('இயக்க முடியவில்லை');
  });

  it('sets Media Session metadata for the playing track', () => {
    renderList(tracks);
    fireEvent.click(screen.getByText('பூ வாசம்'));
    expect((navigator.mediaSession.metadata as any)?.title).toBe('பூ வாசம்');
    expect((navigator.mediaSession.metadata as any)?.artist).toBe('இளையராஜா');
  });

  it('exposes a lyrics link on every row (visible on mobile too)', () => {
    renderList(tracks);
    expect(
      screen.getByRole('link', { name: 'பூ வாசம் — பாடல் வரிகள்' })
    ).toHaveAttribute('href', '/content/s1');
  });
});

describe('session persistence', () => {
  it('persists the queue + position to sessionStorage while playing', () => {
    const { container } = renderList(three);
    fireEvent.click(screen.getByText('Track B'));
    fireEvent.timeUpdate(container.querySelector('audio')!, { target: { currentTime: 12 } });
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!);
    expect(saved.index).toBe(1);
    expect(saved.queue).toHaveLength(3);
  });

  it('restores a saved session (bar reappears) without autoplaying', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ queue: three, index: 1, shuffle: false, repeat: 'off', time: 12 })
    );
    renderList(three);
    const region = screen.getByRole('region', { name: 'இசை இயக்கி' });
    expect(within(region).getByText('Track B')).toBeInTheDocument();
    // restored sessions stay paused — no autoplay without a user gesture
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});

describe('sort toolbar', () => {
  // 6 tracks (>= the toolbar threshold), with distinct titles/durations/dates.
  const many: SongRow[] = [
    { id: 'm1', title: 'Zebra', artist: 'Anil', src: 'z.mp3', duration: 100, addedAt: 1 },
    { id: 'm2', title: 'Apple', artist: 'Bala', src: 'a.mp3', duration: 300, addedAt: 6 },
    { id: 'm3', title: 'Mango', artist: 'Chitra', src: 'm.mp3', duration: 200, addedAt: 3 },
    { id: 'm4', title: 'Banana', artist: 'Deepa', src: 'b.mp3', duration: 50, addedAt: 5 },
    { id: 'm5', title: 'Cherry', artist: 'Esan', src: 'c.mp3', duration: 400, addedAt: 2 },
    { id: 'm6', title: 'Date', artist: 'Farah', src: 'd.mp3', duration: 150, addedAt: 4 },
  ];
  const rowTitles = () =>
    screen.getAllByRole('listitem').map((li) => li.querySelector('.font-tamil')?.textContent);

  it('is hidden for a small catalogue and shown once it is large enough', () => {
    const { unmount } = renderList(three);
    expect(screen.queryByLabelText('வரிசைப்படுத்து')).toBeNull();
    unmount();
    renderList(many);
    expect(screen.getByLabelText('வரிசைப்படுத்து')).toBeInTheDocument();
  });

  it('defaults to newest-first (by addedAt)', () => {
    renderList(many);
    expect(rowTitles()).toEqual(['Apple', 'Banana', 'Date', 'Mango', 'Cherry', 'Zebra']);
  });

  it('sorts by title and by duration', () => {
    renderList(many);
    fireEvent.change(screen.getByLabelText('வரிசைப்படுத்து'), { target: { value: 'title' } });
    expect(rowTitles()).toEqual(['Apple', 'Banana', 'Cherry', 'Date', 'Mango', 'Zebra']);
    fireEvent.change(screen.getByLabelText('வரிசைப்படுத்து'), { target: { value: 'duration' } });
    expect(rowTitles()).toEqual(['Cherry', 'Apple', 'Mango', 'Date', 'Zebra', 'Banana']);
  });
});

describe('SongsPlaylist — Tamil search', () => {
  const many: Track[] = [
    { id: '1', title: 'அந்தி மேகமே', artist: 'இராஜ்', src: '1.mp3', duration: 60 },
    { id: '2', title: 'எங்கள் தேசம்', artist: 'இராஜ்', src: '2.mp3', duration: 60 },
    { id: '3', title: 'காதல் மழை', artist: 'இராஜ்', src: '3.mp3', duration: 60 },
    { id: '4', title: 'Tamil Melody', artist: 'Raj', src: '4.mp3', duration: 60 },
    { id: '5', title: 'அம்மா', artist: 'இராஜ்', src: '5.mp3', duration: 60 },
    { id: '6', title: 'நிலா', artist: 'இராஜ்', src: '6.mp3', duration: 60 },
  ];

  it('shows the search box once the toolbar threshold is reached', () => {
    renderList(many);
    expect(screen.getByLabelText('பாடல்களைத் தேடு')).toBeInTheDocument();
  });

  it('filters by typed Tamil (title match)', () => {
    renderList(many);
    fireEvent.change(screen.getByLabelText('பாடல்களைத் தேடு'), { target: { value: 'எங்கள்' } });
    expect(screen.getByText('எங்கள் தேசம்')).toBeInTheDocument();
    expect(screen.queryByText('அந்தி மேகமே')).not.toBeInTheDocument();
  });

  it('matches the romanised artist and shows a no-results message when nothing matches', () => {
    renderList(many);
    const box = screen.getByLabelText('பாடல்களைத் தேடு');
    fireEvent.change(box, { target: { value: 'raj' } }); // artist "Raj"
    expect(screen.getByText('Tamil Melody')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'zzznomatch' } });
    expect(screen.getByText(/தேடலுக்குப் பொருந்தும்/)).toBeInTheDocument();
  });
});
