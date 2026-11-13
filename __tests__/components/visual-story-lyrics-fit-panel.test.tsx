/** @jest-environment jsdom */
/**
 * Fit to the lyrics (design 2026-11-13): paste the lyrics, listen to the
 * story's song, see what a fit does to each clip, and only then save it.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { LyricsFitPanel } from '@/components/admin/visual-story/LyricsFitPanel';
import fixture from '../fixtures/poovum-lines.json';
import type { Candidate, Shot, VisualStory } from '@/types/visualStory';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const mockFetch = adminFetch as jest.Mock;

const VS = 'vs_1700000000000_abcdef12';
const story = { vsId: VS, windowStartSec: 0, windowEndSec: 180, aspectRatio: '16:9' } as unknown as VisualStory;
const shots: Shot[] = fixture.clipSecs.map((d, i) => ({
  sceneOrder: 1, shotOrder: i + 1, mode: 'HERO', durationSec: d, startSec: 0, visualPrompt: 'p', negativePrompt: '', charIds: [],
  selectedCandidateId: `cd_c${i + 1}`,
}));
const candidates: Candidate[] = fixture.clipSecs.map((d, i) => ({
  candId: `cd_c${i + 1}`, sceneOrder: 1, shotOrder: i + 1, jobId: 'gj', providerId: 'grok', providerTaskId: 't', mode: 'HERO',
  s3Key: `audio/mastering/visual-story/${VS}/candidates/cd_c${i + 1}.mp4`, costUsd: 1, durationSec: d, createdAt: 't',
}));
const LYRICS = fixture.lines.map((l) => l.text).join('\n');
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

let listen: 'idle' | 'running' | 'ready';
let alignStatus: number;
function routes() {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url === '/api/admin/video-text') return json({ projects: [{ id: 'p1', name: 'பூவும் காற்றும்', lyricsText: LYRICS }] });
    if (url.endsWith('/lyric-timing') && !init?.method) return json(listen === 'running' ? { status: 'running', startedAt: 't' } : { status: listen });
    if (url.endsWith('/lyric-timing') && body?.op === 'start') {
      listen = 'running';
      return json({ status: 'running', startedAt: 't' }, 202);
    }
    if (url.endsWith('/lyric-timing') && body?.op === 'align') {
      if (alignStatus !== 200) return json({ error: 'Press Listen to the song first.' }, alignStatus);
      return json({ lines: fixture.lines, heard: 36, total: 36 });
    }
    if (url.endsWith('/shots')) return json({ success: true, data: {} });
    return json({});
  });
}
const posts = () => mockFetch.mock.calls.filter(([, i]) => i?.method === 'POST').map(([u, i]) => ({ url: String(u), body: JSON.parse(String(i.body)) }));
const flush = () => act(async () => { await jest.advanceTimersByTimeAsync(6_000); });

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
  listen = 'idle';
  alignStatus = 200;
  routes();
});
afterEach(() => jest.useRealTimers());

function setup(over: { shots?: Shot[]; candidates?: Candidate[] } = {}) {
  const onChanged = jest.fn();
  render(<LyricsFitPanel vsId={VS} story={story} shots={over.shots ?? shots} candidates={over.candidates ?? candidates} onChanged={onChanged} />);
  return { onChanged };
}

it('listens, fits all 13 clips without a new one, and saves them in one write only on Use these rows', async () => {
  const { onChanged } = setup();
  await flush();
  fireEvent.change(screen.getByLabelText(/Lyrics/), { target: { value: LYRICS } });
  fireEvent.click(screen.getByRole('button', { name: 'Listen to the song' }));
  await flush();
  expect(screen.getByText(/Listening… a 4-minute song takes a few minutes\./)).toBeInTheDocument();
  listen = 'ready';
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Fit the rows' }));
  await flush();
  expect(screen.getByText('36 of 36 lines heard.')).toBeInTheDocument();
  expect(screen.getAllByRole('row')).toHaveLength(14); // header + 13
  expect(screen.queryByText('needs a new clip')).not.toBeInTheDocument();
  expect(screen.getByText('Every cut lands on a line start or in the music.')).toBeInTheDocument();
  expect(posts().filter((p) => p.url.endsWith('/shots'))).toEqual([]);

  fireEvent.click(screen.getByRole('button', { name: 'Use these rows' }));
  await flush();
  const saves = posts().filter((p) => p.url.endsWith('/shots'));
  expect(saves).toHaveLength(1);
  expect(saves[0].body.op).toBe('lengths');
  expect(saves[0].body.lengths).toHaveLength(13);
  expect(onChanged).toHaveBeenCalled();
});

it('fills the lyrics from a Video Text project', async () => {
  setup();
  await flush();
  fireEvent.change(screen.getByLabelText('Use the lyrics from Video Text'), { target: { value: 'p1' } });
  expect((screen.getByLabelText(/Lyrics/) as HTMLTextAreaElement).value).toBe(LYRICS);
});

it('says to listen first, inside the panel, and saves nothing', async () => {
  alignStatus = 409;
  setup();
  await flush();
  fireEvent.change(screen.getByLabelText(/Lyrics/), { target: { value: LYRICS } });
  fireEvent.click(screen.getByRole('button', { name: 'Fit the rows' }));
  await flush();
  expect(screen.getByRole('alert')).toHaveTextContent('Press Listen to the song first.');
  expect(posts().filter((p) => p.url.endsWith('/shots'))).toEqual([]);
});

it('reads the newest clip made for a row, as the pictures panel does, even before it is chosen', async () => {
  // Every row still shows its picture (chosen at Make the video); the clips are made.
  const pics: Candidate[] = shots.map((s) => ({ ...candidates[0], candId: `cd_p${s.shotOrder}`, shotOrder: s.shotOrder, mode: 'STILL', providerId: 'upload', s3Key: `k/cd_p${s.shotOrder}.png`, durationSec: undefined }));
  setup({ shots: shots.map((s) => ({ ...s, selectedCandidateId: `cd_p${s.shotOrder}` })), candidates: [...pics, ...candidates] });
  await flush();
  fireEvent.change(screen.getByLabelText(/Lyrics/), { target: { value: LYRICS } });
  fireEvent.click(screen.getByRole('button', { name: 'Fit the rows' }));
  await flush();
  expect(screen.queryByText('picture')).not.toBeInTheDocument();
  expect(screen.queryByText('needs a new clip')).not.toBeInTheDocument();
});
