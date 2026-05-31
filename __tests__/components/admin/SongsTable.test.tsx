/** @jest-environment jsdom */
/**
 * Unit tests for SongsTable — the /admin/songs filter + table client
 * component. Covers: full render, title search, status filter, theme
 * filter, AND-combined filters, friendly empty state.
 */

jest.mock('@/lib/client-auth', () => ({
  adminFetch: jest.fn(),
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

it('combines filters as AND — published + love narrows correctly', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'PUBLISHED' } });
  fireEvent.change(screen.getByLabelText('Theme filter'), { target: { value: 'love' } });
  // 2 untagged (default love) + 0 published-draft (the draft is filtered out) = 2 published love
  expect(rowTitles().sort()).toEqual(['அந்தி மேகமே', 'என்ன மாயம்'].sort());
});

it('renders a friendly empty state when no rows match', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'will-never-match' } });
  expect(screen.queryAllByRole('row')).toHaveLength(2); // <thead> + 1 empty-state row
  expect(screen.getByText(/No songs match/i)).toBeInTheDocument();
});
