/** @jest-environment jsdom */
/**
 * The Video Text timeline: three rows, blocks as keyboard sliders. The
 * arithmetic lives in timeline.ts (moveBlock / resizeBlock); this pins that
 * the keys reach it with the right numbers and that a neighbour stops a move.
 */
import React from 'react';
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

  it('a 5 s title on a whole 5:44 song has no grabbable edge, so a drag moves it', () => {
    // jsdom width 0 → 600 px fallback → 1.74 px/s → the title is ~9 px wide.
    const { onChange } = setupLong([titleB()]);
    const b = screen.getByRole('slider', { name: 'Title: My Song' });
    for (const id of ['edge-start', 'edge-end']) {
      expect(within(b).getByTestId(id)).toHaveStyle({ width: '0px', pointerEvents: 'none' });
    }
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
    expect(screen.getByRole('status')).toHaveTextContent(
      "Stopped at 0:04.5: a block can't overlap its neighbour, run past the end, or be shorter than half a second.",
    );
  });

  it('moving credits past the end of the video stops at the end, and says so', () => {
    const { onChange } = setupLong([creditsB(300, 310)], 340);
    focus(screen.getByRole('slider', { name: 'Credits: Music: R' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to playhead' }));
    expect(moved(onChange, 'credits')).toMatchObject({ startSec: 334, endSec: 344 });
    expect(screen.getByRole('status')).toHaveTextContent('Stopped at 5:34.0');
  });

  it('a start typed but not committed survives grabbing the block (blur commits after pointerdown)', () => {
    // Stateful parent, like the editor: onChange feeds the blocks back in.
    function Host() {
      const [blocks, setBlocks] = React.useState<TextBlock[]>([titleB()]);
      return <Timeline blocks={blocks} durationSec={344} playheadSec={0} onChange={setBlocks} onSeek={() => {}} />;
    }
    render(<Host />);
    const b = screen.getByRole('slider', { name: 'Title: My Song' });
    focus(b);
    const start = within(screen.getByTestId('block-times')).getByLabelText('Start');
    act(() => start.focus());
    fireEvent.change(start, { target: { value: '0:02' } });
    // Browser order: pointerdown on the block, then the box blurs.
    fireEvent.pointerDown(b, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.blur(start);
    fireEvent.pointerMove(b, { pointerId: 1, clientX: 100 + 10 * (600 / 344) });
    fireEvent.pointerUp(b, { pointerId: 1 });
    // Typed start 2 s (block 2-5), then the drag moves it on 10 s. Snapshotting
    // at pointerdown would have dropped the typed time and given 0:10-0:15.
    expect(b).toHaveAttribute('aria-valuetext', '0:12.0 to 0:15.0');
  });

  it('a valid start typed then left by selecting another block is still saved', () => {
    const { onChange } = setupLong([titleB(), creditsB(334, 344)]);
    focus(screen.getByRole('slider', { name: 'Title: My Song' }));
    const end = within(screen.getByTestId('block-times')).getByLabelText('End');
    fireEvent.change(end, { target: { value: '0:08' } });
    // Selecting the credits remounts the box without a blur.
    focus(screen.getByRole('slider', { name: 'Credits: Music: R' }));
    expect(moved(onChange, 'title')).toMatchObject({ startSec: 0, endSec: 8 });
  });

  it('a rejected entry gives way to the new time when the block moves', () => {
    const { rerender } = render(
      <Timeline blocks={[titleB()]} durationSec={344} playheadSec={0} onChange={() => {}} onSeek={() => {}} />,
    );
    focus(screen.getByRole('slider', { name: 'Title: My Song' }));
    const start = within(screen.getByTestId('block-times')).getByLabelText('Start');
    fireEvent.change(start, { target: { value: 'abc' } });
    fireEvent.blur(start);
    expect(start).toHaveAttribute('aria-invalid', 'true');
    rerender(<Timeline blocks={[titleB(30, 35)]} durationSec={344} playheadSec={0} onChange={() => {}} onSeek={() => {}} />);
    expect(start).toHaveValue('0:30.0');
    expect(start).not.toHaveAttribute('aria-invalid');
  });

  it('a focused end handle keeps focus while ← narrows the block under 16 px', () => {
    function Host() {
      const [blocks, setBlocks] = React.useState<TextBlock[]>([titleB(0, 10)]); // ~17 px at 1.74 px/s
      return <Timeline blocks={blocks} durationSec={344} playheadSec={0} onChange={setBlocks} onSeek={() => {}} />;
    }
    render(<Host />);
    focus(screen.getByRole('slider', { name: 'Title: My Song' }));
    const endHandle = screen.getByRole('slider', { name: 'End of title' });
    focus(endHandle);
    fireEvent.keyDown(endHandle, { key: 'ArrowLeft', shiftKey: true }); // 9 s → ~16 px
    fireEvent.keyDown(endHandle, { key: 'ArrowLeft', shiftKey: true }); // 8 s → ~14 px, handle 0 px
    expect(document.activeElement).toBe(endHandle);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft', shiftKey: true });
    expect(screen.getByRole('slider', { name: 'Title: My Song' })).toHaveAttribute('aria-valuetext', '0:00.0 to 0:07.0');
  });
});

describe('whole song or part: stretching title and credits', () => {
  function Host({ initial }: { initial: TextBlock[] }) {
    const [blocks, setBlocks] = React.useState<TextBlock[]>(initial);
    return <Timeline blocks={blocks} durationSec={344} playheadSec={0} onChange={setBlocks} onSeek={() => {}} />;
  }
  const pps = 600 / 344;

  it('a selected thin block gets 10 px handles outside its edges; unselected ones stay 0 px', () => {
    render(<Host initial={[titleB(), creditsB(334, 344)]} />);
    const title = screen.getByRole('slider', { name: 'Title: My Song' });
    expect(within(title).getByTestId('edge-end')).toHaveStyle({ width: '0px', pointerEvents: 'none' });
    focus(title);
    expect(within(title).getByTestId('edge-end')).toHaveStyle({ width: '10px', right: '-10px' });
    expect(within(title).getByTestId('edge-start')).toHaveStyle({ width: '10px', left: '-10px' });
    const credits = screen.getByRole('slider', { name: 'Credits: Music: R' });
    expect(within(credits).getByTestId('edge-start')).toHaveStyle({ width: '4px' }); // 10 s ≈ 17 px
  });

  it('dragging the outside end handle of the thin title stretches it to the end of the song', () => {
    render(<Host initial={[titleB()]} />);
    const title = screen.getByRole('slider', { name: 'Title: My Song' });
    focus(title);
    const end = within(title).getByTestId('edge-end');
    fireEvent.pointerDown(end, { button: 0, pointerId: 1, clientX: 50 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 50 + 400 * pps }); // far past the end
    fireEvent.pointerUp(title, { pointerId: 1 });
    expect(title).toHaveAttribute('aria-valuetext', '0:00.0 to 5:44.0');
  });

  it('Whole video sets the title to the full song, and the credits too', () => {
    render(<Host initial={[titleB(), creditsB(334, 344)]} />);
    focus(screen.getByRole('slider', { name: 'Title: My Song' }));
    fireEvent.click(screen.getByRole('button', { name: 'Whole video' }));
    expect(screen.getByRole('slider', { name: 'Title: My Song' })).toHaveAttribute('aria-valuetext', '0:00.0 to 5:44.0');
    expect(screen.queryByRole('status')).toBeNull();
    focus(screen.getByRole('slider', { name: 'Credits: Music: R' }));
    fireEvent.click(screen.getByRole('button', { name: 'Whole video' }));
    expect(screen.getByRole('slider', { name: 'Credits: Music: R' })).toHaveAttribute('aria-valuetext', '0:00.0 to 5:44.0');
  });

  it('after Whole video, a part can be set again with the Start/End boxes', () => {
    render(<Host initial={[titleB()]} />);
    focus(screen.getByRole('slider', { name: 'Title: My Song' }));
    fireEvent.click(screen.getByRole('button', { name: 'Whole video' }));
    const end = within(screen.getByTestId('block-times')).getByLabelText('End');
    fireEvent.change(end, { target: { value: '1:30' } });
    fireEvent.keyDown(end, { key: 'Enter' });
    expect(screen.getByRole('slider', { name: 'Title: My Song' })).toHaveAttribute('aria-valuetext', '0:00.0 to 1:30.0');
  });

  it('lyric lines have no Whole video button', () => {
    render(<Host initial={[lyric(0, 10, 20)]} />);
    focus(screen.getByRole('slider', { name: /^Lyric 1/ }));
    expect(screen.queryByRole('button', { name: 'Whole video' })).toBeNull();
  });
});

it('a tap that wobbles under 4 px does not move the block; 4 px or more does', () => {
  const { onChange } = setupLong([titleB()]);
  const b = screen.getByRole('slider', { name: 'Title: My Song' });
  fireEvent.pointerDown(b, { button: 0, pointerId: 1, clientX: 100 });
  fireEvent.pointerMove(b, { pointerId: 1, clientX: 103 });
  fireEvent.pointerMove(b, { pointerId: 1, clientX: 97 });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerMove(b, { pointerId: 1, clientX: 100 + 10 * (600 / 344) });
  fireEvent.pointerUp(b, { pointerId: 1 });
  expect(moved(onChange, 'title')).toMatchObject({ startSec: 10, endSec: 15 });
});

describe('timeline audit fixes (2026-11-08)', () => {
  // Three back-to-back lines, as a fresh project lays them out.
  const tiled = () => [lyric(0, 10, 20), lyric(1, 20, 30), lyric(2, 30, 40)];

  it('a boxed-in line says why it cannot move, and the no-op is not passed on', () => {
    const { onChange } = setup(tiled());
    const b = screen.getByRole('slider', { name: /^Lyric 2/ });
    fireEvent.keyDown(b, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('timeline-hint')).toHaveTextContent("Lyric 2 touches its neighbours, so it can't move");
    fireEvent.pointerDown(b, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(b, { pointerId: 1, clientX: 150 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('dragging an edge into a touching neighbour moves the shared boundary (rolling edit)', () => {
    const { onChange } = setup(tiled()); // 10 px/s
    const b = screen.getByRole('slider', { name: /^Lyric 2/ });
    const end = within(b).getByTestId('edge-end');
    fireEvent.pointerDown(end, { button: 0, pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(b, { pointerId: 1, clientX: 350 });
    const out = onChange.mock.calls.at(-1)![0] as TextBlock[];
    expect(out.find((x) => x.id === 'lyric-1')).toMatchObject({ startSec: 20, endSec: 35 });
    expect(out.find((x) => x.id === 'lyric-2')).toMatchObject({ startSec: 35, endSec: 40 });
  });

  it('pulling the edge away from the neighbour still leaves a gap', () => {
    const { onChange } = setup(tiled());
    const b = screen.getByRole('slider', { name: /^Lyric 2/ });
    fireEvent.pointerDown(within(b).getByTestId('edge-end'), { button: 0, pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(b, { pointerId: 1, clientX: 250 });
    const out = onChange.mock.calls.at(-1)![0] as TextBlock[];
    expect(out.find((x) => x.id === 'lyric-1')).toMatchObject({ startSec: 20, endSec: 25 });
    expect(out.find((x) => x.id === 'lyric-2')).toMatchObject({ startSec: 30, endSec: 40 });
  });

  it('typing an End past the touching neighbour rolls into it too', () => {
    const { onChange } = setup(tiled());
    fireEvent.pointerDown(screen.getByRole('slider', { name: /^Lyric 2/ }), { button: 0, pointerId: 1, clientX: 0 });
    const end = within(screen.getByTestId('block-times')).getByLabelText('End');
    fireEvent.change(end, { target: { value: '33' } });
    fireEvent.keyDown(end, { key: 'Enter' });
    const out = onChange.mock.calls.at(-1)![0] as TextBlock[];
    expect(out.find((x) => x.id === 'lyric-2')).toMatchObject({ startSec: 33, endSec: 40 });
  });

  it('the "Stopped at" note names the edge that was stopped', () => {
    setup([lyric(0, 10, 20), lyric(1, 20, 21)]);
    fireEvent.pointerDown(screen.getByRole('slider', { name: /^Lyric 1/ }), { button: 0, pointerId: 1, clientX: 0 });
    const end = within(screen.getByTestId('block-times')).getByLabelText('End');
    fireEvent.change(end, { target: { value: '25' } });
    fireEvent.keyDown(end, { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('Stopped at 0:20.5');
  });

  it('the ruler seeks on a click, not on a pointerdown (a swipe scrolls)', () => {
    const { onSeek } = setup([lyric(0, 5, 10)]);
    const ruler = screen.getByTestId('timeline-ruler');
    fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 200 });
    expect(onSeek).not.toHaveBeenCalled();
    fireEvent.click(ruler, { clientX: 200 });
    expect(onSeek).toHaveBeenCalledWith(20);
  });

  const fakeScroll = () => {
    const el = screen.getByTestId('timeline-scroller');
    let left = 0;
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => { left = v; } });
    return () => left;
  };

  it('zoom keeps the playhead where it was on screen', () => {
    setupLong([titleB()], 200); // 600 px fallback over 344 s
    const scrollLeft = fakeScroll();
    const onScreen = 200 * (600 / 344);
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '1' } }); // 40 px/s
    expect(scrollLeft()).toBeCloseTo(200 * 40 - onScreen, 0);
  });

  it('the view follows the playhead when it leaves the screen', () => {
    const onChange = jest.fn();
    const { rerender } = render(<Timeline blocks={[titleB()]} durationSec={344} playheadSec={0} onChange={onChange} onSeek={jest.fn()} />);
    const scrollLeft = fakeScroll();
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '1' } });
    expect(scrollLeft()).toBe(0);
    rerender(<Timeline blocks={[titleB()]} durationSec={344} playheadSec={10} onChange={onChange} onSeek={jest.fn()} />);
    expect(scrollLeft()).toBe(0); // 400 px: still in view
    rerender(<Timeline blocks={[titleB()]} durationSec={344} playheadSec={100} onChange={onChange} onSeek={jest.fn()} />);
    expect(scrollLeft()).toBe(4000 - 150);
  });
});

describe('In and Out marks', () => {
  const withCut = (cut: { inSec: number; outSec: number } | null) => {
    const onCutChange = jest.fn();
    render(
      <Timeline blocks={[lyric(0, 5, 10)]} durationSec={60} playheadSec={0} onChange={jest.fn()} onSeek={jest.fn()} cut={cut} fps={25} onCutChange={onCutChange} />,
    );
    return onCutChange;
  };
  it('no marks: no shading and no handles', () => {
    withCut(null);
    expect(screen.queryByTestId('cut-shade-in')).toBeNull();
    expect(screen.queryByRole('slider', { name: 'In mark' })).toBeNull();
  });
  it('shades outside the marks and shows both handles with their times', () => {
    withCut({ inSec: 10, outSec: 40 });
    expect(screen.getByTestId('cut-shade-in')).toBeInTheDocument();
    expect(screen.getByTestId('cut-shade-out')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'In mark' })).toHaveAttribute('aria-valuetext', '0:10.0');
    expect(screen.getByRole('slider', { name: 'Out mark' })).toHaveAttribute('aria-valuetext', '0:40.0');
  });
  it('an Out at the end shades nothing after it', () => {
    withCut({ inSec: 10, outSec: 60 });
    expect(screen.queryByTestId('cut-shade-out')).toBeNull();
  });
  it('arrow keys on a focused handle move it one frame, Shift one second', () => {
    const onCutChange = withCut({ inSec: 10, outSec: 40 });
    const h = screen.getByRole('slider', { name: 'In mark' });
    fireEvent.keyDown(h, { key: 'ArrowRight' });
    expect(onCutChange).toHaveBeenLastCalledWith({ inSec: 10.04, outSec: 40 });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Out mark' }), { key: 'ArrowLeft', shiftKey: true });
    expect(onCutChange).toHaveBeenLastCalledWith({ inSec: 10, outSec: 39 });
  });
  it('a handle arrowed into the other mark stops a second short instead of wiping it out', () => {
    const onCutChange = withCut({ inSec: 10, outSec: 11 });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'In mark' }), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Out mark' }), { key: 'ArrowLeft' });
    expect(onCutChange).not.toHaveBeenCalled();
  });
  it('clicking a handle does not seek', () => {
    const onSeek = jest.fn();
    render(
      <Timeline blocks={[]} durationSec={60} playheadSec={0} onChange={jest.fn()} onSeek={onSeek} cut={{ inSec: 10, outSec: 40 }} fps={25} onCutChange={jest.fn()} />,
    );
    fireEvent.click(screen.getByTestId('cut-in'));
    expect(onSeek).not.toHaveBeenCalled();
  });
});

describe('the freeze band', () => {
  it('shades from the freeze to the end; none without a freeze', () => {
    const { rerender } = render(<Timeline blocks={[]} durationSec={60} playheadSec={0} onChange={jest.fn()} onSeek={jest.fn()} freezeSec={15} />);
    const band = screen.getByTestId('freeze-shade');
    expect(band).toHaveTextContent('Frozen');
    expect(band.getAttribute('title')).toMatch(/0:15/);
    rerender(<Timeline blocks={[]} durationSec={60} playheadSec={0} onChange={jest.fn()} onSeek={jest.fn()} freezeSec={null} />);
    expect(screen.queryByTestId('freeze-shade')).toBeNull();
  });
});
