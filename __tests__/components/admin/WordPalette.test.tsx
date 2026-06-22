/** @jest-environment jsdom */
/** WordPalette — lazy lexicon load, click-to-insert, draft overused-word lint. */

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WordPalette } from '@/components/admin/WordPalette';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;

const LEXICON = [
  { word: 'நிலா', gloss: 'moon', register: 'sangam', usage: 'fresh', themes: ['nature'], archived: false },
  { word: 'காதல்', gloss: 'love', register: 'modern', usage: 'retire', themes: ['love'], archived: false },
  { word: 'கடல்', gloss: 'sea', register: 'literary', usage: 'neutral', themes: ['nature'], archived: false },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: LEXICON }) });
});

it('does NOT load the lexicon until the panel is opened (lazy)', () => {
  render(<WordPalette lyrics="" onInsertWord={jest.fn()} />);
  expect(mockedFetch).not.toHaveBeenCalled();
});

it('loads on open and offers only fresh words as chips', async () => {
  const user = userEvent.setup();
  render(<WordPalette lyrics="" onInsertWord={jest.fn()} />);
  await user.click(screen.getByRole('button', { name: /word palette/i }));

  expect(mockedFetch).toHaveBeenCalledWith('/api/admin/lexicon');
  // fresh word offered...
  expect(await screen.findByRole('button', { name: 'நிலா' })).toBeInTheDocument();
  // ...retired + neutral are not.
  expect(screen.queryByRole('button', { name: 'காதல்' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'கடல்' })).not.toBeInTheDocument();
});

it('inserts a word when its chip is clicked', async () => {
  const onInsert = jest.fn();
  const user = userEvent.setup();
  render(<WordPalette lyrics="" onInsertWord={onInsert} />);
  await user.click(screen.getByRole('button', { name: /word palette/i }));
  await user.click(await screen.findByRole('button', { name: 'நிலா' }));
  expect(onInsert).toHaveBeenCalledWith('நிலா');
});

it('flags an overused (retire) word present in the draft', async () => {
  const user = userEvent.setup();
  render(<WordPalette lyrics="என் காதல் நிலா" onInsertWord={jest.fn()} />);
  await user.click(screen.getByRole('button', { name: /word palette/i }));
  await waitFor(() => expect(screen.getByText(/overused in your draft/i)).toBeInTheDocument());
  expect(screen.getByText('காதல்')).toBeInTheDocument();
});
