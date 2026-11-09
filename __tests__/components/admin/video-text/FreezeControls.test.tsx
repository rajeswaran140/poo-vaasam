/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { FreezeControls } from '@/components/admin/video-text/FreezeControls';
import type { Freeze } from '@/types/videoText';

const setup = (freeze: Freeze | null, currentTime = 15.0) => {
  const onChange = jest.fn();
  const onSeek = jest.fn();
  const video = createRef<HTMLVideoElement>() as { current: HTMLVideoElement | null };
  const pause = jest.fn();
  video.current = { currentTime, pause } as unknown as HTMLVideoElement;
  render(<FreezeControls freeze={freeze} durationSec={60} fps={25} playheadSec={0} onChange={onChange} onSeek={onSeek} video={video} />);
  return { onChange, onSeek, pause };
};

it('steps one frame back or forward from the frame showing, pausing, to the middle of that frame', () => {
  const { onSeek, pause } = setup(null, 15.0); // frame 375 (a loop's first frame again)
  fireEvent.click(screen.getByRole('button', { name: 'Back 1 frame' }));
  expect(pause).toHaveBeenCalled();
  expect(onSeek).toHaveBeenLastCalledWith((374 + 0.5) / 25);
  fireEvent.click(screen.getByRole('button', { name: 'Forward 1 frame' }));
  expect(onSeek).toHaveBeenLastCalledWith((376 + 0.5) / 25);
});

it('Freeze here holds the frame showing at the video\'s clock', () => {
  const { onChange } = setup(null, 14.98);
  fireEvent.click(screen.getByRole('button', { name: 'Freeze here' }));
  expect(onChange).toHaveBeenCalledWith({ atSec: 14.96 });
  expect(screen.getByTestId('freeze-summary')).toHaveTextContent('No freeze');
});

it('with a freeze: says where, goes to it, removes it; pressing on the same frame changes nothing', () => {
  const { onChange, onSeek } = setup({ atSec: 14.96 }, 14.97);
  expect(screen.getByTestId('freeze-summary')).toHaveTextContent('freezes on the frame at 0:14.96');
  fireEvent.click(screen.getByRole('button', { name: 'Freeze here' }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Go to freeze' }));
  expect(onSeek).toHaveBeenLastCalledWith((374 + 0.5) / 25);
  fireEvent.click(screen.getByRole('button', { name: 'Remove freeze' }));
  expect(onChange).toHaveBeenCalledWith(null);
});
