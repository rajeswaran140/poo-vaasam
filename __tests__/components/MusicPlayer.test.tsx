import { render, screen, fireEvent } from '@testing-library/react';
import { MusicPlayer, formatTime, type Track } from '@/components/music/MusicPlayer';

// jsdom doesn't implement media playback.
beforeAll(() => {
  window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = jest.fn();
});
afterEach(() => jest.clearAllMocks());

const tracks: Track[] = [
  { id: 's1', title: 'பூ வாசம்', artist: 'இளையராஜா', src: 'https://s3.example/a.mp3', cover: 'https://s3.example/c.jpg', duration: 185 },
  { id: 's2', title: 'No Audio Song', artist: 'Anon', src: '' },
];

describe('formatTime', () => {
  it('formats seconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(185)).toBe('3:05');
  });
  it('guards against bad input', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-10)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
  });
});

describe('MusicPlayer', () => {
  it('renders the track list (titles, artists, durations)', () => {
    render(<MusicPlayer tracks={tracks} />);
    expect(screen.getByText('பூ வாசம்')).toBeInTheDocument();
    expect(screen.getByText('No Audio Song')).toBeInTheDocument();
    expect(screen.getByText('இளையராஜா')).toBeInTheDocument();
    expect(screen.getByText('3:05')).toBeInTheDocument(); // 185s
  });

  it('shows no player bar until a track is selected', () => {
    render(<MusicPlayer tracks={tracks} />);
    expect(screen.queryByLabelText('Seek')).not.toBeInTheDocument();
  });

  it('plays a song and reveals the player bar when a playable row is clicked', () => {
    render(<MusicPlayer tracks={tracks} />);
    fireEvent.click(screen.getByText('பூ வாசம்'));
    // Player bar (seek slider + transport controls) now visible.
    expect(screen.getByLabelText('Seek')).toBeInTheDocument();
    expect(screen.getByLabelText('Previous')).toBeInTheDocument();
    expect(screen.getByLabelText('Next')).toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('does not play or show the bar for a song with no audio', () => {
    render(<MusicPlayer tracks={tracks} />);
    fireEvent.click(screen.getByText('No Audio Song'));
    expect(screen.queryByLabelText('Seek')).not.toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('exposes Play-all, Shuffle and Repeat controls', () => {
    render(<MusicPlayer tracks={tracks} />);
    expect(screen.getByLabelText('Play all')).toBeInTheDocument();
    expect(screen.getByLabelText('Shuffle')).toBeInTheDocument();
    expect(screen.getByLabelText('Repeat')).toBeInTheDocument();
  });

  it('Play-all starts the queue and reveals the player bar', () => {
    render(<MusicPlayer tracks={tracks} />);
    fireEvent.click(screen.getByLabelText('Play all'));
    expect(screen.getByLabelText('Seek')).toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('Shuffle toggles its pressed state', () => {
    render(<MusicPlayer tracks={tracks} />);
    const shuffle = screen.getByLabelText('Shuffle');
    expect(shuffle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(shuffle);
    expect(shuffle).toHaveAttribute('aria-pressed', 'true');
  });
});
