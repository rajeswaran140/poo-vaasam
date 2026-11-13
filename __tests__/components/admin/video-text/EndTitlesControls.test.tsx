/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { EndTitlesControls } from '@/components/admin/video-text/EndTitlesControls';

const video = (t: number) => ({ current: { currentTime: t } as unknown as HTMLVideoElement });
const base = { durationSec: 246, playheadSec: 0, onSeek: jest.fn(), hasLogo: true, hasCredits: true };

it('starts the end titles at the video time, then goes to or removes them', () => {
  const onChange = jest.fn();
  const { rerender } = render(<EndTitlesControls {...base} endTitles={null} onChange={onChange} video={video(236.42)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start end titles here' }));
  expect(onChange).toHaveBeenCalledWith({ atSec: 236.42, background: 'black' });

  rerender(<EndTitlesControls {...base} endTitles={{ atSec: 236.42 }} onChange={onChange} video={video(10)} />);
  expect(screen.getByText('From 3:56.42 to the end')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Go to end titles' }));
  expect(base.onSeek).toHaveBeenCalledWith(236.42);
  fireEvent.click(screen.getByRole('button', { name: 'Remove end titles' }));
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it('keeps a second for the fade when started at the very end', () => {
  const onChange = jest.fn();
  render(<EndTitlesControls {...base} endTitles={null} onChange={onChange} video={video(245.9)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start end titles here' }));
  expect(onChange).toHaveBeenCalledWith({ atSec: 245, background: 'black' });
});

it('warns when there is nothing to show on the black', () => {
  render(<EndTitlesControls {...base} hasLogo={false} hasCredits={false} endTitles={{ atSec: 200 }} onChange={jest.fn()} />);
  expect(screen.getByText(/plain screen/)).toBeInTheDocument();
});

it('switches the screen between black and white, keeping the start', () => {
  const onChange = jest.fn();
  render(<EndTitlesControls {...base} endTitles={{ atSec: 200 }} onChange={onChange} />);
  expect(screen.getByRole('radio', { name: 'Black' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('radio', { name: 'White' }));
  expect(onChange).toHaveBeenCalledWith({ atSec: 200, background: 'white' });
});
