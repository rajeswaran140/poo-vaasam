/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { PerSongDeepDive } from '@/components/admin/PerSongDeepDive';

// The child panels' on-demand hook imports adminFetch; nothing fetches on mount
// (they're click-to-load), but mock it so an accidental call can't hit the net.
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

it('renders a collapsed deep-dive group containing the three per-song panels', () => {
  render(<PerSongDeepDive videos={[]} ytaConfigured={false} />);

  const summary = screen.getByText(/Per-song deep dive/i);
  expect(summary).toBeInTheDocument();

  // Collapsed by default — no `open` attribute on the <details>.
  const details = summary.closest('details');
  expect(details).not.toBeNull();
  expect(details).not.toHaveAttribute('open');

  // All three panels are inside (their headings render even when Analytics is off).
  expect(screen.getByText('Song trend (daily)')).toBeInTheDocument();
  expect(screen.getByText('Audience geography')).toBeInTheDocument();
  expect(screen.getByText('Search discovery')).toBeInTheDocument();
});
