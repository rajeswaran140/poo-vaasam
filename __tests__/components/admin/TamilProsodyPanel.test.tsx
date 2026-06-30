/** @jest-environment jsdom */
/** TamilProsodyPanel — empty-guard, meter summary, per-line counts + rhyme groups. */

jest.mock('lucide-react', () => ({ Music2: () => <svg />, ChevronDown: () => <svg /> }));

import { render, screen, fireEvent } from '@testing-library/react';
import { TamilProsodyPanel } from '@/components/admin/TamilProsodyPanel';

it('renders nothing when there are no lyric lines', () => {
  const { container } = render(<TamilProsodyPanel lyrics="   " />);
  expect(container).toBeEmptyDOMElement();
});

it('summarises meter and, when expanded, shows per-line counts + rhyme groups', () => {
  render(<TamilProsodyPanel lyrics={'மாதம்\nமலர்\nகாதல்\nஅழகு'} />);

  // Collapsed: dominant syllable length + off-meter count.
  expect(screen.getByText(/~2 syllables · 4 lines/)).toBeInTheDocument();
  expect(screen.getByText(/1 off-meter/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Prosody/ }));

  // மோனை groups the two ம-initial lines; எதுகை the two த-second lines.
  expect(screen.getByText('மோனை (alliteration):')).toBeInTheDocument();
  expect(screen.getByText(/lines 1, 2/)).toBeInTheDocument();
  // The 3-syllable அழகு is flagged off-meter against the dominant 2.
  expect(screen.getByText(/⚠ off-meter/)).toBeInTheDocument();
});
