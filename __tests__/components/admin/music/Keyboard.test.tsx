/**
 * Virtual keyboard.
 *
 * The test that carries the weight is the tonic one: changing the tonic must
 * RE-LABEL the keys. A component that rendered a fixed Sa-Ri-Ga strip would
 * pass a "shows swara names" test and fail this one.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Keyboard } from '@/components/admin/music/Keyboard';

// The engine touches Web Audio, which jsdom does not implement.
jest.mock('@/lib/music/audio-engine', () => ({
  audioEngine: {
    resume: jest.fn(async () => {}),
    playNote: jest.fn(),
    playSequence: jest.fn(),
    stopAll: jest.fn(),
    stopMetronome: jest.fn(),
    setVolume: jest.fn(),
    onPulse: jest.fn(() => () => {}),
  },
}));

import { audioEngine } from '@/lib/music/audio-engine';

const tonicSelect = () => screen.getByLabelText(/tonic/i);

describe('Keyboard — the tonic drives the swara labels', () => {
  afterEach(() => jest.clearAllMocks());

  it('labels middle C as Sa when the tonic is C', () => {
    render(<Keyboard octaves={1} startOctave={4} />);
    expect(screen.getByLabelText('C4 S')).toBeInTheDocument();
  });

  /** ⚠️ Same key, different tonic, different swara. Sa is not C. */
  it('re-labels middle C as Ma₁ when the tonic moves to G', () => {
    render(<Keyboard octaves={1} startOctave={4} />);
    fireEvent.change(tonicSelect(), { target: { value: '7' } }); // G
    expect(screen.getByLabelText('C4 M1')).toBeInTheDocument();
    expect(screen.queryByLabelText('C4 S')).not.toBeInTheDocument();
  });

  it('moves Sa onto the selected tonic', () => {
    render(<Keyboard octaves={1} startOctave={4} />);
    fireEvent.change(tonicSelect(), { target: { value: '7' } });
    expect(screen.getByLabelText('G4 S')).toBeInTheDocument();
  });

  it('can show Western note names instead of swaras', () => {
    render(<Keyboard octaves={1} startOctave={4} />);
    fireEvent.click(screen.getByLabelText(/show swara/i));
    // The aria-label drops the swara suffix when swaras are hidden.
    expect(screen.getByLabelText('C4')).toBeInTheDocument();
  });
});

describe('Keyboard — playing', () => {
  afterEach(() => jest.clearAllMocks());

  // `play()` awaits resume() so the very first gesture both unlocks audio and
  // sounds — which means the note lands a microtask later than the click.
  it('plays the note that was clicked', async () => {
    render(<Keyboard octaves={1} startOctave={4} />);
    fireEvent.mouseDown(screen.getByLabelText('C4 S'));
    await waitFor(() => expect(audioEngine.playNote).toHaveBeenCalledWith(60));
  });

  it('plays a black key', async () => {
    render(<Keyboard octaves={1} startOctave={4} />);
    fireEvent.mouseDown(screen.getByLabelText('C#4 R1'));
    await waitFor(() => expect(audioEngine.playNote).toHaveBeenCalledWith(61));
  });

  it('plays from the computer keyboard', async () => {
    render(<Keyboard octaves={1} startOctave={4} />);
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(audioEngine.playNote).toHaveBeenCalledWith(60));
  });

  /**
   * A typing shortcut that fires while the user is in a text field would make
   * every BPM edit — and every lyric typed elsewhere on the page — play notes.
   */
  it('does NOT hijack typing when a text field has focus', async () => {
    render(
      <>
        <input aria-label="somewhere to type" />
        <Keyboard octaves={1} startOctave={4} />
      </>
    );
    screen.getByLabelText('somewhere to type').focus();
    fireEvent.keyDown(window, { key: 'a' });
    await Promise.resolve(); // let any (wrongly) queued play settle
    expect(audioEngine.playNote).not.toHaveBeenCalled();
  });

  it('stops other audio before playing a scale, so nothing overlaps', () => {
    render(<Keyboard octaves={1} startOctave={4} />);
    fireEvent.change(screen.getByLabelText(/scale/i), { target: { value: 'major' } });
    fireEvent.click(screen.getByRole('button', { name: /asc/i }));
    expect(audioEngine.stopAll).toHaveBeenCalled();
    expect(audioEngine.playSequence).toHaveBeenCalledWith([60, 62, 64, 65, 67, 69, 71, 72], 0.38);
  });

  it('plays the scale descending when asked', () => {
    render(<Keyboard octaves={1} startOctave={4} />);
    fireEvent.change(screen.getByLabelText(/scale/i), { target: { value: 'major' } });
    fireEvent.click(screen.getByRole('button', { name: /desc/i }));
    expect(audioEngine.playSequence).toHaveBeenCalledWith([72, 71, 69, 67, 65, 64, 62, 60], 0.38);
  });

  it('transposes the scale with the tonic', () => {
    render(<Keyboard octaves={1} startOctave={4} />);
    fireEvent.change(tonicSelect(), { target: { value: '7' } }); // G
    fireEvent.change(screen.getByLabelText(/scale/i), { target: { value: 'major' } });
    fireEvent.click(screen.getByRole('button', { name: /asc/i }));
    // G major from G4: G A B C D E F# G — note the F#.
    expect(audioEngine.playSequence).toHaveBeenCalledWith([67, 69, 71, 72, 74, 76, 78, 79], 0.38);
  });

  it('shows the raga-is-not-a-scale caveat for a raga, not for the major scale', () => {
    render(<Keyboard octaves={1} startOctave={4} />);
    fireEvent.change(screen.getByLabelText(/scale/i), { target: { value: 'major' } });
    expect(screen.queryByText(/a raga is not a scale/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/scale/i), { target: { value: 'shankarabharanam' } });
    expect(screen.getByText(/a raga is not a scale/i)).toBeInTheDocument();
  });
});
