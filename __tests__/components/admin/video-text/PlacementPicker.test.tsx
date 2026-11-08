/** @jest-environment jsdom */
/** The 3×3 title/credits placement picker. */
import { render, screen, fireEvent } from '@testing-library/react';
import { PlacementPicker, placementName } from '@/components/admin/video-text/PlacementPicker';
import type { Placement } from '@/types/videoText';

function setup(value?: Placement) {
  const onChange = jest.fn();
  render(<PlacementPicker label="Title" value={value} onChange={onChange} />);
  return { onChange, group: screen.getByRole('radiogroup', { name: 'Title position' }) };
}

it('has nine labelled cells; no saved placement means Centre is checked', () => {
  setup();
  const cells = screen.getAllByRole('radio');
  expect(cells).toHaveLength(9);
  expect(cells.map((c) => c.getAttribute('aria-label'))).toEqual([
    'Top left', 'Top centre', 'Top right',
    'Middle left', 'Centre', 'Middle right',
    'Bottom left', 'Bottom centre', 'Bottom right',
  ]);
  expect(screen.getByRole('radio', { name: 'Centre' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  expect(screen.getByText('Centre', { selector: 'span' })).toBeInTheDocument();
});

it('clicking a cell reports that placement', () => {
  const { onChange } = setup();
  fireEvent.click(screen.getByRole('radio', { name: 'Top left' }));
  expect(onChange).toHaveBeenCalledWith({ v: 'top', h: 'left' });
});

it('shows the saved placement, and only that cell is in the tab order', () => {
  setup({ v: 'bottom', h: 'right' });
  const on = screen.getByRole('radio', { name: 'Bottom right' });
  expect(on).toHaveAttribute('aria-checked', 'true');
  expect(on).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('radio', { name: 'Centre' })).toHaveAttribute('tabindex', '-1');
});

it('arrow keys move one cell and stop at the edge', () => {
  const { onChange } = setup({ v: 'top', h: 'left' });
  const on = screen.getByRole('radio', { name: 'Top left' });
  fireEvent.keyDown(on, { key: 'ArrowDown' });
  expect(onChange).toHaveBeenLastCalledWith({ v: 'middle', h: 'left' });
  fireEvent.keyDown(on, { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith({ v: 'top', h: 'center' });
  fireEvent.keyDown(on, { key: 'ArrowUp' });
  expect(onChange).toHaveBeenLastCalledWith({ v: 'top', h: 'left' });
  fireEvent.keyDown(on, { key: 'ArrowLeft' });
  expect(onChange).toHaveBeenLastCalledWith({ v: 'top', h: 'left' });
});

it('placementName', () => {
  expect(placementName({ v: 'middle', h: 'center' })).toBe('Centre');
  expect(placementName({ v: 'bottom', h: 'center' })).toBe('Bottom centre');
});
