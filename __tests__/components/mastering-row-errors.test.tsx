/** @jest-environment jsdom */
/**
 * MasteringStudio — a library row reports its OWN failure, in the row.
 *
 * ⚠️ WHY THESE EXIST. Every row action used to call `setError`, which paints
 * the banner under the page header — about 1,600 lines of JSX above the button
 * that was clicked. The operator saw "Working…" appear and then nothing, so the
 * page looked broken while it was in fact reporting the refusal off-screen.
 *
 * That is how the vertical short for இன்னுமொரு கருவறையில் was lost on
 * 2026-09-19: the refusal was never read, so its cause was never known, and a
 * day went into ruling out things the message would have named.
 *
 * So these tests do NOT assert "the message is on the page somewhere" — that
 * was already true while the defect was live. They assert the alert is a
 * DESCENDANT OF THE ROW, which is the only thing that actually failed.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/components/admin/MasteringComparePlayer', () => ({
  MasteringComparePlayer: () => null,
}));

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MasteringStudio } from '@/components/admin/MasteringStudio';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;

const SONG = 'ஈழத்து மண்ணே';
const OTHER = 'செவ்வந்தி பூவே';

function masterFixture(over: Record<string, unknown> = {}) {
  return {
    id: 'job1',
    status: 'done',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    s3Key: 'audio/mastering/in.wav',
    target: -14,
    masterKey: 'audio/mastering/out-master-14LUFS.wav',
    // Seeds the row's cover, so the render/short buttons are enabled without
    // an upload — the PR #327 behaviour these tests depend on.
    coverKey: 'audio/mastering/cover.png',
    beforeLufs: -17.9, beforeTp: -1.2, afterLufs: -14, afterTp: -1,
    beforeLra: 3, afterLra: 3, normalizationType: 'linear',
    source: null, savedAt: '2026-07-30T16:23:17.054Z',
    title: SONG, error: null,
    ...over,
  };
}

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const refuse = (error: string) => ({ ok: false, json: async () => ({ success: false, error }) }) as Response;

/**
 * Routes by URL fragment. Anything not overridden succeeds, so a test only
 * describes the ONE call it is making fail.
 */
function routeFetch(over: Partial<Record<'masters' | 'rename' | 'play' | 'short' | 'render', Response>> = {},
                    masters: unknown[] = [masterFixture()]) {
  mockedFetch.mockImplementation((url: string) => {
    if (url.includes('/masters')) return Promise.resolve(over.masters ?? ok({ success: true, masters }));
    if (url.includes('/rename')) return Promise.resolve(over.rename ?? ok({ success: true, title: 'New name' }));
    if (url.includes('/short')) return Promise.resolve(over.short ?? ok({ success: true }));
    if (url.includes('/render')) return Promise.resolve(over.render ?? ok({ success: true }));
    if (url.includes('/mastering/download')) {
      return Promise.resolve(over.play ?? ok({ success: true, url: 'https://s3/pre?sig=1' }));
    }
    return Promise.resolve(ok({}));
  });
}

async function openLibrary() {
  render(<MasteringStudio />);
  fireEvent.click(screen.getByRole('button', { name: /Saved masters/i }));
  await screen.findAllByText(SONG);
}

/**
 * The <li> for a song. The title appears twice — once as the group heading,
 * once on the row — and only the row one sits inside an <li>, which is exactly
 * the distinction under test.
 */
function rowFor(title: string): HTMLElement {
  for (const node of screen.getAllByText(title)) {
    const li = node.closest('li');
    if (li) return li as HTMLElement;
  }
  throw new Error(`no row <li> found for ${title}`);
}

/**
 * The <li> the alert actually lives in. Used where the row cannot be found by
 * its title — while renaming, the title is replaced by an input, so it is no
 * longer text on the page. This asserts the same property from the other end:
 * the alert sits inside a ROW rather than up in the page header.
 */
function rowHoldingTheAlert(): HTMLElement {
  const alert = screen.getByRole('alert');
  const li = alert.closest('li');
  if (!li) throw new Error('the alert is not inside a row — it rendered at page level');
  return li as HTMLElement;
}

/** Open a row's "Video or short" panel, which holds the render/short buttons. */
function openRenderPanel(title: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Video or short for ${title}`) }));
}

beforeEach(() => mockedFetch.mockReset());

describe('a row failure is reported in the row that failed', () => {
  it('rename — the refusal is inside the row, not only on the page', async () => {
    routeFetch({ rename: refuse('Only a saved master can be renamed') });
    await openLibrary();

    fireEvent.click(screen.getByRole('button', { name: /^Rename/ }));
    const input = screen.getByLabelText('Master name');
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      const row = rowHoldingTheAlert();
      expect(within(row).getByRole('alert')).toHaveTextContent(/Only a saved master can be renamed/);
      // ...and it is the row being renamed, not some other row's.
      expect(within(row).getByLabelText('Master name')).toBeInTheDocument();
    });
  });

  it('play — a failed presign is reported in the row', async () => {
    routeFetch({ play: refuse('Could not open that master.') });
    await openLibrary();

    fireEvent.click(screen.getByRole('button', { name: /^Play/ }));

    await waitFor(() => {
      expect(within(rowFor(SONG)).getByRole('alert')).toHaveTextContent(/Could not open that master/);
    });
  });

  it('short — the refusal that cost a real short is in the row', async () => {
    routeFetch({ short: refuse('bad-window: the window ends past the track') });
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(screen.getByRole('button', { name: /vertical short/i }));

    await waitFor(() => {
      expect(within(rowFor(SONG)).getByRole('alert')).toHaveTextContent(/bad-window/);
    });
  });

  it('render video — the refusal is in the row', async () => {
    routeFetch({ render: refuse('That cover is not a usable image.') });
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(screen.getByRole('button', { name: /Render video/i }));

    await waitFor(() => {
      expect(within(rowFor(SONG)).getByRole('alert')).toHaveTextContent(/not a usable image/);
    });
  });
});

describe('a row failure belongs to ONE row', () => {
  const two = [masterFixture(), masterFixture({ id: 'job2', title: OTHER })];

  it('never paints its error on a different song', async () => {
    routeFetch({ play: refuse('Could not open that master.') }, two);
    render(<MasteringStudio />);
    fireEvent.click(screen.getByRole('button', { name: /Saved masters/i }));
    await screen.findAllByText(OTHER);

    // Fail the FIRST row only.
    fireEvent.click(within(rowFor(SONG)).getByRole('button', { name: /^Play/ }));

    await waitFor(() => {
      expect(within(rowFor(SONG)).getByRole('alert')).toBeInTheDocument();
    });
    expect(within(rowFor(OTHER)).queryByRole('alert')).toBeNull();
  });

  it('clears the previous refusal when the row is retried', async () => {
    routeFetch({ play: refuse('Could not open that master.') });
    await openLibrary();

    fireEvent.click(screen.getByRole('button', { name: /^Play/ }));
    await waitFor(() => expect(within(rowFor(SONG)).getByRole('alert')).toBeInTheDocument());

    // Second attempt succeeds — a stale refusal beside a working row reads as
    // a failure that did not happen.
    routeFetch();
    fireEvent.click(screen.getByRole('button', { name: /^Play/ }));

    await waitFor(() => {
      expect(within(rowFor(SONG)).queryByRole('alert')).toBeNull();
    });
  });
});
