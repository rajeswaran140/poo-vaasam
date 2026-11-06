/** @jest-environment jsdom */
/**
 * MasteringStudio — a video background, from a library row (where saved
 * masters are worked from). The row sends the background beside the cover —
 * the cover stays, it is the YouTube thumbnail — to all three renders, and a
 * render without one still sends EXACTLY the old body.
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

import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MasteringStudio } from '@/components/admin/MasteringStudio';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;

const SONG = 'ஈழத்து மண்ணே';

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

const BG = 'audio/mastering/loop.mov';
const clip = (name: string, type = 'video/quicktime') => new File(['x'], name, { type });
const shortPosts = () =>
  mockedFetch.mock.calls.filter(([url, init]) => String(url).endsWith('/short') && init?.method === 'POST');

async function pickBackground() {
  uploadMock.mockResolvedValueOnce(BG);
  fireEvent.change(screen.getByLabelText(/Background video or GIF for/i), { target: { files: [clip('loop.mov')] } });
  await screen.findByText(/loop\.mov/);
}

describe('a video background from a library row', () => {
  it('uploads as a background, not a cover', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    await pickBackground();
    expect(uploadMock).toHaveBeenCalledWith(expect.any(File), expect.any(Function), expect.any(AbortSignal), 'background');
  });

  it('sends the background beside the cover, and says so on the button', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    await pickBackground();

    fireEvent.click(screen.getByRole('button', { name: /^Render video \(1440p, video background\)/ }));
    await waitFor(() => expect(renderPosts()).toHaveLength(1));
    expect(lastBody()).toEqual({ coverKey: COVER, height: 1440, backgroundKey: BG });
  });

  it('sends it to the short and the whole-song vertical too', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    await pickBackground();

    fireEvent.click(screen.getByRole('button', { name: /Make vertical short/ }));
    await waitFor(() => expect(shortPosts()).toHaveLength(1));
    expect(JSON.parse(shortPosts()[0][1].body as string)).toMatchObject({ coverKey: COVER, backgroundKey: BG });
  });

  it('can be removed, and then the old body is sent', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    await pickBackground();
    fireEvent.click(screen.getByRole('button', { name: /Remove background/ }));

    fireEvent.click(screen.getByRole('button', { name: /^Render video \(1440p\)/ }));
    await waitFor(() => expect(renderPosts()).toHaveLength(1));
    expect(lastBody()).toEqual({ coverKey: COVER, height: 1440 });
  });

  it('shows a refusal in the row, where the button is', async () => {
    routeFetch({ render: refuse('A video background already moves — set Motion to None.') });
    await openLibrary();
    openRenderPanel(SONG);
    await pickBackground();
    fireEvent.click(screen.getByRole('button', { name: /^Render video/ }));
    expect(await within(rowFor(SONG)).findByText(/already moves/)).toBeInTheDocument();
  });

  it('keeps the background when the cover is replaced', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    await pickBackground();
    uploadMock.mockResolvedValueOnce('audio/mastering/new-cover.png');
    fireEvent.change(screen.getByLabelText(/Cover for/), { target: { files: [image('new-cover.png')] } });
    await screen.findByText(/new-cover\.png/);

    fireEvent.click(screen.getByRole('button', { name: /^Render video/ }));
    await waitFor(() => expect(renderPosts()).toHaveLength(1));
    expect(lastBody()).toMatchObject({ coverKey: 'audio/mastering/new-cover.png', backgroundKey: BG });
  });
});

describe('a background upload shows its progress', () => {
  it('says how far it has got, in the row, and clears when done', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    let finish: (key: string) => void = () => {};
    uploadMock.mockImplementationOnce((_f: File, onProgress: (l: number, t: number) => void) => {
      onProgress(42, 100);
      return new Promise<string>((resolve) => { finish = resolve; });
    });
    fireEvent.change(screen.getByLabelText(/Background video or GIF for/i), { target: { files: [clip('loop.mov')] } });
    expect(await within(rowFor(SONG)).findByText('Uploading background… 42%')).toBeInTheDocument();

    await act(async () => { finish(BG); });
    await screen.findByText(/loop\.mov/);
    expect(screen.queryByText(/Uploading background/)).toBeNull();
  });
});

describe('a row remembers its background', () => {
  it('reopens with the background its last render used, named, and sends it again', async () => {
    routeFetch({}, [masterFixture({ videoBackgroundKey: 'audio/mastering/1700000000000_ab12cd34_loop.mov' })]);
    await openLibrary();
    openRenderPanel(SONG);
    expect(within(rowFor(SONG)).getByText('loop.mov')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Make vertical short/ }));
    await waitFor(() => expect(shortPosts()).toHaveLength(1));
    expect(JSON.parse(shortPosts()[0][1].body as string)).toMatchObject({
      backgroundKey: 'audio/mastering/1700000000000_ab12cd34_loop.mov',
    });
  });

  it('opens with none when no render used one', async () => {
    routeFetch();
    await openLibrary();
    openRenderPanel(SONG);
    expect(screen.getByLabelText(/Background video or GIF for/)).toBeInTheDocument();
  });
});

describe('a background video is labelled in its row', () => {
  it('says so on the row\'s video link', async () => {
    routeFetch({}, [masterFixture({ videoKey: 'audio/mastering/out-master-14LUFS-1440p.mp4', videoMotion: 'none', videoBackgroundKey: BG })]);
    await openLibrary();
    expect(within(rowFor(SONG)).getByRole('button', { name: /^Video \(video background\)$/ })).toBeInTheDocument();
  });
});
