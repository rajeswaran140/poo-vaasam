/**
 * Metronome controls.
 *
 * The visual bar is part of the teaching, so these tests check that switching
 * meter actually redraws the accent pattern — 3/4 and 6/8 must LOOK different,
 * not just be labelled differently.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Metronome } from '@/components/admin/music/Metronome';

jest.mock('@/lib/music/audio-engine', () => ({
  audioEngine: {
    resume: jest.fn(async () => {}),
    playNote: jest.fn(),
    playSequence: jest.fn(),
    startMetronome: jest.fn(async () => {}),
    stopMetronome: jest.fn(),
    stopAll: jest.fn(),
    setVolume: jest.fn(),
    onPulse: jest.fn(() => () => {}),
  },
}));

import { audioEngine } from '@/lib/music/audio-engine';

const accents = () =>
  screen.getAllByTestId(/^pulse-/).map((el) => el.getAttribute('data-accent'));

describe('Metronome — meter changes the pattern, not just the label', () => {
  afterEach(() => jest.clearAllMocks());

  it('draws 4/4 as eight pulses with a stressed half-bar', () => {
    render(<Metronome />);
    expect(accents()).toEqual(['strong', 'weak', 'medium', 'weak', 'medium', 'weak', 'medium', 'weak']);
  });

  it('draws 3/4 stressing every second pulse', () => {
    render(<Metronome />);
    fireEvent.click(screen.getByRole('button', { name: '3/4' }));
    expect(accents()).toEqual(['strong', 'weak', 'medium', 'weak', 'medium', 'weak']);
  });

  /** ⚠️ Same six pulses as 3/4, grouped in threes instead of twos. */
  it('draws 6/8 stressing every third pulse', () => {
    render(<Metronome />);
    fireEvent.click(screen.getByRole('button', { name: '6/8' }));
    expect(accents()).toEqual(['strong', 'weak', 'weak', 'medium', 'weak', 'weak']);
  });

  it('shows the two six-pulse meters as visibly different', () => {
    render(<Metronome />);
    fireEvent.click(screen.getByRole('button', { name: '3/4' }));
    const three = accents();
    fireEvent.click(screen.getByRole('button', { name: '6/8' }));
    expect(accents()).toHaveLength(three.length); // both six
    expect(accents()).not.toEqual(three); // and not the same
  });

  it('counts 3/4 as "1 and 2 and" and 6/8 as "1 2 3"', () => {
    render(<Metronome />);
    fireEvent.click(screen.getByRole('button', { name: '3/4' }));
    expect(screen.getAllByText('and')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '6/8' }));
    expect(screen.queryByText('and')).not.toBeInTheDocument();
  });

  it('explains the 6/8-vs-3/4 difference only where it is relevant', () => {
    render(<Metronome />);
    expect(screen.queryByText(/both have six pulses/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '6/8' }));
    expect(screen.getByText(/both have six pulses/i)).toBeInTheDocument();
  });
});

describe('Metronome — transport and tempo', () => {
  afterEach(() => jest.clearAllMocks());

  it('starts and stops, silencing other audio first', async () => {
    render(<Metronome />);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    await waitFor(() => expect(audioEngine.startMetronome).toHaveBeenCalled());
    expect(audioEngine.stopAll).toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: /stop/i }));
    expect(audioEngine.stopMetronome).toHaveBeenCalled();
  });

  it('clamps tempo to the 40-200 range', () => {
    render(<Metronome />);
    const box = screen.getByLabelText(/tempo in bpm/i);
    fireEvent.change(box, { target: { value: '5000' } });
    expect(box).toHaveValue(200);
    fireEvent.change(box, { target: { value: '1' } });
    expect(box).toHaveValue(40);
  });

  it('accepts a normal tempo unchanged', () => {
    render(<Metronome />);
    const box = screen.getByLabelText(/tempo in bpm/i);
    fireEvent.change(box, { target: { value: '132' } });
    expect(box).toHaveValue(132);
  });

  it('stops the metronome when it unmounts, so it cannot tick under another page', () => {
    const { unmount } = render(<Metronome />);
    unmount();
    expect(audioEngine.stopMetronome).toHaveBeenCalled();
  });
});
