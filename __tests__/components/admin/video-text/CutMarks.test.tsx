/** @jest-environment jsdom */
/** In and Out buttons and the Premiere keys (I, O, Shift+I, Shift+O). The arithmetic is cut.ts. */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CutMarks, formatMark } from '@/components/admin/video-text/CutMarks';
import type { Cut } from '@/types/videoText';

function setup(cut: Cut | null, playheadSec = 12, disabled = false) {
  const onChange = jest.fn();
  const onSeek = jest.fn();
  render(<CutMarks cut={cut} durationSec={60} fps={25} playheadSec={playheadSec} onChange={onChange} onSeek={onSeek} disabled={disabled} />);
  return { onChange, onSeek };
}

it('formatMark shows hundredths', () => {
  expect(formatMark(13.367)).toBe('0:13.37');
  expect(formatMark(75.5)).toBe('1:15.50');
});

it('with no marks it says the whole video is exported, and offers only Mark In and Mark Out', () => {
  setup(null);
  expect(screen.getByTestId('cut-summary')).toHaveTextContent('Make video exports the whole video.');
  expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
});

it('Mark In and Mark Out use the playhead', () => {
  const { onChange } = setup(null, 12);
  fireEvent.click(screen.getByRole('button', { name: /Mark In/ }));
  expect(onChange).toHaveBeenLastCalledWith({ inSec: 12, outSec: 60 });
  fireEvent.click(screen.getByRole('button', { name: /Mark Out/ }));
  expect(onChange).toHaveBeenLastCalledWith({ inSec: 0, outSec: 12 });
});

it('the I and O keys mark; Shift+I and Shift+O go to the marks', () => {
  const { onChange, onSeek } = setup({ inSec: 5, outSec: 40 }, 20);
  fireEvent.keyDown(window, { key: 'i' });
  expect(onChange).toHaveBeenLastCalledWith({ inSec: 20, outSec: 40 });
  fireEvent.keyDown(window, { key: 'o' });
  expect(onChange).toHaveBeenLastCalledWith({ inSec: 5, outSec: 20 });
  fireEvent.keyDown(window, { key: 'I', shiftKey: true });
  expect(onSeek).toHaveBeenLastCalledWith(5);
  fireEvent.keyDown(window, { key: 'O', shiftKey: true });
  expect(onSeek).toHaveBeenLastCalledWith(40);
});

it('I typed into a text field is text, and Ctrl+I is not a mark', () => {
  const { onChange } = setup(null);
  const box = document.createElement('textarea');
  document.body.appendChild(box);
  fireEvent.keyDown(box, { key: 'i' });
  fireEvent.keyDown(window, { key: 'i', ctrlKey: true });
  expect(onChange).not.toHaveBeenCalled();
  box.remove();
});

it('shows the marks and the length, and Clear removes them', () => {
  const { onChange } = setup({ inSec: 12.5, outSec: 42.5 });
  expect(screen.getByTestId('cut-summary')).toHaveTextContent('Make video exports 0:12.50 to 0:42.50 (0:30.00 long).');
  fireEvent.click(screen.getByRole('button', { name: 'Clear In and Out' }));
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it('disabled (a new video uploading): keys and buttons do nothing', () => {
  const { onChange } = setup(null, 12, true);
  fireEvent.keyDown(window, { key: 'i' });
  expect(screen.getByRole('button', { name: /Mark In/ })).toBeDisabled();
  expect(onChange).not.toHaveBeenCalled();
});

it('marks at the video\'s own clock at the press, not a playhead a frame behind', () => {
  const onChange = jest.fn();
  const video = { current: { currentTime: 20.04 } as HTMLVideoElement };
  render(<CutMarks cut={null} durationSec={60} fps={25} playheadSec={20} onChange={onChange} onSeek={jest.fn()} video={video} />);
  fireEvent.keyDown(window, { key: 'i' });
  expect(onChange).toHaveBeenLastCalledWith({ inSec: 20.04, outSec: 60 });
  fireEvent.click(screen.getByRole('button', { name: /Mark Out/ }));
  expect(onChange).toHaveBeenLastCalledWith({ inSec: 0, outSec: 20.04 });
});

it('the physical I and O keys work with another keyboard layout active', () => {
  const { onChange } = setup(null, 12);
  fireEvent.keyDown(window, { key: 'ி', code: 'KeyI' });
  expect(onChange).toHaveBeenLastCalledWith({ inSec: 12, outSec: 60 });
  fireEvent.keyDown(window, { key: 'ொ', code: 'KeyO' });
  expect(onChange).toHaveBeenLastCalledWith({ inSec: 0, outSec: 12 });
});
