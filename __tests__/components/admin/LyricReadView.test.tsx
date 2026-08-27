/** @jest-environment jsdom */
/** LyricReadView — the full-viewport, non-editable "just read what you wrote" overlay. */

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LyricReadView } from '@/components/admin/LyricReadView';

afterEach(() => {
  cleanup();
});

it('renders the lyric text preserving whitespace (stanzas stay stanzas)', () => {
  const lyric = 'பல்லவி\nஉறங்கும் உன் நினைவில்\n\nஅனுபல்லவி\nமீள்கிறேன் மீள்கிறேன்';
  render(<LyricReadView lyrics={lyric} onClose={() => {}} />);
  // <pre> preserves the exact whitespace — the render swallows nothing.
  const pre = screen.getByText((_c, el) => el?.tagName === 'PRE' && el.textContent === lyric);
  expect(pre).toBeInTheDocument();
});

it('shows the title as a heading when provided', () => {
  render(<LyricReadView lyrics="x" title="En Mugame En Agame Amma" onClose={() => {}} />);
  expect(screen.getByRole('heading', { name: /En Mugame/ })).toBeInTheDocument();
});

it('omits the heading when no title is passed', () => {
  render(<LyricReadView lyrics="x" onClose={() => {}} />);
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});

it('calls onClose on the close button', () => {
  const onClose = jest.fn();
  render(<LyricReadView lyrics="x" onClose={onClose} />);
  fireEvent.click(screen.getByLabelText(/close read mode/i));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('calls onClose when Escape is pressed', () => {
  const onClose = jest.fn();
  render(<LyricReadView lyrics="x" onClose={onClose} />);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('calls onClose when the backdrop is clicked (but not the content)', () => {
  const onClose = jest.fn();
  render(<LyricReadView lyrics="the lyric" onClose={onClose} />);
  // Click on the content — should NOT close.
  fireEvent.click(screen.getByText('the lyric'));
  expect(onClose).not.toHaveBeenCalled();
  // Click on the backdrop (the outermost dialog element) — should close.
  fireEvent.click(screen.getByRole('dialog'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('calls window.print() on the Print button', () => {
  const printMock = jest.fn();
  const originalPrint = window.print;
  window.print = printMock;
  try {
    render(<LyricReadView lyrics="x" onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/print/i));
    expect(printMock).toHaveBeenCalledTimes(1);
  } finally {
    window.print = originalPrint;
  }
});

it('locks body scroll while open and restores it on close', () => {
  const originalOverflow = document.body.style.overflow;
  document.body.style.overflow = '';
  const { unmount } = render(<LyricReadView lyrics="x" onClose={() => {}} />);
  expect(document.body.style.overflow).toBe('hidden');
  unmount();
  expect(document.body.style.overflow).toBe('');
  document.body.style.overflow = originalOverflow;
});
