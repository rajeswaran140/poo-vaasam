/** @jest-environment jsdom */
/**
 * The Video Text timeline: three rows, blocks as keyboard sliders. The
 * arithmetic lives in timeline.ts (moveBlock / resizeBlock); this pins that
 * the keys reach it with the right numbers and that a neighbour stops a move.
 */
import { render, screen, fireEvent, within, act } from '@testing-library/react';

// jsdom has no PointerEvent: without it fireEvent drops button/clientX/pointerId.
if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}
const focus = (el: HTMLElement) => act(() => el.focus());
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

// ── Narrow blocks, typed times, playhead buttons ────────────────────────────
import { parseTime, handleWidth, formatTime } from '@/components/admin/video-text/Timeline';

const titleB = (s = 0, e = 5): TextBlock => ({ id: 'title', track: 'title', text: 'My Song', startSec: s, endSec: e });
const creditsB = (s: number, e: number): TextBlock => ({ id: 'credits', track: 'credits', text: 'Music: R', startSec: s, endSec: e });

function setupLong(blocks: TextBlock[], playheadSec = 0, durationSec = 344) {
  const onChange = jest.fn();
  render(<Timeline blocks={blocks} durationSec={durationSec} playheadSec={playheadSec} onChange={onChange} onSeek={jest.fn()} />);
  return { onChange };
}

describe('parseTime', () => {
  it.each([
    ['12.5', 12.5],
    ['0:12.5', 12.5],
    ['1:05', 65],
    ['5:44.0', 344],
    ['1:02:03', 3723],
    ['.5', 0.5],
    [' 7 ', 7],
  ])('%s → %s', (input, sec) => expect(parseTime(input)).toBe(sec));

  it.each(['', 'abc', '1:65', '-3', '1::2', '12s', '1:2:3:4'])('rejects %p', (input) => {
    expect(parseTime(input)).toBeNull();
  });

  it('reads back everything formatTime writes', () => {
    for (const s of [0, 0.1, 9.9, 59.9, 60, 65.3, 343.9]) expect(parseTime(formatTime(s))).toBe(s);
  });
});

describe('narrow blocks', () => {
  it('handleWidth: 8 px, 4 px under 32 px, none under 16 px', () => {
    expect(handleWidth(50)).toBe(8);
    expect(handleWidth(32)).toBe(8);
    expect(handleWidth(31)).toBe(4);
    expect(handleWidth(16)).toBe(4);
    expect(handleWidth(15.9)).toBe(0);
  });

  it('a 5 s title on a whole 5:44 song has no edge handles, so a drag moves it', () => {
    // jsdom width 0 → 600 px fallback → 1.74 px/s → the title is ~9 px wide.
    const { onChange } = setupLong([titleB()]);
    const b = screen.getByRole('slider', { name: 'Title: My Song' });
    expect(within(b).queryByTestId('edge-start')).toBeNull();
    expect(within(b).queryByTestId('edge-end')).toBeNull();
    const pps = 600 / 344;
    fireEvent.pointerDown(b, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(b, { pointerId: 1, clientX: 100 + 20 * pps });
    fireEvent.pointerUp(b, { pointerId: 1 });
    expect(moved(onChange, 'title')).toMatchObject({ startSec: 20, endSec: 25 });
  });

  it('a wide block keeps 8 px handles, and dragging the body still moves it', () => {
    const { onChange } = setup([lyric(0, 5, 10)]); // 60 s → 10 px/s → 50 px
    const b = screen.getByRole('slider', { name: /^Lyric 1/ });
    expect(within(b).getByTestId('edge-start')).toHaveStyle({ width: '8px' });
    fireEvent.pointerDown(b, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(b, { pointerId: 1, clientX: 130 });
    expect(moved(onChange, 'lyric-0')).toMatchObject({ startSec: 8, endSec: 13 });
  });
});

describe('Start / End boxes', () => {
  it('appear for the clicked block, with its times', () => {
    setupLong([titleB(), creditsB(334, 344)]);
    expect(screen.queryByTestId('block-times')).toBeNull();
    fireEvent.pointerDown(screen.getByRole('slider', { name: 'Credits: Music: R' }), { button: 0, pointerId: 1, clientX: 0 });
    const panel = screen.getByRole('group', { name: 'Times for Credits' });
    expect(within(panel).getByLabelText('Start')).toHaveValue('5:34.0');
    expect(within(panel).getByLabelText('End')).toHaveValue('5:44.0');
  });

  it('typing a start time and pressing Enter moves that edge', () => {
    const { onChange } = setupLong([titleB()]);
    focus(screen.getByRole('slider', { name: 'Title: My Song' }));
    const start = within(screen.getByTestId('block-times')).getByLabelText('Start');
    fireEvent.change(start, { target: { value: '0:02.5' } });
    fireEvent.keyDown(start, { key: 'Enter' });
    expect(moved(onChange, 'title')).toMatchObject({ startSec: 2.5, endSec: 5 });
  });

  it('typing an end time commits on blur', () => {
    const { onChange } = setupLong([titleB()]);
    focus(screen.getByRole('slider', { name: 'Title: My Song' }));
    const end = within(screen.getByTestId('block-times')).getByLabelText('End');
    fireEvent.change(end, { target: { value: '8' } });
    fireEvent.blur(end);
    expect(moved(onChange, 'title')).toMatchObject({ startSec: 0, endSec: 8 });
  });

  it('a time that is not a time is marked and changes nothing', () => {
    const { onChange } = setupLong([titleB()]);
    focus(screen.getByRole('slider', { name: 'Title: My Song' }));
    const start = within(screen.getByTestId('block-times')).getByLabelText('Start');
    fireEvent.change(start, { target: { value: 'soon' } });
    fireEvent.keyDown(start, { key: 'Enter' });
    expect(start).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(start, { key: 'Escape' });
    expect(start).toHaveValue('0:00.0');
    expect(start).not.toHaveAttribute('aria-invalid');
  });

  it('Move to playhead keeps the length; Start/End at playhead set one edge', () => {
    const { onChange } = setupLong([titleB()], 12);
    focus(screen.getByRole('slider', { name: 'Title: My Song' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to playhead' }));
    expect(moved(onChange, 'title')).toMatchObject({ startSec: 12, endSec: 17 });
    fireEvent.click(screen.getByRole('button', { name: 'End at playhead' }));
    expect(moved(onChange, 'title')).toMatchObject({ startSec: 0, endSec: 12 });
    fireEvent.click(screen.getByRole('button', { name: 'Start at playhead' }));
    // 12 s is past the 5 s end: the start stops half a second before it, and says so.
    expect(moved(onChange, 'title')).toMatchObject({ startSec: 4.5, endSec: 5 });
    expect(screen.getByRole('status')).toHaveTextContent('Stopped at the next block or the end of the video.');
  });

  it('moving credits past the end of the video stops at the end, and says so', () => {
    const { onChange } = setupLong([creditsB(300, 310)], 340);
    focus(screen.getByRole('slider', { name: 'Credits: Music: R' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to playhead' }));
    expect(moved(onChange, 'credits')).toMatchObject({ startSec: 334, endSec: 344 });
    expect(screen.getByRole('status')).toHaveTextContent('Stopped');
  });
});
