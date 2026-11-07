/** @jest-environment jsdom */
/**
 * The Video Text timeline: three rows, blocks as keyboard sliders. The
 * arithmetic lives in timeline.ts (moveBlock / resizeBlock); this pins that
 * the keys reach it with the right numbers and that a neighbour stops a move.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { Timeline } from '@/components/admin/video-text/Timeline';
import type { TextBlock } from '@/types/videoText';

const lyric = (i: number, s: number, e: number, text = `line ${i}`): TextBlock => ({
  id: `lyric-${i}`, track: 'lyric', text, startSec: s, endSec: e,
});

function setup(blocks: TextBlock[], playheadSec = 0) {
  const onChange = jest.fn();
  const onSeek = jest.fn();
  render(<Timeline blocks={blocks} durationSec={60} playheadSec={playheadSec} onChange={onChange} onSeek={onSeek} />);
  return { onChange, onSeek };
}
const moved = (onChange: jest.Mock, id: string) =>
  (onChange.mock.calls.at(-1)![0] as TextBlock[]).find((b) => b.id === id)!;

it('labels the Title, Lyrics and Credits rows', () => {
  setup([lyric(0, 5, 10)]);
  for (const name of ['Title', 'Lyrics', 'Credits']) expect(screen.getByText(name)).toBeInTheDocument();
});

it('each block is a labelled slider with its times', () => {
  setup([lyric(0, 5, 10, 'அம்மா'), lyric(1, 12, 15)]);
  const b = screen.getByRole('slider', { name: 'Lyric 1: அம்மா' });
  expect(b).toHaveAttribute('tabindex', '0');
  expect(b).toHaveAttribute('aria-valuetext', '0:05.0 to 0:10.0');
  expect(screen.getByRole('slider', { name: 'Lyric 2: line 1' })).toBeInTheDocument();
});

it('ArrowRight nudges a focused block 0.1 s, Shift+ArrowRight 1 s', () => {
  const { onChange } = setup([lyric(0, 5, 10)]);
  const b = screen.getByRole('slider', { name: /^Lyric 1/ });
  b.focus();
  fireEvent.keyDown(b, { key: 'ArrowRight' });
  expect(moved(onChange, 'lyric-0')).toMatchObject({ startSec: 5.1, endSec: 10.1 });
  fireEvent.keyDown(b, { key: 'ArrowRight', shiftKey: true });
  expect(moved(onChange, 'lyric-0')).toMatchObject({ startSec: 6, endSec: 11 });
});

it('a nudge into the next block stops at its edge', () => {
  const { onChange } = setup([lyric(0, 5, 10), lyric(1, 10.05, 15)]);
  fireEvent.keyDown(screen.getByRole('slider', { name: /^Lyric 1/ }), { key: 'ArrowRight' });
  expect(moved(onChange, 'lyric-0')).toMatchObject({ startSec: 5.05, endSec: 10.05 });
});

it('[ and ] move the start or end to the playhead', () => {
  const { onChange } = setup([lyric(0, 5, 10)], 7.25);
  const b = screen.getByRole('slider', { name: /^Lyric 1/ });
  fireEvent.keyDown(b, { key: '[' });
  expect(moved(onChange, 'lyric-0')).toMatchObject({ startSec: 7.25, endSec: 10 });
  fireEvent.keyDown(b, { key: ']' });
  expect(moved(onChange, 'lyric-0')).toMatchObject({ startSec: 5, endSec: 7.25 });
});

it('the edge handles are separately labelled', () => {
  setup([lyric(0, 5, 10)]);
  expect(screen.getByLabelText('Start of lyric 1')).toBeInTheDocument();
  expect(screen.getByLabelText('End of lyric 1')).toBeInTheDocument();
});

it('has a zoom slider', () => {
  setup([lyric(0, 5, 10)]);
  expect(screen.getByLabelText('Zoom')).toHaveAttribute('type', 'range');
});
