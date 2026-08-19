/**
 * Music Composition & Theory workspace — the shell.
 *
 * The component's stated correctness requirement is that only ONE section is
 * mounted at a time and `audioEngine.stopAll()` runs on every switch, so
 * leaving the metronome for the keyboard cannot leave a click running
 * underneath. That contract had no coverage at all.
 */

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

import { render, screen, fireEvent } from '@testing-library/react';
import { MusicTheoryWorkspace } from '@/components/admin/music/MusicTheoryWorkspace';
import { audioEngine } from '@/lib/music/audio-engine';
import { MUSIC_LESSONS } from '@/content/music-lessons';

const tab = (name: RegExp) => screen.getByRole('button', { name });
const keyboardPresent = () => screen.queryByRole('group', { name: /virtual keyboard/i });
const metronomePresent = () => screen.queryByRole('button', { name: /▶ Play|■ Stop/ });

beforeEach(() => jest.clearAllMocks());

describe('one tool at a time', () => {
  it('mounts the keyboard on Foundations and no metronome', () => {
    render(<MusicTheoryWorkspace />);
    expect(keyboardPresent()).toBeInTheDocument();
    expect(metronomePresent()).not.toBeInTheDocument();
  });

  it('swaps the keyboard for the metronome on Rhythm', () => {
    render(<MusicTheoryWorkspace />);
    fireEvent.click(tab(/Rhythm & Meter/));
    expect(metronomePresent()).toBeInTheDocument();
    expect(keyboardPresent()).not.toBeInTheDocument();
  });

  it('silences everything on every switch — a click must not survive the tab', () => {
    render(<MusicTheoryWorkspace />);
    fireEvent.click(tab(/Rhythm & Meter/));
    expect(audioEngine.stopAll).toHaveBeenCalledTimes(1);
    fireEvent.click(tab(/Melody/));
    expect(audioEngine.stopAll).toHaveBeenCalledTimes(2);
    expect(metronomePresent()).not.toBeInTheDocument();
  });

  it('mounts no tool on Tamil Lyrics', () => {
    render(<MusicTheoryWorkspace />);
    fireEvent.click(tab(/Tamil Lyrics/));
    expect(keyboardPresent()).not.toBeInTheDocument();
    expect(metronomePresent()).not.toBeInTheDocument();
  });
});

describe('lessons', () => {
  it('shows only the current section’s lessons', () => {
    render(<MusicTheoryWorkspace />);
    expect(screen.getByText(/Sound, frequency and pitch/)).toBeInTheDocument();
    expect(screen.queryByText(/Pulse, beat and tempo/)).not.toBeInTheDocument();
    fireEvent.click(tab(/Rhythm & Meter/));
    expect(screen.getByText(/Pulse, beat and tempo/)).toBeInTheDocument();
    expect(screen.queryByText(/Sound, frequency and pitch/)).not.toBeInTheDocument();
  });

  it('every section has at least one lesson, so no tab is empty', () => {
    render(<MusicTheoryWorkspace />);
    for (const [label, section] of [
      [/Foundations/, 'foundations'],
      [/Rhythm & Meter/, 'rhythm'],
      [/Melody/, 'melody'],
      [/Tamil Lyrics/, 'tamil-lyrics'],
    ] as const) {
      fireEvent.click(tab(label));
      const expected = MUSIC_LESSONS.filter((l) => l.section === section);
      expect(expected.length).toBeGreaterThan(0);
      expect(screen.getByText(expected[0].englishTitle)).toBeInTheDocument();
    }
  });

  it('marks the active tab for assistive tech', () => {
    render(<MusicTheoryWorkspace />);
    expect(tab(/Foundations/)).toHaveAttribute('aria-current', 'page');
    fireEvent.click(tab(/Melody/));
    expect(tab(/Melody/)).toHaveAttribute('aria-current', 'page');
    expect(tab(/Foundations/)).not.toHaveAttribute('aria-current');
  });
});

/**
 * REGRESSION: the Tamil Lyrics lesson tells the reader to "paste the line into
 * the Lyric Meter Lab". Both sibling tools shipped and were reachable only from
 * the global sidebar, so the instruction had no link to follow from here.
 */
describe('links to the sibling tools', () => {
  it('links the Lyric Meter Lab and the Composition Notebook', () => {
    render(<MusicTheoryWorkspace />);
    expect(screen.getByRole('link', { name: /Lyric Meter Lab/ })).toHaveAttribute(
      'href',
      '/admin/music-lab/meter-lab'
    );
    expect(screen.getByRole('link', { name: /Composition Notebook/ })).toHaveAttribute(
      'href',
      '/admin/music-lab/notebook'
    );
  });

  it('the lesson that names the Meter Lab can reach it', () => {
    render(<MusicTheoryWorkspace />);
    fireEvent.click(tab(/Tamil Lyrics/));
    expect(screen.getByText(/paste the line into the lyric meter lab/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Lyric Meter Lab/ })).toBeInTheDocument();
  });
});
