/** @jest-environment jsdom */
/**
 * Unit tests for SongsTable — the /admin/songs filter + table client
 * component. Covers: full render, title search, status filter, theme
 * filter, AND-combined filters, friendly empty state.
 */

jest.mock('@/lib/client-auth', () => ({
  adminFetch: jest.fn(),
}));
// SongsTable now renders GenerateCoverButton, which uses useRouter().
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { SongsTable, type SongRow } from '@/components/admin/SongsTable';

const SONGS: SongRow[] = [
  { id: 'cnt_1', title: 'என்ன மாயம்',     status: 'PUBLISHED', theme: undefined },                 // default = love
  { id: 'cnt_2', title: 'அந்தி மேகமே',     status: 'PUBLISHED', theme: undefined },                 // love
  { id: 'cnt_3', title: 'இரை தேட சென்றதாய்', status: 'PUBLISHED', theme: 'nature' },
  { id: 'cnt_4', title: 'என் தேசமே',        status: 'PUBLISHED', theme: 'homeland' },
  { id: 'cnt_5', title: 'Draft Song',       status: 'DRAFT',     theme: 'love' },
];

const setup = () =>
  render(
    <SongsTable
      songs={SONGS}
      playsBySongId={{ cnt_2: 42 }}
      ga4PlaysWorking={true}
    />
  );

const rowTitles = () =>
  Array.from(document.querySelectorAll('tbody tr td:first-child .font-tamil')).map(
    (n) => n.textContent ?? ''
  );

it('renders every song row by default', () => {
  setup();
  expect(rowTitles()).toHaveLength(SONGS.length);
  // tally hint
  expect(screen.getByText(`${SONGS.length} of ${SONGS.length}`)).toBeInTheDocument();
});

it('shows the play count for songs that have one', () => {
  setup();
  expect(screen.getByText('42')).toBeInTheDocument();
});

it('filters by title substring (case-insensitive)', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'மாயம்' } });
  expect(rowTitles()).toEqual(['என்ன மாயம்']);
});

it('filters by status', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'DRAFT' } });
  expect(rowTitles()).toEqual(['Draft Song']);
});

it('filters by theme (honours the override map)', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Theme filter'), { target: { value: 'homeland' } });
  expect(rowTitles()).toEqual(['என் தேசமே']);
});

/**
 * ⚠️ UNTAGGED IS NOT LOVE. These rows used to appear under the `love` filter
 * because an unclassified song resolved to the default — so filtering for love
 * returned songs nobody had ever called love songs.
 */
it('combines filters as AND, and does NOT sweep untagged songs into love', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'PUBLISHED' } });
  fireEvent.change(screen.getByLabelText('Theme filter'), { target: { value: 'love' } });
  // The untagged rows are absent: they are unclassified, not love songs.
  expect(rowTitles()).not.toContain('அந்தி மேகமே');
  expect(rowTitles()).not.toContain('என்ன மாயம்');
});

it('renders a friendly empty state when no rows match', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'will-never-match' } });
  expect(screen.queryAllByRole('row')).toHaveLength(2); // <thead> + 1 empty-state row
  expect(screen.getByText(/No songs match/i)).toBeInTheDocument();
});

/**
 * The server page asks the repository for `{ limit: 200 }` and reads only
 * `res.items` — `hasMore` and `lastEvaluatedKey` come back beside it and were
 * discarded. With 77 songs and a 1-2/week cadence the cap is ~2 years out, so
 * the danger is not that it truncates but that it truncates SILENTLY: the
 * filter runs over an array the server already cut, so search cannot find the
 * missing songs either.
 */
it('warns when the list is truncated, instead of quietly showing a partial catalogue', () => {
  render(<SongsTable songs={SONGS} playsBySongId={{}} ga4PlaysWorking={false} truncated />);
  const warning = screen.getByRole('status', { name: /truncated/i });
  expect(warning).toHaveTextContent(/not showing every song/i);
});

it('shows no truncation warning in the normal case', () => {
  render(<SongsTable songs={SONGS} playsBySongId={{}} ga4PlaysWorking={false} />);
  expect(screen.queryByRole('status', { name: /truncated/i })).toBeNull();
});

/**
 * The YouTube column labels both of its states for a screen reader; the Audio
 * column beside it rendered a bare ✓ or — with no accessible text at all.
 */
it('gives the Audio column accessible text, like the YouTube column already has', () => {
  render(<SongsTable songs={SONGS} playsBySongId={{}} ga4PlaysWorking={false} />);
  expect(screen.getAllByLabelText(/has an audio file|no audio file/i).length).toBe(SONGS.length);
});
