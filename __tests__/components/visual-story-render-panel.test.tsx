/** @jest-environment jsdom */
/**
 * The render panel (Phase 6). Pinned: it says what is missing before offering
 * the button; it shows the server's refusal beside the button; it follows a
 * render to the finished video, including one already running when the page
 * loaded; and a failed render says why.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, act } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { RenderPanel } from '@/components/admin/visual-story/RenderPanel';
import type { Candidate, RenderJob, Shot } from '@/types/visualStory';

const mockFetch = adminFetch as jest.Mock;
const VS = 'vs_1700000000000_abcdef12';
const RD = 'rd_1700000000000_abcdef12';
const C = `audio/mastering/visual-story/${VS}/candidates`;
const story = { aspectRatio: '16:9' as const, windowStartSec: 0, windowEndSec: 30 };

const shot = (shotOrder: number, durationSec: number, selectedCandidateId: string | null): Shot => ({
  sceneOrder: 1, shotOrder, mode: 'HERO', durationSec, startSec: 0, visualPrompt: 'p', negativePrompt: '', charIds: [], selectedCandidateId,
});
const cand = (candId: string, ext: string): Candidate => ({
  candId, sceneOrder: 1, shotOrder: 1, jobId: null, providerId: 'grok', providerTaskId: null, mode: 'HERO',
  s3Key: `${C}/${candId}${ext}`, costUsd: 0, createdAt: '2026-11-06T00:00:00.000Z',
});
const READY_SHOTS = [shot(1, 15, 'cd_a'), shot(2, 15, 'cd_b')];
const CANDS = [cand('cd_a', '.mp4'), cand('cd_b', '.jpg')];
const renderJob = (over: Partial<RenderJob> = {}): RenderJob => ({
  renderId: RD, status: 'running', aspectRatio: '16:9', windowStartSec: 0, windowEndSec: 30, shots: [], estimateSec: 60,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over,
});
const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

function routes(opts: { post?: Response; polls?: RenderJob[] } = {}) {
  const polls = [...(opts.polls ?? [])];
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/admin/mastering/download')) return json({ success: true, url: `https://s3/${url.includes('mode=play') ? 'play' : 'save'}` });
    if (url.endsWith('/render') && init?.method === 'POST') return opts.post ?? json({ success: true, data: { renderId: RD, estimateSec: 60 } });
    if (url.includes(`/render/${RD}`)) return json({ success: true, data: { render: polls.length > 1 ? polls.shift() : polls[0] } });
    return json({});
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
});
afterEach(() => jest.useRealTimers());

it('says what is missing and keeps the button off until every shot has something chosen', () => {
  routes();
  render(<RenderPanel vsId={VS} story={story} shots={[shot(1, 15, 'cd_a'), shot(2, 15, null)]} candidates={CANDS} renders={[]} onChanged={jest.fn()} />);
  expect(screen.getByText('1 of 2 shots need a picture or clip chosen.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Render video' })).toBeDisabled();
});

it('says when the shots do not add up to the story\'s part of the song', () => {
  routes();
  render(<RenderPanel vsId={VS} story={story} shots={[shot(1, 15, 'cd_a')]} candidates={CANDS} renders={[]} onChanged={jest.fn()} />);
  expect(screen.getByText("The shots add up to 0:15 of the song's 0:30.")).toBeInTheDocument();
});

it('renders, follows the render, and shows the finished video with a download', async () => {
  const onChanged = jest.fn();
  routes({ polls: [renderJob({ status: 'running' }), renderJob({ status: 'done', s3Key: `audio/mastering/visual-story/${VS}/renders/${RD}.mp4` })] });
  render(<RenderPanel vsId={VS} story={story} shots={READY_SHOTS} candidates={CANDS} renders={[]} onChanged={onChanged} />);
  expect(screen.getByText(/^Takes about/)).toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Render video' })); });
  expect(screen.getByRole('button', { name: 'Rendering…' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('You can keep working.');

  await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
  await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
  expect(onChanged).toHaveBeenCalled();
  expect(await screen.findByLabelText('Finished video')).toHaveAttribute('src', 'https://s3/play');
  expect(screen.getByRole('button', { name: 'Download video' })).toBeInTheDocument();
});

it('shows the server\'s refusal beside the button', async () => {
  routes({ post: json({ success: false, error: 'A render is already running for this story.' }, false) });
  render(<RenderPanel vsId={VS} story={story} shots={READY_SHOTS} candidates={CANDS} renders={[]} onChanged={jest.fn()} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Render video' })); });
  expect(screen.getByRole('alert')).toHaveTextContent('A render is already running for this story.');
});

it('picks up a render that was already running when the page loaded', async () => {
  const onChanged = jest.fn();
  routes({ polls: [renderJob({ status: 'failed', error: 'Scene 1, shot 2: the picture could not be read.' })] });
  render(<RenderPanel vsId={VS} story={story} shots={READY_SHOTS} candidates={CANDS} renders={[renderJob({ status: 'running' })]} onChanged={onChanged} />);
  expect(screen.getByRole('button', { name: 'Rendering…' })).toBeDisabled();
  await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
  expect(screen.getByRole('alert')).toHaveTextContent('Scene 1, shot 2: the picture could not be read.');
  expect(onChanged).toHaveBeenCalled();
});
