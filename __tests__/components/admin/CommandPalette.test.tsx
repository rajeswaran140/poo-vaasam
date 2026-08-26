/** @jest-environment jsdom */
/** CommandPalette — visibility, search filtering, keyboard nav, close semantics. */

/* Every lucide-react icon → null. Cleaner than mocking each by name. */
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CommandPalette } from '@/components/admin/CommandPalette';

afterEach(() => {
  push.mockClear();
  cleanup();
});

it('renders nothing when closed', () => {
  const { container } = render(<CommandPalette open={false} onOpenChange={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

it('renders a dialog with all sections when open with no query', () => {
  render(<CommandPalette open={true} onOpenChange={() => {}} />);
  expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  // At least the section headers we expect.
  ['Overview', 'Content', 'Studio', 'Audience', 'Insights', 'System'].forEach((s) => {
    expect(screen.getByText(s)).toBeInTheDocument();
  });
});

it('filters the list when the user types', () => {
  render(<CommandPalette open={true} onOpenChange={() => {}} />);
  const input = screen.getByLabelText(/search admin pages/i);
  fireEvent.change(input, { target: { value: 'youtube' } });
  // At least one YouTube result (title contains "YouTube").
  expect(screen.getAllByText(/youtube/i).length).toBeGreaterThan(0);
  // Something clearly unrelated shouldn't appear.
  expect(screen.queryByText('Categories')).not.toBeInTheDocument();
});

it('matches on the keyword aliases (e.g. "yt" → YouTube)', () => {
  render(<CommandPalette open={true} onOpenChange={() => {}} />);
  fireEvent.change(screen.getByLabelText(/search admin pages/i), { target: { value: 'yt' } });
  // "yt" isn't in the title/path — must have matched via the "yt" keyword.
  expect(screen.getByText('YouTube')).toBeInTheDocument();
});

it('surfaces the release page that was missing from the sidebar', () => {
  render(<CommandPalette open={true} onOpenChange={() => {}} />);
  fireEvent.change(screen.getByLabelText(/search admin pages/i), { target: { value: 'release' } });
  expect(screen.getByText('Release')).toBeInTheDocument();
});

it('shows a friendly empty state when nothing matches', () => {
  render(<CommandPalette open={true} onOpenChange={() => {}} />);
  fireEvent.change(screen.getByLabelText(/search admin pages/i), {
    target: { value: 'zzznotarealthing' },
  });
  expect(screen.getByText(/no pages match/i)).toBeInTheDocument();
});

it('navigates on Enter and closes', () => {
  const onOpenChange = jest.fn();
  render(<CommandPalette open={true} onOpenChange={onOpenChange} />);
  const input = screen.getByLabelText(/search admin pages/i);
  fireEvent.change(input, { target: { value: 'mastering' } });
  // Panel receives the key; we press Enter on the input which bubbles up.
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(push).toHaveBeenCalledTimes(1);
  // The first mastering result is Sound Engineering @ /admin/mastering.
  expect(push).toHaveBeenCalledWith('/admin/mastering');
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('closes on Escape without navigating', () => {
  const onOpenChange = jest.fn();
  render(<CommandPalette open={true} onOpenChange={onOpenChange} />);
  fireEvent.keyDown(screen.getByLabelText(/search admin pages/i), { key: 'Escape' });
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(push).not.toHaveBeenCalled();
});

it('closes on backdrop click', () => {
  const onOpenChange = jest.fn();
  const { container } = render(
    <CommandPalette open={true} onOpenChange={onOpenChange} />,
  );
  // Backdrop is the first div inside the dialog with the bg-black/50 class.
  const backdrop = container.querySelector('.bg-black\\/50') as HTMLElement;
  expect(backdrop).toBeTruthy();
  fireEvent.click(backdrop);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
