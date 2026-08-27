/** @jest-environment jsdom */
/** LyricReadView — the full-viewport, non-editable "just read what you wrote" overlay. */

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LyricReadView } from '@/components/admin/LyricReadView';

const writeText = jest.fn().mockResolvedValue(undefined);
beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
});

it('renders each source line separately so blank lines still take vertical space', () => {
  const lyric = 'பல்லவி\nஉறங்கும் உன் நினைவில்\n\nஅனுபல்லவி\nமீள்கிறேன் மீள்கிறேன்';
  render(<LyricReadView lyrics={lyric} onClose={() => {}} />);
  const rows = screen.getAllByTestId('lyric-line');
  // Five source lines: two content + blank + two more content. The blank
  // line must render as its own row so a stanza break stays visible.
  expect(rows).toHaveLength(5);
  expect(rows[0]).toHaveTextContent('பல்லவி');
  expect(rows[3]).toHaveTextContent('அனுபல்லவி');
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

describe('copy', () => {
  it('copies the whole lyric via the Copy-all button', () => {
    // A JS expression, NOT an attribute string — `"alpha\n"` inside a JSX
    // attribute is 8 literal chars, not 7 including a newline. Handler
    // writes back verbatim so the assertion must see the same string.
    render(<LyricReadView lyrics={'alpha\nbeta'} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/copy all lyrics/i));
    expect(writeText).toHaveBeenCalledWith('alpha\nbeta');
  });

  it('disables Copy-all when the lyric is empty', () => {
    render(<LyricReadView lyrics="   " onClose={() => {}} />);
    expect(screen.getByLabelText(/copy all lyrics/i)).toBeDisabled();
  });

  it('copies an individual line via its per-line button', () => {
    const lyric = 'first line\nsecond line\nthird line';
    render(<LyricReadView lyrics={lyric} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/copy line 2/i));
    expect(writeText).toHaveBeenCalledWith('second line');
    // First and third lines aren't offered a duplicate call.
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('does not render a copy button on blank lines', () => {
    render(<LyricReadView lyrics={'first\n\nthird'} onClose={() => {}} />);
    // Line 2 is blank — no copy target.
    expect(screen.queryByLabelText(/copy line 2/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/copy line 1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/copy line 3/i)).toBeInTheDocument();
  });
});
