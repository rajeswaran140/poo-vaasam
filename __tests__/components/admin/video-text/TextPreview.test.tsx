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
