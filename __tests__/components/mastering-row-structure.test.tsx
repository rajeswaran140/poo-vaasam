/** @jest-environment jsdom */
/**
 * The Saved-masters row keeps every control it had, and keeps them in zones.
 *
 * ⚠️ WHY THIS EXISTS. The row was one wrapping flex line holding eleven things
 * — transport, title, rename, three measurements, a badge, four download links
 * and two actions — all at the same visual weight. Restructuring it into
 * information-above / actions-below is the kind of change that silently loses a
 * button: the diff is mostly whitespace, so an omission reads as a re-indent.
 *
 * These pin the inventory (nothing was dropped) and the grouping (facts and
 * actions ended up in different containers), which is what the change was for.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/components/admin/MasteringComparePlayer', () => ({
  MasteringComparePlayer: () => null,
}));

import { render, screen, fireEvent, within } from '@testing-library/react';
import { MasteringStudio } from '@/components/admin/MasteringStudio';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;
const SONG = 'ஈழத்து மண்ணே';

/** Everything present at once, so no control can be missed for want of a key. */
const fullMaster = {
  id: 'job1',
  status: 'done',
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  s3Key: 'audio/mastering/in.wav',
  target: -14,
  masterKey: 'audio/mastering/out-master-14LUFS.wav',
  mp3Key: 'audio/mastering/out-master-14LUFS.mp3',
  videoKey: 'audio/mastering/out.mp4',
  shortKey: 'audio/mastering/out-short.mp4',
  coverKey: 'audio/mastering/cover.png',
  publishedAt: '2026-08-01T00:00:00.000Z',
  publishKey: 'audio/poem-music/ஈழத்து மண்ணே.mp3',
  beforeLufs: -17.9, beforeTp: -1.2, afterLufs: -14, afterTp: -1,
  beforeLra: 5.2, afterLra: 4.8, normalizationType: 'linear',
  source: null, savedAt: '2026-07-30T16:23:17.054Z',
  title: SONG, error: null,
};

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockImplementation((url: string) => {
    if (url.includes('/masters')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, masters: [fullMaster] }) } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
});

async function openLibrary() {
  render(<MasteringStudio />);
  fireEvent.click(screen.getByRole('button', { name: /Saved masters/i }));
  await screen.findAllByText(SONG);
}

function row(): HTMLElement {
  for (const n of screen.getAllByText(SONG)) {
    const li = n.closest('li');
    if (li) return li as HTMLElement;
  }
  throw new Error('no row');
}

describe('the row still carries everything it used to', () => {
  // Since the 2026-11-07 layout the everyday controls are on the row and the
  // rare ones are in its "…" menu — still in the row, one click away.
  const CONTROLS: Array<[string, RegExp, 'row' | 'menu']> = [
    ['play', /^Play /, 'row'],
    ['rename', /^Rename$/, 'menu'],
    ['download WAV', /^Download WAV$/, 'menu'],
    ['download MP3', /^Download MP3$/, 'menu'],
    ['download video', /^Video$/, 'row'],
    ['download short', /^Short$/, 'row'],
    ['make video or short', /Video or short for/, 'row'],
    ['edit & re-master', /Edit & re-master/, 'menu'],
  ];

  it.each(CONTROLS)('keeps the %s control', async (_label, name, where) => {
    await openLibrary();
    if (where === 'menu') {
      expect(within(row()).queryByRole('button', { name })).not.toBeInTheDocument();
      fireEvent.click(within(row()).getByRole('button', { name: /^More actions for / }));
    }
    expect(within(row()).getByRole('button', { name })).toBeInTheDocument();
  });

  it('still shows the measurements and the published badge', async () => {
    await openLibrary();
    const r = within(row());
    expect(r.getByText(/LRA/)).toBeInTheDocument();
    expect(r.getByText(/5\.2/)).toBeInTheDocument();
    expect(r.getByText('On site')).toBeInTheDocument();
  });
});

describe('facts and actions are in different zones', () => {
  it('does not put a download link in with the measurements', async () => {
    await openLibrary();
    // The measurement line is the <p> holding LRA. A download link inside it
    // would mean the two zones had collapsed back into one.
    const lra = within(row()).getByText(/LRA/);
    const factLine = lra.closest('p');
    expect(factLine).not.toBeNull();
    expect(within(factLine as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('groups the rendered-file links together, apart from the title', async () => {
    await openLibrary();
    const r = within(row());
    const video = r.getByRole('button', { name: /^Video$/ });
    const short = r.getByRole('button', { name: /^Short$/ });
    expect(video.parentElement).toBe(short.parentElement);

    // ...and the title is not in that container.
    const title = r.getByText(SONG);
    expect(video.parentElement?.contains(title)).toBe(false);
  });
});
