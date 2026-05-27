import { render, screen, fireEvent } from '@testing-library/react';
import { MusicPlayerProvider, formatTime, type Track } from '@/components/music/MusicPlayerProvider';
import { SongList } from '@/components/music/SongList';

// jsdom doesn't implement media playback.
beforeAll(() => {
  window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = jest.fn();
});
afterEach(() => jest.clearAllMocks());

const renderList = (tracks: Track[]) =>
  render(
    <MusicPlayerProvider>
      <SongList tracks={tracks} />
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
    expect(screen.getByLabelText('Play all')).toBeInTheDocument();
    expect(screen.getByLabelText('Shuffle')).toBeInTheDocument();
    expect(screen.getByLabelText('Repeat')).toBeInTheDocument();
  });

  it('Play-all starts the queue', () => {
    const { container } = renderList(three);
    fireEvent.click(screen.getByLabelText('Play all'));
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
    fireEvent.click(screen.getByLabelText('Repeat')); // all -> one
    (window.HTMLMediaElement.prototype.play as jest.Mock).mockClear();
    fireEvent.ended(container.querySelector('audio')!);
    expect(audioSrc(container)).toBe('b.mp3');
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });
});
