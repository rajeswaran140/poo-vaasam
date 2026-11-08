/** @jest-environment jsdom */
/** Tap to time: each tap starts the next line at the song's current time. */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TapToTime } from '@/components/admin/video-text/TapToTime';
import type { TextBlock } from '@/types/videoText';

const lines: TextBlock[] = [0, 1, 2].map((i) => ({ id: `lyric-${i}`, track: 'lyric', text: `L${i + 1}`, startSec: 5 + i * 4, endSec: 8 + i * 4 }));

function setup(initial: TextBlock[] = lines, disabled = false) {
  const video = { currentTime: 0, play: jest.fn(() => Promise.resolve()), pause: jest.fn() };
  const ref = { current: video as unknown as HTMLVideoElement };
  const changes: TextBlock[][] = [];
  function Host() {
    const [blocks, setBlocks] = React.useState(initial);
    return (
      <>
        <TapToTime
          blocks={blocks}
          durationSec={60}
          video={ref}
          onChange={(b) => { changes.push(b); setBlocks(b); }}
          disabled={disabled}
        />
        <input aria-label="Some field" />
        <ul>{blocks.map((b) => <li key={b.id} data-testid={b.id}>{`${b.startSec}-${b.endSec}`}</li>)}</ul>
      </>
    );
  }
  render(<Host />);
  const at = (t: number) => { video.currentTime = t; };
  const times = () => lines.map((b) => screen.getByTestId(b.id).textContent);
  return { video, at, times, changes };
}
const tapButton = () => screen.getByRole('button', { name: /^Tap: / });

it('a full session: start plays the song, each tap starts a line, a last tap ends it', () => {
  const { video, at, times } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Tap to time lyrics' }));
  expect(video.play).toHaveBeenCalled();
  expect(screen.getByText(/Line 1 of 3/)).toBeInTheDocument();
  at(10); fireEvent.click(tapButton());
  at(13.5); fireEvent.click(tapButton());
  at(17.25); fireEvent.click(tapButton());
  expect(tapButton()).toHaveTextContent('Tap: last line ends');
  at(20); fireEvent.click(tapButton());
  expect(times()).toEqual(['10-13.5', '13.5-17.25', '17.25-20']);
  expect(video.pause).toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('All lines timed.');
  expect(screen.getByRole('button', { name: 'Tap to time lyrics' })).toBeInTheDocument();
});

it('Space taps too, but not while typing in a field', () => {
  const { at, times } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Tap to time lyrics' }));
  at(10);
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' })); });
  expect(times()[0]).toBe('10-13');
  at(12);
  fireEvent.keyDown(screen.getByLabelText('Some field'), { code: 'Space', key: ' ' });
  expect(times()[1]).toBe('13-16'); // untouched by the keypress in the field
});

it('a tap too soon after the previous line is refused with a note', () => {
  const { at, times } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Tap to time lyrics' }));
  at(10); fireEvent.click(tapButton());
  at(10.2); fireEvent.click(tapButton());
  expect(screen.getByRole('status')).toHaveTextContent('Too quick');
  expect(screen.getByText(/Line 2 of 3/)).toBeInTheDocument();
  expect(times()[0]).toBe('10-13');
});

it('Stop ends the open line at the song\'s time and keeps the untapped lines', () => {
  const { at, times, video } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Tap to time lyrics' }));
  at(10); fireEvent.click(tapButton());
  at(11.5);
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(times()).toEqual(['10-11.5', '13-16', '16-19']); // the first tap had pushed lines 2-3 later
  expect(video.pause).toHaveBeenCalled();
});

it('Cancel puts every line back as it was', () => {
  const { at, times } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Tap to time lyrics' }));
  at(30); fireEvent.click(tapButton());
  at(33); fireEvent.click(tapButton());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(times()).toEqual(['5-8', '9-12', '13-16']);
  expect(screen.getByRole('status')).toHaveTextContent('Cancelled');
});

it('can start from a later line; earlier lines are left alone', () => {
  const { at, times } = setup();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tap to time lyrics' }));
  expect(screen.getByText(/Line 2 of 3/)).toBeInTheDocument();
  at(20); fireEvent.click(tapButton());
  expect(times()).toEqual(['5-8', '20-23', '23-26']);
});

it('is disabled while a video uploads or renders, and hidden with no lyrics', () => {
  setup(lines, true);
  expect(screen.getByRole('button', { name: 'Tap to time lyrics' })).toBeDisabled();
});

it('shows nothing when there are no lyric lines', () => {
  setup([]);
  expect(screen.queryByTestId('tap-to-time')).toBeNull();
});
