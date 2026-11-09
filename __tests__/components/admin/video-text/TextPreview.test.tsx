/** @jest-environment jsdom */
/** Move text on the preview: the switch, the boxes over showing parts, drag and arrow keys. */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

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

// jsdom has no canvas: a measuring context that sizes text by length.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    return { font: '', measureText: (s: string) => ({ width: s.length * 10 }), clearRect() {}, drawImage() {} } as unknown as CanvasRenderingContext2D;
  } as never;
});
jest.mock('@/lib/video-text/draw', () => ({ ...jest.requireActual('@/lib/video-text/draw'), ensureFonts: jest.fn(async () => undefined) }));

import { TextPreview } from '@/components/admin/video-text/TextPreview';
import type { TextBlock, TextStyle } from '@/types/videoText';

const blocks: TextBlock[] = [
  { id: 't', track: 'title', text: 'Song', startSec: 0, endSec: 5 },
  { id: 'l', track: 'lyric', text: 'line', startSec: 6, endSec: 9 },
];
const STYLE: TextStyle = { sizeScale: 1, lyricPosition: 'lower', tracks: { title: { offset: { x: 0.1, y: 0 } } } };

function setup(timeSec: number) {
  const onMove = jest.fn();
  render(<TextPreview videoUrl="x.mp4" frame={{ width: 1920, height: 1080 }} blocks={blocks} style={STYLE} onTime={jest.fn()} timeSec={timeSec} onMove={onMove} />);
  return onMove;
}

it('with the switch off, nothing over the picture can be grabbed', () => {
  setup(1);
  expect(screen.queryByTestId('move-title')).toBeNull();
});

it('switched on, only the part showing now gets a box', () => {
  setup(1);
  fireEvent.click(screen.getByLabelText('Move text by dragging it on the picture'));
  expect(screen.getByTestId('move-title')).toBeInTheDocument();
  expect(screen.queryByTestId('move-lyric')).toBeNull();
});

it('dragging a box moves that part by the pointer travel, as a share of the picture', () => {
  const onMove = setup(1);
  fireEvent.click(screen.getByLabelText('Move text by dragging it on the picture'));
  const box = screen.getByTestId('move-title');
  // The picture shows 960 × 540 on screen.
  (box.parentElement as HTMLElement).getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON() {} });
  fireEvent.pointerDown(box, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(box, { pointerId: 1, clientX: 196, clientY: 46 });
  expect(onMove).toHaveBeenLastCalledWith('title', { x: 0.2, y: -0.1 });
  fireEvent.pointerUp(box, { pointerId: 1 });
});

it('arrow keys on a box move it 0.5%, Shift 5%', () => {
  const onMove = setup(1);
  fireEvent.click(screen.getByLabelText('Move text by dragging it on the picture'));
  const box = screen.getByTestId('move-title');
  fireEvent.keyDown(box, { key: 'ArrowLeft' });
  expect(onMove).toHaveBeenLastCalledWith('title', { x: 0.095, y: 0 });
  fireEvent.keyDown(box, { key: 'ArrowDown', shiftKey: true });
  expect(onMove).toHaveBeenLastCalledWith('title', { x: 0.1, y: 0.05 });
});

describe('the logo', () => {
  const logo = { image: {} as never, width: 200, height: 100, key: 'k' };
  const show = (style: TextStyle, timeSec = 30) => {
    const onMove = jest.fn();
    render(<TextPreview videoUrl="x.mp4" frame={{ width: 1920, height: 1080 }} blocks={blocks} style={style} onTime={jest.fn()} timeSec={timeSec} onMove={onMove} logo={logo} />);
    fireEvent.click(screen.getByLabelText('Move text by dragging it on the picture'));
    return onMove;
  };

  it('shown: gets its own box over where it sits (bottom right by default), even with no text showing', () => {
    show({ sizeScale: 1, lyricPosition: 'lower', logo: { show: true } });
    const box = screen.getByTestId('move-logo');
    // 10% of 1080 = 108 high, 216 wide, inside the 5% margin.
    expect(parseFloat(box.style.left)).toBeCloseTo(((1920 * 0.95 - 216) / 1920) * 100);
    expect(parseFloat(box.style.top)).toBeCloseTo(((1080 * 0.95 - 108) / 1080) * 100);
  });

  it('arrow keys move the logo, not a text part', () => {
    const onMove = show({ sizeScale: 1, lyricPosition: 'lower', logo: { show: true, offset: { x: 0.02, y: 0 } } });
    fireEvent.keyDown(screen.getByTestId('move-logo'), { key: 'ArrowUp', shiftKey: true });
    expect(onMove).toHaveBeenLastCalledWith('logo', { x: 0.02, y: -0.05 });
  });

  it('the logo box comes before the text boxes, so a text part on top of it is still the one dragged', () => {
    show({ sizeScale: 1, lyricPosition: 'lower', logo: { show: true } }, 1); // the title shows at 1 s
    const ids = Array.from(document.querySelectorAll('[data-testid^="move-"]')).map((e) => e.getAttribute('data-testid'));
    expect(ids).toEqual(['move-logo', 'move-title']);
  });

  it('hidden: no logo box', () => {
    show({ sizeScale: 1, lyricPosition: 'lower', logo: { show: false } });
    expect(screen.queryByTestId('move-logo')).toBeNull();
  });
});

describe('the freeze still', () => {
  it('an expired link on the hidden copy asks the editor for a fresh one', () => {
    const onLinkError = jest.fn();
    render(<TextPreview videoUrl="x.mp4" frame={{ width: 1920, height: 1080 }} blocks={blocks} style={STYLE} onTime={jest.fn()} freezeSec={2} fps={25} onLinkError={onLinkError} />);
    const hidden = document.querySelectorAll('video')[1];
    expect(hidden).toBeTruthy();
    fireEvent.error(hidden);
    expect(onLinkError).toHaveBeenCalledTimes(1);
  });
  it('a frozen preview gets its own Play / Pause (the still covers the video controls); none without a freeze', () => {
    const { unmount } = render(<TextPreview videoUrl="x.mp4" frame={{ width: 1920, height: 1080 }} blocks={blocks} style={STYLE} onTime={jest.fn()} freezeSec={2} />);
    expect(screen.getByRole('button', { name: 'Play / Pause' })).toBeInTheDocument();
    unmount();
    render(<TextPreview videoUrl="x.mp4" frame={{ width: 1920, height: 1080 }} blocks={blocks} style={STYLE} onTime={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Play / Pause' })).toBeNull();
  });
});
