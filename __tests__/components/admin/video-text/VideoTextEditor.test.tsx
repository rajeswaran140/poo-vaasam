/** @jest-environment jsdom */
/**
 * The Video Text editor: what shows before a video exists, text → blocks,
 * autosave (one versioned PATCH per pause, never dropping edits), and the
 * Make video job (one render per press, resumed after a reload, errors under
 * the button).
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/lib/mastering-upload-client', () => ({ putToS3: jest.fn() }));
jest.mock('@/lib/video-text/draw', () => ({
  ensureFonts: jest.fn(),
  renderBlockPng: jest.fn(),
  drawBlock: jest.fn(),
}));

import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { putToS3 } from '@/lib/mastering-upload-client';
import { ensureFonts, renderBlockPng } from '@/lib/video-text/draw';
import { VideoTextEditor } from '@/components/admin/video-text/VideoTextEditor';
import type { RenderState, VideoTextProject } from '@/types/videoText';

const mockedFetch = adminFetch as jest.Mock;
const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

const idleRender: RenderState = {
  renderId: null, status: 'idle', progress: null, outputKey: null,
  outputExpiresAt: null, error: null, startedAt: null, updatedAt: null,
};
const source = {
  key: 'audio/mastering/video-text/p1/source/a.mp4', width: 2560, height: 1440, fps: 30,
  durationSec: 344, hasAudio: true, uploadedAt: '2026-11-07T00:00:00.000Z', expiresAt: '2999-12-07T00:00:00.000Z',
};
const project = (over: Partial<VideoTextProject> = {}): VideoTextProject => ({
  id: 'p1', name: 'My Song', titleText: '', creditsText: '', lyricsText: '', blocks: [],
  style: { sizeScale: 1, lyricPosition: 'lower' }, source, render: idleRender,
  version: 3, createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z', ...over,
});
const titleBlock = { id: 'title', track: 'title' as const, text: 'Song', startSec: 0, endSec: 5 };

type Route = (init: RequestInit | undefined) => Response | Promise<Response>;
let routes: Record<string, Route>;
const calls = (method: string, url: string) =>
  mockedFetch.mock.calls.filter(([u, init]) => u === url && ((init?.method ?? 'GET') === method));
const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body));

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockedFetch.mockReset();
  routes = {
    'GET /api/admin/video-text/p1/source': () => json({ url: 'https://s3/source.mp4' }),
  };
  mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const route = routes[`${init?.method ?? 'GET'} ${url}`];
    if (!route) throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`);
    return route(init);
  });
  (ensureFonts as jest.Mock).mockResolvedValue(undefined);
  (renderBlockPng as jest.Mock).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  (putToS3 as jest.Mock).mockResolvedValue(undefined);
  Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:local'), revokeObjectURL: jest.fn() });
});

it('an empty project shows only Name and Upload', () => {
  render(<VideoTextEditor project={project({ source: null })} onBack={() => {}} />);
  expect(screen.getByLabelText('Name')).toHaveValue('My Song');
  expect(screen.getByLabelText(/Choose a video/i)).toBeInTheDocument();
  expect(screen.queryByLabelText('Title')).toBeNull();
  expect(screen.queryByLabelText('Credits')).toBeNull();
  expect(screen.queryByLabelText('Lyrics')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Make video' })).toBeNull();
  expect(screen.queryByText('Lyrics', { selector: 'span' })).toBeNull();
});

it('shows the uploaded video summary with its deletion date', async () => {
  render(<VideoTextEditor project={project()} onBack={() => {}} />);
  expect(screen.getByText('Video: 1440p · 5:44 · deleted on 7 Dec 2999')).toBeInTheDocument();
  await waitFor(() => expect(calls('GET', '/api/admin/video-text/p1/source')).toHaveLength(1));
});

it('pasting 4 lines into Lyrics gives 4 lyric blocks', async () => {
  render(<VideoTextEditor project={project()} onBack={() => {}} />);
  fireEvent.change(screen.getByLabelText('Lyrics'), { target: { value: 'one\ntwo\n\nthree\nfour\n' } });
  expect(screen.getAllByRole('slider', { name: /^Lyric \d+:/ })).toHaveLength(4);
  expect(screen.getByRole('slider', { name: 'Lyric 3: three' })).toBeInTheDocument();
  await waitFor(() => expect(calls('GET', '/api/admin/video-text/p1/source')).toHaveLength(1));
});

describe('autosave', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends one PATCH 800 ms after the last keystroke, with version', async () => {
    routes['PATCH /api/admin/video-text/p1'] = () => json({ version: 4 });
    render(<VideoTextEditor project={project()} onBack={() => {}} />);
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'So' } });
    await act(async () => { jest.advanceTimersByTime(500); });
    fireEvent.change(title, { target: { value: 'Song' } });
    await act(async () => { jest.advanceTimersByTime(799); });
    expect(calls('PATCH', '/api/admin/video-text/p1')).toHaveLength(0);
    await act(async () => { jest.advanceTimersByTime(1); });
    const patches = calls('PATCH', '/api/admin/video-text/p1');
    expect(patches).toHaveLength(1);
    const body = bodyOf(patches[0][1]);
    expect(body.version).toBe(3);
    expect(body.edits.titleText).toBe('Song');
    expect(body.edits.blocks).toEqual([expect.objectContaining({ id: 'title', text: 'Song' })]);
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('Saved');

    // The next save carries the version the server returned.
    fireEvent.change(title, { target: { value: 'Song 2' } });
    await act(async () => { jest.advanceTimersByTime(800); });
    expect(bodyOf(calls('PATCH', '/api/admin/video-text/p1')[1][1]).version).toBe(4);
  });

  it('choosing a title and credits position saves it, keeping the other style settings', async () => {
    routes['PATCH /api/admin/video-text/p1'] = () => json({ version: 4 });
    render(<VideoTextEditor project={project({ titleText: 'Song', blocks: [titleBlock] })} onBack={() => {}} />);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Title position' })).getByRole('radio', { name: 'Top left' }));
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Credits position' })).getByRole('radio', { name: 'Bottom centre' }),
    );
    await act(async () => { jest.advanceTimersByTime(800); });
    const patches = calls('PATCH', '/api/admin/video-text/p1');
    expect(patches).toHaveLength(1);
    expect(bodyOf(patches[0][1]).edits.style).toEqual({
      sizeScale: 1,
      lyricPosition: 'lower',
      titlePlace: { v: 'top', h: 'left' },
      creditsPlace: { v: 'bottom', h: 'center' },
    });
  });

  it('leaving the editor inside the 800 ms window still saves', async () => {
    routes['PATCH /api/admin/video-text/p1'] = () => json({ version: 4 });
    const { unmount } = render(<VideoTextEditor project={project()} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Late' } });
    await act(async () => { jest.advanceTimersByTime(300); });
    unmount();
    await act(async () => {});
    const patches = calls('PATCH', '/api/admin/video-text/p1');
    expect(patches).toHaveLength(1);
    expect(bodyOf(patches[0][1]).edits.titleText).toBe('Late');
  });

  it('a 409 shows the conflict message and keeps the typed text', async () => {
    const msg = 'This project was changed in another tab — reload to see the latest.';
    routes['PATCH /api/admin/video-text/p1'] = () => json({ error: msg }, 409);
    render(<VideoTextEditor project={project()} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My title' } });
    await act(async () => { jest.advanceTimersByTime(800); });
    await act(async () => {});
    // Under Name (announced) and beside the timeline, where the edit was made.
    expect(screen.getByRole('alert')).toHaveTextContent(msg);
    expect(within(screen.getByTestId('timeline-save-status')).getByText(msg)).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('My title');

    // Not dropped: the next change tries again with everything typed so far.
    fireEvent.change(screen.getByLabelText('Credits'), { target: { value: 'Raj' } });
    await act(async () => { jest.advanceTimersByTime(800); });
    const second = bodyOf(calls('PATCH', '/api/admin/video-text/p1')[1][1]);
    expect(second.edits).toMatchObject({ titleText: 'My title', creditsText: 'Raj' });
  });
});

describe('Make video', () => {
  const p = () => project({ titleText: 'Song', blocks: [titleBlock] });

  it('a double click sends one render POST', async () => {
    routes['POST /api/admin/video-text/p1/overlays'] = (init) =>
      json({ uploads: bodyOf(init).blockIds.map((blockId: string) => ({ blockId, url: 'https://s3', fields: {}, key: `k-${blockId}` })) });
    routes['POST /api/admin/video-text/p1/render'] = () => json({ status: 'queued' }, 202);
    routes['GET /api/admin/video-text/p1'] = () =>
      json({ project: { ...p(), render: { ...idleRender, renderId: lastRenderId(), status: 'done', outputKey: 'k' } } });
    render(<VideoTextEditor project={p()} onBack={() => {}} />);
    const button = screen.getByRole('button', { name: 'Make video' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument());
    expect(calls('POST', '/api/admin/video-text/p1/render')).toHaveLength(1);
    expect(calls('POST', '/api/admin/video-text/p1/overlays')).toHaveLength(1);
    const renderId = bodyOf(calls('POST', '/api/admin/video-text/p1/render')[0][1]).renderId;
    expect(renderId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    // F10: nothing to save, so the version the editor holds.
    expect(bodyOf(calls('POST', '/api/admin/video-text/p1/render')[0][1]).version).toBe(3);
    expect(bodyOf(calls('POST', '/api/admin/video-text/p1/overlays')[0][1])).toEqual({ renderId, blockIds: ['title'] });
    expect(putToS3).toHaveBeenCalledTimes(1);
  });

  it('the burned-in text images are drawn with the chosen title position', async () => {
    const placed = () =>
      project({ titleText: 'Song', blocks: [titleBlock], style: { sizeScale: 1, lyricPosition: 'lower', titlePlace: { v: 'top', h: 'right' } } });
    routes['POST /api/admin/video-text/p1/overlays'] = (init) =>
      json({ uploads: bodyOf(init).blockIds.map((blockId: string) => ({ blockId, url: 'https://s3', fields: {}, key: `k-${blockId}` })) });
    routes['POST /api/admin/video-text/p1/render'] = () => json({ status: 'queued' }, 202);
    routes['GET /api/admin/video-text/p1'] = () =>
      json({ project: { ...placed(), render: { ...idleRender, renderId: lastRenderId(), status: 'done', outputKey: 'k' } } });
    render(<VideoTextEditor project={placed()} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make video' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument());
    expect(renderBlockPng).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'title' }),
      { width: 2560, height: 1440 },
      expect.objectContaining({ titlePlace: { v: 'top', h: 'right' } }),
    );
  });

  it('a render error appears under Make video', async () => {
    routes['POST /api/admin/video-text/p1/overlays'] = () =>
      json({ uploads: [{ blockId: 'title', url: 'https://s3', fields: {}, key: 'k' }] });
    routes['POST /api/admin/video-text/p1/render'] = () => json({ status: 'queued' }, 202);
    routes['GET /api/admin/video-text/p1'] = () =>
      json({ project: { ...p(), render: { ...idleRender, renderId: lastRenderId(), status: 'error', error: 'Part 3 could not be encoded.' } } });
    render(<VideoTextEditor project={p()} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make video' }));
    const section = screen.getByTestId('make-video');
    await waitFor(() => expect(within(section).getByRole('alert')).toHaveTextContent('Part 3 could not be encoded.'));
  });

  it('a refused render start shows its message under Make video', async () => {
    routes['POST /api/admin/video-text/p1/overlays'] = () =>
      json({ uploads: [{ blockId: 'title', url: 'https://s3', fields: {}, key: 'k' }] });
    routes['POST /api/admin/video-text/p1/render'] = () => json({ error: 'A render is already running.' }, 409);
    render(<VideoTextEditor project={p()} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make video' }));
    await waitFor(() =>
      expect(within(screen.getByTestId('make-video')).getByRole('alert')).toHaveTextContent('A render is already running.')
    );
  });

  it('holds autosave while the render is starting, then saves once the worker has the blocks', async () => {
    jest.useFakeTimers();
    let status: RenderState['status'] = 'queued';
    routes['POST /api/admin/video-text/p1/overlays'] = () =>
      json({ uploads: [{ blockId: 'title', url: 'https://s3', fields: {}, key: 'k' }] });
    routes['POST /api/admin/video-text/p1/render'] = () => json({ status: 'queued' }, 202);
    routes['GET /api/admin/video-text/p1'] = () =>
      json({ project: { ...p(), render: { ...idleRender, renderId: lastRenderId(), status, updatedAt: new Date().toISOString() } } });
    routes['PATCH /api/admin/video-text/p1'] = () => json({ version: 4 });
    render(<VideoTextEditor project={p()} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make video' }));
    await waitFor(() => expect(calls('GET', '/api/admin/video-text/p1')).toHaveLength(1));

    // Still queued: the worker has not read the stored blocks yet.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed' } });
    await act(async () => { jest.advanceTimersByTime(800); });
    expect(calls('PATCH', '/api/admin/video-text/p1')).toHaveLength(0);
    expect(screen.getByLabelText('Title')).toHaveValue('Changed');
    expect(within(screen.getByTestId('timeline-save-status')).getByText('Changes will save when the render starts')).toBeInTheDocument();

    // The worker has moved on: the held edit is saved.
    status = 'encoding';
    await act(async () => { jest.advanceTimersByTime(4000); });
    await waitFor(() => expect(screen.getByText(/Encoding/)).toBeInTheDocument());
    await act(async () => { jest.advanceTimersByTime(800); });
    const patches = calls('PATCH', '/api/admin/video-text/p1');
    expect(patches).toHaveLength(1);
    expect(bodyOf(patches[0][1]).edits.titleText).toBe('Changed');
    jest.useRealTimers();
  });

  it('renders exactly one saved state: an edit typed during an in-flight save is PATCHed, then drawn', async () => {
    jest.useFakeTimers();
    const patched: Array<{ version: number; edits: VideoTextProject }> = [];
    let release!: (r: Response) => void;
    routes['PATCH /api/admin/video-text/p1'] = (init) => {
      patched.push(bodyOf(init));
      return patched.length === 1 ? new Promise<Response>((r) => { release = r; }) : json({ version: 5 });
    };
    routes['POST /api/admin/video-text/p1/overlays'] = (init) =>
      json({ uploads: bodyOf(init).blockIds.map((blockId: string) => ({ blockId, url: 'https://s3', fields: {}, key: `k-${blockId}` })) });
    routes['POST /api/admin/video-text/p1/render'] = () => json({ status: 'queued' }, 202);
    routes['GET /api/admin/video-text/p1'] = () =>
      json({ project: { ...p(), render: { ...idleRender, renderId: lastRenderId(), status: 'done', outputKey: 'k' } } });
    render(<VideoTextEditor project={p()} onBack={() => {}} />);

    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'First' } });
    await act(async () => { jest.advanceTimersByTime(800); });
    expect(patched).toHaveLength(1); // in flight, unanswered
    fireEvent.change(title, { target: { value: 'Second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make video' }));
    await act(async () => {});
    expect(renderBlockPng).not.toHaveBeenCalled(); // waits for the save in flight
    // Typed after the click, still before the in-flight save settles: it is
    // part of the state that gets saved, so it must be what is drawn.
    fireEvent.change(title, { target: { value: 'Third' } });

    await act(async () => { release(json({ version: 4 })); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument());
    expect(patched).toHaveLength(2);
    expect(patched[1].version).toBe(4);
    expect(patched[1].edits.titleText).toBe('Third');
    const drawn = (renderBlockPng as jest.Mock).mock.calls.map((c) => c[0]);
    expect(drawn).toEqual(patched[1].edits.blocks);
    expect(drawn[0]).toMatchObject({ id: 'title', text: 'Third' });
    // F10: the render claims the version that save returned.
    expect(bodyOf(calls('POST', '/api/admin/video-text/p1/render')[0][1]).version).toBe(5);
    expect(bodyOf(calls('POST', '/api/admin/video-text/p1/overlays')[0][1]).blockIds).toEqual(['title']);
    jest.useRealTimers();
  });

  it('a 409 on the pre-render save stops the render with the conflict message under Make video', async () => {
    const msg = 'This project was changed in another tab — reload to see the latest.';
    routes['PATCH /api/admin/video-text/p1'] = () => json({ error: msg }, 409);
    render(<VideoTextEditor project={p()} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make video' }));
    await waitFor(() => expect(within(screen.getByTestId('make-video')).getByRole('alert')).toHaveTextContent(msg));
    expect(renderBlockPng).not.toHaveBeenCalled();
    expect(calls('POST', '/api/admin/video-text/p1/overlays')).toHaveLength(0);
  });

  it('leaving during the hold does not save the held edit, and closing the tab is warned', async () => {
    jest.useFakeTimers();
    routes['POST /api/admin/video-text/p1/overlays'] = () =>
      json({ uploads: [{ blockId: 'title', url: 'https://s3', fields: {}, key: 'k' }] });
    routes['POST /api/admin/video-text/p1/render'] = () => json({ status: 'queued' }, 202);
    routes['GET /api/admin/video-text/p1'] = () =>
      json({ project: { ...p(), render: { ...idleRender, renderId: lastRenderId(), status: 'queued', updatedAt: new Date().toISOString() } } });
    routes['PATCH /api/admin/video-text/p1'] = () => json({ version: 4 });
    const { unmount } = render(<VideoTextEditor project={p()} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make video' }));
    await waitFor(() => expect(calls('GET', '/api/admin/video-text/p1')).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Held' } });
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    unmount();
    await act(async () => {});
    expect(calls('PATCH', '/api/admin/video-text/p1')).toHaveLength(0);
    jest.useRealTimers();
  });

  it('mounting with an encoding render resumes polling and shows Encoding', async () => {
    const now = new Date().toISOString();
    const inFlight: RenderState = {
      ...idleRender, renderId: 'r1', status: 'encoding', progress: { done: 7, total: 18 }, startedAt: now, updatedAt: now,
    };
    routes['GET /api/admin/video-text/p1'] = () => json({ project: { ...p(), render: inFlight } });
    render(<VideoTextEditor project={{ ...p(), render: inFlight }} onBack={() => {}} />);
    expect(within(screen.getByTestId('make-video')).getByText(/Encoding 7\/18 · 0:0\d/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make video' })).toBeDisabled();
    await waitFor(() => expect(calls('GET', '/api/admin/video-text/p1').length).toBeGreaterThan(0));
    expect(renderBlockPng).not.toHaveBeenCalled();
  });
});

it('an expired preview link is fetched again and playback resumes from the same spot', async () => {
  let n = 0;
  routes['GET /api/admin/video-text/p1/source'] = () => json({ url: `https://s3/source-${++n}.mp4` });
  const { container } = render(<VideoTextEditor project={project()} onBack={() => {}} />);
  await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'https://s3/source-1.mp4'));
  const video = container.querySelector('video')!;
  video.currentTime = 42;
  // An hour later the link has expired and the next range request fails.
  const realNow = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow + 61 * 60 * 1000);
  await act(async () => { fireEvent.error(video); });
  await waitFor(() => expect(video).toHaveAttribute('src', 'https://s3/source-2.mp4'));
  fireEvent.loadedMetadata(video);
  expect(video.currentTime).toBe(42);

  // A second failure straight away is not an expiry: say so, do not loop.
  await act(async () => { fireEvent.error(video); });
  expect(screen.getByRole('alert')).toHaveTextContent('The video could not be played — reload the page to try again.');
  expect(calls('GET', '/api/admin/video-text/p1/source')).toHaveLength(2);
  clock.mockRestore();
});

describe('leaving with unsaved edits', () => {
  it('"All projects" asks first, and stays on "Cancel"', async () => {
    jest.useFakeTimers();
    routes['PATCH /api/admin/video-text/p1'] = () => json({ version: 4 });
    const onBack = jest.fn();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<VideoTextEditor project={project()} onBack={onBack} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: /All projects/ }));
    expect(confirm).toHaveBeenCalledWith('You have unsaved changes. Leave anyway?');
    expect(onBack).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /All projects/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
    jest.useRealTimers();
  });

  it('with nothing unsaved, "All projects" leaves without asking; the guard says go', async () => {
    const onBack = jest.fn();
    const confirm = jest.spyOn(window, 'confirm');
    const guard: { current: (() => boolean) | null } = { current: null };
    render(<VideoTextEditor project={project()} onBack={onBack} leaveGuard={guard} />);
    expect(guard.current?.()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /All projects/ }));
    expect(onBack).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
    await waitFor(() => expect(calls('GET', '/api/admin/video-text/p1/source')).toHaveLength(1));
  });
});

it('Make video is disabled while an upload saves its pending edits first', async () => {
  jest.useFakeTimers();
  let release!: (r: Response) => void;
  routes['PATCH /api/admin/video-text/p1'] = () => new Promise<Response>((r) => { release = r; });
  routes['POST /api/admin/video-text/p1/upload'] = () => json({ error: 'stop here' }, 400);
  render(<VideoTextEditor project={project({ titleText: 'Song', blocks: [titleBlock] })} onBack={() => {}} />);
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Pending' } });
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/Choose a video/i), { target: { files: [new File(['x'], 'a.mp4', { type: 'video/mp4' })] } });
  });
  expect(calls('PATCH', '/api/admin/video-text/p1')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Make video' })).toBeDisabled();
  await act(async () => { release(json({ version: 4 })); });
  await waitFor(() => expect(screen.getByText('stop here')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Make video' })).toBeEnabled();
  jest.useRealTimers();
});

describe('Download', () => {
  const done = (updatedAt: string): RenderState => ({
    ...idleRender, renderId: 'r1', status: 'done', outputKey: 'audio/mastering/video-text/p1/render-r1/output.mp4',
    outputExpiresAt: '2999-12-08T00:00:00.000Z', updatedAt,
  });

  it('is hidden when the video was uploaded after the render finished', () => {
    render(<VideoTextEditor project={project({ render: done('2026-11-06T00:00:00.000Z') })} onBack={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('downloads through a link and does not trigger the unsaved-changes warning', async () => {
    jest.useFakeTimers();
    routes['GET /api/admin/video-text/p1/download'] = () => json({ url: 'https://s3/out.mp4' });
    routes['PATCH /api/admin/video-text/p1'] = () => json({ version: 4 });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<VideoTextEditor project={project({ render: done('2026-11-08T00:00:00.000Z') })} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unsaved' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download' })); });
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect((click.mock.contexts[0] as HTMLAnchorElement).href).toBe('https://s3/out.mp4');
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
    click.mockRestore();
    jest.useRealTimers();
  });
});

it('F6: says how many lines do not fit in a very short video', async () => {
  render(<VideoTextEditor project={project({ source: { ...source, durationSec: 5 } })} onBack={() => {}} />);
  const lines = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
  fireEvent.change(screen.getByLabelText('Lyrics'), { target: { value: lines } });
  expect(screen.getAllByRole('slider', { name: /^Lyric \d+:/ })).toHaveLength(10);
  expect(screen.getByText(/^10 lines have no room on the timeline\. Make a gap of at least half a second where they go/)).toBeInTheDocument();
  await waitFor(() => expect(calls('GET', '/api/admin/video-text/p1/source')).toHaveLength(1));
});

it('a re-upload that moved one line says so in the singular', async () => {
  routes['POST /api/admin/video-text/p1/upload'] = () => json({ url: 'https://s3', fields: {}, key: 'audio/mastering/video-text/p1/source/c.mp4' });
  routes['POST /api/admin/video-text/p1/source'] = () =>
    json({ source: { ...source, durationSec: 200 }, blocks: [titleBlock], moved: 1, version: 9 });
  routes['PATCH /api/admin/video-text/p1'] = () => json({ version: 10 });
  render(<VideoTextEditor project={project({ titleText: 'Song', blocks: [titleBlock] })} onBack={() => {}} />);
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/Choose a video/i), { target: { files: [new File(['x'], 'b.mp4', { type: 'video/mp4' })] } });
  });
  expect(await screen.findByText('1 line was past the new end and was moved inside the video.')).toBeInTheDocument();
});

it('a re-upload that moved lines says so', async () => {
  routes['POST /api/admin/video-text/p1/upload'] = () => json({ url: 'https://s3', fields: { a: 'b' }, key: 'audio/mastering/video-text/p1/source/b.mp4' });
  routes['POST /api/admin/video-text/p1/source'] = () =>
    json({ source: { ...source, durationSec: 200 }, blocks: [titleBlock], moved: 3, version: 9 });
  routes['PATCH /api/admin/video-text/p1'] = () => json({ version: 10 });
  render(<VideoTextEditor project={project({ titleText: 'Song', blocks: [titleBlock] })} onBack={() => {}} />);
  const file = new File(['x'], 'song.mp4', { type: 'video/mp4' });
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/Choose a video/i), { target: { files: [file] } });
  });
  expect(await screen.findByText('3 lines were past the new end and were moved inside the video.')).toBeInTheDocument();
  expect(bodyOf(calls('POST', '/api/admin/video-text/p1/upload')[0][1])).toEqual({ filename: 'song.mp4', contentType: 'video/mp4', size: 1 });
  expect(bodyOf(calls('POST', '/api/admin/video-text/p1/source')[0][1])).toEqual({ key: 'audio/mastering/video-text/p1/source/b.mp4' });
  expect(screen.getByText('Video: 1440p · 3:20 · deleted on 7 Dec 2999')).toBeInTheDocument();
});

it('F11: a 503 from the check offers Try again, which re-checks the same key without re-uploading', async () => {
  const key = 'audio/mastering/video-text/p1/source/b.mp4';
  routes['POST /api/admin/video-text/p1/upload'] = () => json({ url: 'https://s3', fields: { a: 'b' }, key });
  let checks = 0;
  routes['POST /api/admin/video-text/p1/source'] = () =>
    ++checks === 1
      ? json({ error: 'The video could not be checked just now — press Try again.' }, 503)
      : json({ source: { ...source, durationSec: 200 }, blocks: [titleBlock], moved: 0, version: 9 });
  render(<VideoTextEditor project={project({ titleText: 'Song', blocks: [titleBlock] })} onBack={() => {}} />);
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/Choose a video/i), { target: { files: [new File(['x'], 'b.mp4', { type: 'video/mp4' })] } });
  });
  expect(await screen.findByText('The video could not be checked just now — press Try again.')).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  });
  expect(await screen.findByText('Video: 1440p · 3:20 · deleted on 7 Dec 2999')).toBeInTheDocument();
  expect(calls('POST', '/api/admin/video-text/p1/upload')).toHaveLength(1);
  const checked = calls('POST', '/api/admin/video-text/p1/source').map(([, init]) => bodyOf(init));
  expect(checked).toEqual([{ key }, { key }]);
});

function lastRenderId(): string | undefined {
  const c = calls('POST', '/api/admin/video-text/p1/render').at(-1);
  return c ? bodyOf(c[1]).renderId : undefined;
}

describe('audit fixes: timing survives text edits, uploads can be cancelled, older downloads are flagged', () => {
  const hand = [
    { id: 'lyric-0', track: 'lyric' as const, text: 'one', startSec: 10, endSec: 14 },
    { id: 'lyric-1', track: 'lyric' as const, text: 'two', startSec: 20, endSec: 26 },
    { id: 'lyric-2', track: 'lyric' as const, text: 'three', startSec: 30, endSec: 33 },
  ];

  it('deleting a lyric line leaves every other line at its hand-set time', () => {
    render(<VideoTextEditor project={project({ lyricsText: 'one\ntwo\nthree', blocks: hand })} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText('Lyrics'), { target: { value: 'one\nthree' } });
    expect(screen.getByRole('slider', { name: 'Lyric 1: one' })).toHaveAttribute('aria-valuetext', '0:10.0 to 0:14.0');
    expect(screen.getByRole('slider', { name: 'Lyric 2: three' })).toHaveAttribute('aria-valuetext', '0:30.0 to 0:33.0');
  });

  it('clearing a line and typing it again puts it back at its old time', () => {
    render(<VideoTextEditor project={project({ lyricsText: 'one\ntwo\nthree', blocks: hand })} onBack={() => {}} />);
    const box = screen.getByLabelText('Lyrics');
    fireEvent.change(box, { target: { value: 'one\n\nthree' } });
    fireEvent.change(box, { target: { value: 'one\nt\nthree' } });
    expect(screen.getByRole('slider', { name: 'Lyric 2: t' })).toHaveAttribute('aria-valuetext', '0:20.0 to 0:26.0');
  });

  it('a cleared title typed again keeps its whole-video timing', () => {
    const whole = { ...titleBlock, startSec: 0, endSec: 344 };
    render(<VideoTextEditor project={project({ titleText: 'Song', blocks: [whole] })} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'S' } });
    expect(screen.getByRole('slider', { name: 'Title: S' })).toHaveAttribute('aria-valuetext', '0:00.0 to 5:44.0');
  });

  it('while a new video uploads: Cancel upload stops it, the timeline is locked, and leaving asks first', async () => {
    routes['PATCH /api/admin/video-text/p1'] = () => json({ version: 4 });
    routes['POST /api/admin/video-text/p1/upload'] = () => json({ url: 'https://s3', fields: {}, key: 'audio/mastering/video-text/p1/source/n.mp4' });
    let signal: AbortSignal | undefined;
    (putToS3 as jest.Mock).mockImplementation(
      (_u: string, _f: unknown, _file: File, _p: unknown, s: AbortSignal) =>
        new Promise((_, reject) => {
          signal = s;
          s.addEventListener('abort', () => reject(new Error('Upload cancelled.')));
        }),
    );
    const onBack = jest.fn();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<VideoTextEditor project={project({ titleText: 'Song', blocks: [titleBlock] })} onBack={onBack} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Choose a video/i), { target: { files: [new File(['x'], 'n.mp4', { type: 'video/mp4' })] } });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel upload' })).toBeInTheDocument());
    expect(screen.getByTestId('timeline-locked')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-wrap')).toHaveAttribute('inert');

    // Leaving mid-upload asks; saying no stays.
    fireEvent.click(screen.getByRole('button', { name: /All projects/ }));
    expect(confirm).toHaveBeenCalledWith('The video is still uploading. Leave and stop the upload?');
    expect(onBack).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel upload' }));
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByText('Upload cancelled. Choose the video again to upload it.')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-locked')).toBeNull();
    confirm.mockRestore();
  });

  it('Download says it is the older video once something changes after the render', () => {
    const doneRender: RenderState = {
      ...idleRender, renderId: 'r1', status: 'done', outputKey: 'audio/mastering/video-text/p1/render-r1/output.mp4',
      outputExpiresAt: '2999-12-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z',
    };
    render(<VideoTextEditor project={project({ titleText: 'Song', blocks: [titleBlock], render: doneRender })} onBack={() => {}} />);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByTestId('download-older')).toBeNull();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Song 2' } });
    expect(screen.getByTestId('download-older')).toHaveTextContent(
      'This is the video made before your latest changes. Press Make video to include them.',
    );
  });

  it('Download is flagged on load when the project was saved after the render', () => {
    const doneRender: RenderState = {
      ...idleRender, renderId: 'r1', status: 'done', outputKey: 'k',
      outputExpiresAt: '2999-12-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z',
    };
    render(<VideoTextEditor project={project({ render: doneRender, updatedAt: '2026-11-08T01:00:00.000Z' })} onBack={() => {}} />);
    expect(screen.getByTestId('download-older')).toBeInTheDocument();
  });
});
