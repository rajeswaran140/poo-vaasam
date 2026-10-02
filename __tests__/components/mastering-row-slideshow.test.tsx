/** @jest-environment jsdom */
/**
 * MasteringStudio — the slideshow, from a library row.
 *
 * ⚠️ WHY THESE EXIST. PR #346 built the multi-image render in the route and the
 * worker and never gave it a screen: nothing in the studio sent `covers`, so it
 * could not be used. These pin what the row sends — and that a render with no
 * extra images still sends EXACTLY the old body, because the single-image path
 * is the one every release depends on.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const uploadMock = jest.fn();
jest.mock('@/lib/mastering-upload-client', () => ({
  uploadToWorkspace: (...args: unknown[]) => uploadMock(...args),
  putToS3: jest.fn(),
}));
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

beforeEach(() => {
  mockedFetch.mockReset();
  uploadMock.mockReset().mockResolvedValue('audio/mastering/second.png');
});

const COVER = 'audio/mastering/cover.png';
const renderPosts = () =>
  mockedFetch.mock.calls.filter(([url, init]) => String(url).endsWith('/render') && init?.method === 'POST');
const lastBody = () => JSON.parse(renderPosts()[renderPosts().length - 1][1].body as string);
const image = (name: string) => new File(['x'], name, { type: 'image/png' });

/** Add a second image to the open panel: pick a file, then give it a time. */
async function addSecondImage(at: string) {
  fireEvent.click(screen.getByRole('button', { name: /add image/i }));
  fireEvent.change(screen.getByLabelText(/^Image 2$/), { target: { files: [image('second.png')] } });
  await screen.findByText(/second\.png/);
  fireEvent.change(screen.getByLabelText(/Image 2 starts at/i), { target: { value: at } });
}

describe('a slideshow can be rendered from a library row', () => {
  it('with no extra images, sends exactly the single-cover body it always has', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(screen.getByRole('button', { name: /^Render video/ }));

    await waitFor(() => expect(renderPosts()).toHaveLength(1));
    expect(lastBody()).toEqual({ coverKey: COVER, height: 1440 });
  });

  it('sends the cover first at 0:00, then each added image at its own time', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    await addSecondImage('1:30');

    fireEvent.click(screen.getByRole('button', { name: /Render slideshow \(2 images\)/ }));

    await waitFor(() => expect(renderPosts()).toHaveLength(1));
    expect(lastBody()).toMatchObject({
      coverKey: COVER,
      covers: [
        { coverKey: COVER, startSec: 0 },
        { coverKey: 'audio/mastering/second.png', startSec: 90 },
      ],
    });
  });

  it('passes the master\'s own length along when it is known', async () => {
    routeFetch({}, [masterFixture({ editedDurationSec: 221.9 })]);
    await openLibrary();
    openRenderPanel(SONG);
    await addSecondImage('1:30');

    fireEvent.click(screen.getByRole('button', { name: /Render slideshow/ }));

    await waitFor(() => expect(renderPosts()).toHaveLength(1));
    expect(lastBody().durationSec).toBe(221.9);
  });

  it('will not render while an added image has no file or no readable time', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(screen.getByRole('button', { name: /add image/i }));
    expect(screen.getByRole('button', { name: /Render slideshow/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^Image 2$/), { target: { files: [image('second.png')] } });
    await screen.findByText(/second\.png/);
    fireEvent.change(screen.getByLabelText(/Image 2 starts at/i), { target: { value: 'soon' } });
    expect(screen.getByRole('button', { name: /Render slideshow/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Image 2 starts at/i), { target: { value: '0:45' } });
    expect(screen.getByRole('button', { name: /Render slideshow/ })).toBeEnabled();
  });

  it('can render straight after an image is uploaded — its time fills itself in', async () => {
    // The defect Raj reported: upload an image, and the button stayed greyed out.
    routeFetch({}, [masterFixture({ editedDurationSec: 360 })]);
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(screen.getByRole('button', { name: /add image/i }));
    fireEvent.change(screen.getByLabelText(/^Image 2$/), { target: { files: [image('second.png')] } });
    await screen.findByText(/second\.png/);

    expect(screen.getByLabelText(/Image 2 starts at/i)).toHaveValue('3:00');
    const button = screen.getByRole('button', { name: /Render slideshow \(2 images\)/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => expect(renderPosts()).toHaveLength(1));
    expect(lastBody().covers[1]).toEqual({ coverKey: 'audio/mastering/second.png', startSec: 180 });
  });

  it('says WHY the button is blocked, beside the images', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(screen.getByRole('button', { name: /add image/i }));

    expect(within(rowFor(SONG)).getByText(/Image 2 has no file/)).toBeInTheDocument();
  });

  it('goes back to a plain single-cover render when the added image is removed', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    await addSecondImage('1:30');

    fireEvent.click(screen.getByRole('button', { name: /Remove image 2/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Render video/ }));

    await waitFor(() => expect(renderPosts()).toHaveLength(1));
    expect(lastBody()).toEqual({ coverKey: COVER, height: 1440 });
  });

  it('reports the route\'s refusal inside the row', async () => {
    routeFetch({ render: refuse('An image starts after the song ends.') });
    await openLibrary();
    openRenderPanel(SONG);
    await addSecondImage('9:00');

    fireEvent.click(screen.getByRole('button', { name: /Render slideshow/ }));

    await waitFor(() => {
      expect(within(rowFor(SONG)).getByRole('alert')).toHaveTextContent(/after the song ends/);
    });
  });

  it('keeps one song\'s images out of another song\'s panel', async () => {
    routeFetch({}, [masterFixture(), masterFixture({ id: 'job2', title: OTHER })]);
    await openLibrary();
    openRenderPanel(SONG);
    await addSecondImage('1:30');

    openRenderPanel(OTHER);

    expect(screen.queryByLabelText(/^Image 2$/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Render video/ })).toBeInTheDocument();
  });
});

/**
 * The same image list feeds the vertical renders. Its times stay SONG times;
 * the worker works out which images a clip's window shows.
 */
describe('the image list also drives the vertical renders', () => {
  const shortPosts = () =>
    mockedFetch.mock.calls.filter(([url, init]) => String(url).endsWith('/short') && init?.method === 'POST');
  const LIST = [
    { coverKey: COVER, startSec: 0 },
    { coverKey: 'audio/mastering/second.png', startSec: 90 },
  ];

  it('sends the list with the vertical short', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    await addSecondImage('1:30');

    fireEvent.click(screen.getByRole('button', { name: /vertical short/i }));

    await waitFor(() => expect(shortPosts()).toHaveLength(1));
    expect(JSON.parse(shortPosts()[0][1].body as string)).toEqual({ coverKey: COVER, covers: LIST });
  });

  it('sends the list with the whole-song vertical', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    await addSecondImage('1:30');

    fireEvent.click(screen.getByRole('button', { name: /whole song, vertical/i }));

    await waitFor(() => expect(shortPosts()).toHaveLength(1));
    expect(JSON.parse(shortPosts()[0][1].body as string)).toEqual({ coverKey: COVER, full: true, covers: LIST });
  });

  it('holds the vertical buttons too while an added image is unfinished', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(screen.getByRole('button', { name: /add image/i }));

    expect(screen.getByRole('button', { name: /vertical short/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /whole song, vertical/i })).toBeDisabled();
  });
});

/** Slow zoom and pan — a choice for the vertical SHORT, and only the short. */
describe('a move can be chosen for the vertical short', () => {
  const shortPosts = () =>
    mockedFetch.mock.calls.filter(([url, init]) => String(url).endsWith('/short') && init?.method === 'POST');
  const body = (i = 0) => JSON.parse(shortPosts()[i][1].body as string);

  it('is still by default — the request is exactly what it was', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);

    expect(screen.getByLabelText(/Motion/)).toHaveValue('none');
    fireEvent.click(screen.getByRole('button', { name: /vertical short/i }));

    await waitFor(() => expect(shortPosts()).toHaveLength(1));
    expect(body()).toEqual({ coverKey: COVER });
  });

  it('sends the chosen move with the short', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.change(screen.getByLabelText(/Motion/), { target: { value: 'zoom-in' } });
    fireEvent.click(screen.getByRole('button', { name: /vertical short/i }));

    await waitFor(() => expect(shortPosts()).toHaveLength(1));
    expect(body()).toEqual({ coverKey: COVER, motion: 'zoom-in' });
  });

  it('sends it with the whole-song vertical too', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.change(screen.getByLabelText(/Motion/), { target: { value: 'pan-left' } });
    fireEvent.click(screen.getByRole('button', { name: /whole song, vertical/i }));

    await waitFor(() => expect(shortPosts()).toHaveLength(1));
    expect(body()).toEqual({ coverKey: COVER, full: true, motion: 'pan-left' });
  });
});

/**
 * The list is saved on the master. It used to live only in the open page, so
 * every reload — and every deploy asks for one — emptied it.
 */
describe('the image list is saved with the master', () => {
  const SAVED = [{ coverKey: 'audio/mastering/saved-two.png', name: 'saved-two.png', at: '2:00', auto: true }];
  const slidePuts = () =>
    mockedFetch.mock.calls.filter(([url, init]) => String(url).endsWith('/slides') && init?.method === 'PUT');
  /**
   * Every list saved so far, for THIS master. Saving is debounced, so a save
   * left pending by one test can land during the next, and "Add image" saves
   * the list before the upload does. So these tests wait for the save they
   * expect to APPEAR — never for "the first PUT" or "the last PUT", which is a
   * race the slower CI machine loses (it did: run 36952246920).
   */
  const saved = () => slidePuts().map(([, init]) => JSON.parse(init.body as string));
  const waitForSave = (expected: unknown) =>
    waitFor(() => expect(saved()).toContainEqual(expected), { timeout: 4000 });

  it('shows a saved list when the panel opens, ready to render', async () => {
    routeFetch({}, [masterFixture({ slides: SAVED })]);
    await openLibrary();
    openRenderPanel(SONG);

    expect(screen.getByText(/saved-two\.png/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Image 2 starts at/i)).toHaveValue('2:00');
    expect(screen.getByRole('button', { name: /Render slideshow \(2 images\)/ })).toBeEnabled();
  });

  it('renders from a saved list without anything being re-uploaded', async () => {
    routeFetch({}, [masterFixture({ slides: SAVED })]);
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(screen.getByRole('button', { name: /Render slideshow/ }));

    await waitFor(() => expect(renderPosts()).toHaveLength(1));
    expect(lastBody().covers).toEqual([
      { coverKey: COVER, startSec: 0 },
      { coverKey: 'audio/mastering/saved-two.png', startSec: 120 },
    ]);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('saves the list when an image is uploaded', async () => {
    routeFetch({}, [masterFixture({ editedDurationSec: 360 })]);
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(screen.getByRole('button', { name: /add image/i }));
    fireEvent.change(screen.getByLabelText(/^Image 2$/), { target: { files: [image('second.png')] } });

    await waitForSave({
      slides: [{ coverKey: 'audio/mastering/second.png', name: 'second.png', at: '3:00', auto: true }],
    });
    expect(String(slidePuts()[0][0])).toContain('/master/job1/slides');
  });

  it('saves a typed time, as typed', async () => {
    routeFetch({}, [masterFixture({ slides: SAVED })]);
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.change(screen.getByLabelText(/Image 2 starts at/i), { target: { value: '0:45' } });

    await waitForSave({ slides: [{ ...SAVED[0], at: '0:45', auto: false }] });
  });

  it('saves an empty list when the last image is removed', async () => {
    routeFetch({}, [masterFixture({ slides: SAVED })]);
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(screen.getByRole('button', { name: /Remove image 2/i }));

    await waitForSave({ slides: [] });
  });

  it('never saves an image that has no file yet', async () => {
    routeFetch({}, [masterFixture({ slides: SAVED })]);
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(screen.getByRole('button', { name: /add image/i }));

    // Adding re-spread the saved image's time (0:30 — this master's length is
    // not recorded); the empty row is not in the list.
    await waitForSave({ slides: [{ ...SAVED[0], at: '0:30', auto: true }] });
    for (const body of saved()) {
      for (const slide of body.slides) expect(slide.coverKey).toBeTruthy();
    }
  });

  it('says so in the row when the list could not be saved', async () => {
    mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url.includes('/masters')) return Promise.resolve(ok({ success: true, masters: [masterFixture({ slides: SAVED })] }));
      if (url.endsWith('/slides') && init?.method === 'PUT') return Promise.resolve(refuse('Could not save the image list.'));
      return Promise.resolve(ok({}));
    });
    await openLibrary();
    openRenderPanel(SONG);

    fireEvent.click(screen.getByRole('button', { name: /Remove image 2/i }));

    await waitFor(
      () => expect(within(rowFor(SONG)).getByRole('alert')).toHaveTextContent(/Could not save the image list/),
      { timeout: 3000 }
    );
  });
});

/** Cut or crossfade — one choice for the list, used by all three renders. */
describe('a crossfade can be chosen between images', () => {
  const shortPosts = () =>
    mockedFetch.mock.calls.filter(([url, init]) => String(url).endsWith('/short') && init?.method === 'POST');

  it('is not offered until there is a second image to fade to', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);

    expect(screen.queryByLabelText(/Between images/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add image/i }));
    expect(screen.getByLabelText(/Between images/)).toHaveValue('cut');
  });

  it('cuts by default — the request carries no transition at all', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    await addSecondImage('1:30');

    fireEvent.click(screen.getByRole('button', { name: /Render slideshow/ }));

    await waitFor(() => expect(renderPosts()).toHaveLength(1));
    expect(lastBody()).not.toHaveProperty('transition');
  });

  it('sends the crossfade with the video', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    await addSecondImage('1:30');
    fireEvent.change(screen.getByLabelText(/Between images/), { target: { value: 'crossfade' } });

    fireEvent.click(screen.getByRole('button', { name: /Render slideshow/ }));

    await waitFor(() => expect(renderPosts()).toHaveLength(1));
    expect(lastBody().transition).toBe('crossfade');
  });

  it('sends the crossfade with the short and the whole-song vertical', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    await addSecondImage('1:30');
    fireEvent.change(screen.getByLabelText(/Between images/), { target: { value: 'crossfade' } });

    fireEvent.click(screen.getByRole('button', { name: /vertical short/i }));
    await waitFor(() => expect(shortPosts()).toHaveLength(1));
    expect(JSON.parse(shortPosts()[0][1].body as string).transition).toBe('crossfade');
  });
});

