/** @jest-environment jsdom */
/**
 * MasteringStudio — the whole-song vertical, from a library row.
 *
 * ⚠️ WHY THESE EXIST. PR #367 built the whole-song vertical in the route and
 * the worker and said it shipped the UI. It did not: the studio never sent
 * `full: true`, so the feature could not be started from the portal at all and
 * Raj had nothing to test. These pin the button, what it sends, and — the rule
 * this file's sibling exists for — that its refusal lands IN THE ROW.
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
function routeFetch(over: Partial<Record<'masters' | 'rename' | 'play' | 'short' | 'render' | 'job', Response>> = {},
                    masters: unknown[] = [masterFixture()]) {
  mockedFetch.mockImplementation((url: string) => {
    if (url.includes('/masters')) return Promise.resolve(over.masters ?? ok({ success: true, masters }));
    if (url.includes('/rename')) return Promise.resolve(over.rename ?? ok({ success: true, title: 'New name' }));
    if (url.includes('/short')) return Promise.resolve(over.short ?? ok({ success: true }));
    if (/\/master\/job1$/.test(url)) return Promise.resolve(over.job ?? ok({}));
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

/** Open a row's "Video or short" panel, which holds the render/short buttons. */
function openRenderPanel(title: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Video or short for ${title}`) }));
}

beforeEach(() => mockedFetch.mockReset());

const VERTICAL_KEY = 'audio/mastering/out-master-14LUFS-vertical-1920.mp4';
const wholeSongButton = () => screen.getByRole('button', { name: /whole song, vertical/i });
const shortPosts = () =>
  mockedFetch.mock.calls.filter(([url, init]) => String(url).endsWith('/short') && init?.method === 'POST');

describe('the whole-song vertical can be started from a library row', () => {
  it('asks for the WHOLE song — full, and no window', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(wholeSongButton());

    await waitFor(() => expect(shortPosts()).toHaveLength(1));
    const body = JSON.parse(shortPosts()[0][1].body as string);
    expect(body).toEqual({ coverKey: 'audio/mastering/cover.png', full: true });
  });

  it('reports a refusal inside the row, not up in the page header', async () => {
    routeFetch({ short: refuse('Save this master before making a short.') });
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(wholeSongButton());

    await waitFor(() => {
      expect(within(rowFor(SONG)).getByRole('alert')).toHaveTextContent(/Save this master/);
    });
  });

  it('reports a render the worker refused, read from the job', async () => {
    routeFetch({ job: ok({ verticalError: 'The audio duration could not be read.' }) });
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(wholeSongButton());

    await waitFor(() => {
      expect(within(rowFor(SONG)).getByRole('alert')).toHaveTextContent(/duration could not be read/);
    });
  });

  it('offers the finished file in the row, beside the clip rather than instead of it', async () => {
    routeFetch(
      { job: ok({ verticalKey: VERTICAL_KEY, verticalRenderedAt: '2026-10-01T12:00:00.000Z', verticalSeconds: 221.9, verticalError: null }) },
      [masterFixture({ shortKey: 'audio/mastering/out-master-14LUFS-short-1920.mp4' })],
    );
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(wholeSongButton());

    const row = rowFor(SONG);
    await within(row).findByRole('button', { name: /^Vertical$/ });
    expect(within(row).getByRole('button', { name: /^Short$/ })).toBeInTheDocument();
  });

  it('shows a download for a whole-song vertical rendered earlier', async () => {
    routeFetch({}, [masterFixture({ verticalKey: VERTICAL_KEY })]);
    await openLibrary();

    expect(within(rowFor(SONG)).getByRole('button', { name: /^Vertical$/ })).toBeInTheDocument();
  });
});
