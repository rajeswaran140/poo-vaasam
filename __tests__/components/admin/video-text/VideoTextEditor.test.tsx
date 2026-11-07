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
    expect(screen.getByText('Saved')).toBeInTheDocument();

    // The next save carries the version the server returned.
    fireEvent.change(title, { target: { value: 'Song 2' } });
    await act(async () => { jest.advanceTimersByTime(800); });
    expect(bodyOf(calls('PATCH', '/api/admin/video-text/p1')[1][1]).version).toBe(4);
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
    expect(screen.getByText(msg)).toBeInTheDocument();
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
    expect(bodyOf(calls('POST', '/api/admin/video-text/p1/overlays')[0][1])).toEqual({ renderId, blockIds: ['title'] });
    expect(putToS3).toHaveBeenCalledTimes(1);
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

function lastRenderId(): string | undefined {
  const c = calls('POST', '/api/admin/video-text/p1/render').at(-1);
  return c ? bodyOf(c[1]).renderId : undefined;
}
