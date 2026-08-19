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

/* ------------------------------------------------------------------ *
 * REGRESSION: labels follow the scale DEGREE once a scale is selected.
 *
 * The keyboard named every key by its position above the tonic, so selecting
 * Kharaharapriya spelled it "S R2 R3 M1 P D2 D3" — two Ri's, two Da's, no Ga
 * and no Ni. Only 'major' was ever exercised, and major is the one scale where
 * position and degree naming agree.
 * ------------------------------------------------------------------ */

describe('Keyboard — swara labels follow the selected scale', () => {
  const pickScale = (id: string) =>
    fireEvent.change(screen.getByLabelText(/scale/i), { target: { value: id } });

  it('names the third degree of Kharaharapriya Ga, not a second Ri', () => {
    render(<Keyboard />);
    pickScale('kharaharapriya');
    expect(screen.getByLabelText('D#4 G2')).toBeInTheDocument();
    expect(screen.queryByLabelText('D#4 R3')).not.toBeInTheDocument();
  });

  it('names its seventh degree Ni, not a second Da', () => {
    render(<Keyboard />);
    pickScale('kharaharapriya');
    expect(screen.getByLabelText('A#4 N2')).toBeInTheDocument();
    expect(screen.queryByLabelText('A#4 D3')).not.toBeInTheDocument();
  });

  it('does the same for natural minor', () => {
    render(<Keyboard />);
    pickScale('natural-minor');
    expect(screen.getByLabelText('D#4 G2')).toBeInTheDocument();
    expect(screen.getByLabelText('A#4 N2')).toBeInTheDocument();
  });

  it('leaves major alone — position and degree already agree there', () => {
    render(<Keyboard />);
    pickScale('major');
    expect(screen.getByLabelText('E4 G3')).toBeInTheDocument();
    expect(screen.getByLabelText('B4 N3')).toBeInTheDocument();
  });

  it('falls back to position names for notes outside the scale', () => {
    render(<Keyboard />);
    pickScale('mohanam'); // no Ma, no Ni
    expect(screen.getByLabelText('F4 M1')).toBeInTheDocument();
  });

  it('re-labels by degree when the tonic moves', () => {
    render(<Keyboard />);
    pickScale('kharaharapriya');
    fireEvent.change(screen.getByLabelText(/tonic/i), { target: { value: '7' } }); // G
    // Three semitones above G is A#, and in this scale that degree is Ga.
    expect(screen.getByLabelText('A#4 G2')).toBeInTheDocument();
  });
});

/* REGRESSION: the raga caveat is driven by data, not by how the name is spelt. */
describe('Keyboard — raga-vs-scale caveat', () => {
  const pickScale = (id: string) =>
    fireEvent.change(screen.getByLabelText(/scale/i), { target: { value: id } });

  it('shows the caveat for raga entries', () => {
    render(<Keyboard />);
    pickScale('kharaharapriya');
    expect(screen.getByText(/A raga is not a scale/i)).toBeInTheDocument();
  });

  it('does not show it for a plain Western scale', () => {
    render(<Keyboard />);
    pickScale('major');
    expect(screen.queryByText(/A raga is not a scale/i)).not.toBeInTheDocument();
    pickScale('natural-minor');
    expect(screen.queryByText(/A raga is not a scale/i)).not.toBeInTheDocument();
  });
});

/* REGRESSION: a focusable key that does nothing on Enter is not usable. */
describe('Keyboard — keys are operable from the keyboard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('plays on Enter', async () => {
    render(<Keyboard />);
    fireEvent.keyDown(screen.getByLabelText('C4 S'), { key: 'Enter' });
    await waitFor(() => expect(audioEngine.playNote).toHaveBeenCalledWith(60));
  });

  it('plays on Space', async () => {
    render(<Keyboard />);
    fireEvent.keyDown(screen.getByLabelText('C#4 R1'), { key: ' ' });
    await waitFor(() => expect(audioEngine.playNote).toHaveBeenCalledWith(61));
  });

  it('ignores other keys on a focused key button', () => {
    render(<Keyboard />);
    fireEvent.keyDown(screen.getByLabelText('C4 S'), { key: 'Tab' });
    expect(audioEngine.playNote).not.toHaveBeenCalled();
  });
});
