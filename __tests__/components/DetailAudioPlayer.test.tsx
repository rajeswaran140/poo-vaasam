import { render, screen, fireEvent } from '@testing-library/react';
import { MusicPlayerProvider, type Track } from '@/components/music/MusicPlayerProvider';
import { DetailAudioPlayer } from '@/components/music/DetailAudioPlayer';

beforeAll(() => {
  window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = jest.fn();
});
beforeEach(() => sessionStorage.clear());
afterEach(() => jest.clearAllMocks());

const track: Track = { id: 'x', title: 'Song X', artist: 'A', src: 'x.mp3', duration: 65 };

const renderPlayer = (t: Track = track) =>
  render(
    <MusicPlayerProvider>
      <DetailAudioPlayer track={t} />
    </MusicPlayerProvider>
  );

describe('DetailAudioPlayer', () => {
  it('renders a play button and the formatted duration', () => {
    renderPlayer();
    expect(screen.getByRole('button', { name: 'இயக்கு' })).toBeInTheDocument();
    expect(screen.getByText(/காலம்.*1:05/)).toBeInTheDocument();
  });

  it('drives the global player (no second audio element) when clicked', () => {
    const { container } = renderPlayer();
    // Before clicking, only the provider's (empty) audio exists once the bar is hidden.
    fireEvent.click(screen.getByRole('button', { name: 'இயக்கு' }));
    // Exactly one <audio> in the tree — the global player's.
    expect(container.querySelectorAll('audio')).toHaveLength(1);
    expect(container.querySelector('audio')).toHaveAttribute('src', 'x.mp3');
    expect(screen.getByRole('region', { name: 'இசை இயக்கி' })).toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });
});
