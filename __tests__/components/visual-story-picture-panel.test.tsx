/** @jest-environment jsdom */
/**
 * "Video from your pictures": upload several pictures, set each one's seconds
 * and Moving / Still, then one button animates the moving ones (from the
 * picture), chooses each clip, and renders the whole story. Pinned: what is
 * created on upload, that only moving pictures without a clip are paid for
 * (price on the button), that nothing renders when a clip fails or the
 * seconds do not add up, and the order clip → choose → render.
 */
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { putToS3 } from '@/lib/mastering-upload-client';
import { PicturePanel } from '@/components/admin/visual-story/PicturePanel';
import { __resetPlayUrlCacheForTests } from '@/components/admin/visual-story/ui-utils';
import type { Candidate, GenJob, Scene, Shot, VisualStory } from '@/types/visualStory';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/lib/mastering-upload-client', () => ({ putToS3: jest.fn(async () => undefined) }));
const mockFetch = adminFetch as jest.Mock;

const VS = 'vs_1700000000000_abcdef12';
const story = { vsId: VS, spentUsd: 0, reservedUsd: 0, budgetUsdCap: 10, aspectRatio: '9:16', windowStartSec: 0, windowEndSec: 16 } as unknown as VisualStory;
const scenes: Scene[] = [{ order: 1, heading: 'Your pictures', summary: '' }];
const shot = (shotOrder: number, durationSec: number, over: Partial<Shot> = {}): Shot => ({
  sceneOrder: 1, shotOrder, mode: 'STILL', durationSec, startSec: 0, visualPrompt: 'Gentle, natural movement.', negativePrompt: '', charIds: [],
  selectedCandidateId: `cd_p${shotOrder}`, ...over,
});
const pic = (shotOrder: number, mode: 'STILL' | 'HERO' = 'STILL', candId = `cd_p${shotOrder}`): Candidate => ({
  candId, sceneOrder: 1, shotOrder, jobId: null, providerId: 'upload', providerTaskId: null, mode, s3Key: `k/${candId}`, costUsd: 0, createdAt: 't',
});
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
type Route = (url: string, init?: RequestInit) => Response | undefined;
function routes(route: Route) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/admin/mastering/download')) return json({ success: true, url: 'https://s3/play' });
    return route(url, init) ?? json({ success: true, data: {} });
  });
}
const calls = () => mockFetch.mock.calls.filter(([u, i]) => i?.method === 'POST').map(([u, i]) => ({ url: String(u), body: i?.body ? JSON.parse(String(i.body)) : undefined }));
const flush = () => act(async () => { await jest.advanceTimersByTimeAsync(60_000); });

function setup(over: { scenes?: Scene[]; shots?: Shot[]; candidates?: Candidate[]; genJobs?: GenJob[]; story?: VisualStory } = {}) {
  const onChanged = jest.fn();
  render(
    <PicturePanel
      vsId={VS}
      story={over.story ?? story}
      scenes={over.scenes ?? scenes}
      shots={over.shots ?? [shot(1, 8), shot(2, 8)]}
      candidates={over.candidates ?? [pic(1), pic(2)]}
      genJobs={over.genJobs ?? []}
      onChanged={onChanged}
    />
  );
  return { onChanged };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
  (putToS3 as jest.Mock).mockClear();
  __resetPlayUrlCacheForTests();
});
afterEach(() => jest.useRealTimers());

it('adding pictures to an empty story makes a scene, one still shot per picture, and uploads each', async () => {
  let shotNo = 0;
  routes((u, i) => {
    if (u.endsWith('/scenes')) return json({ success: true, data: { scene: { order: 1 } } }, 201);
    if (u.endsWith('/shots') && i?.method === 'POST') return json({ success: true, data: { shot: { sceneOrder: 1, shotOrder: ++shotNo } } }, 201);
    if (u.endsWith('/upload')) {
      const b = JSON.parse(String(i?.body));
      return b.op === 'presign' ? json({ success: true, data: { uploadUrl: 'https://s3', fields: {}, key: `k${shotNo}` } }) : json({ success: true, data: {} }, 201);
    }
    return undefined;
  });
  const { onChanged } = setup({ scenes: [], shots: [], candidates: [] });
  const files = [new File(['a'], 'one.jpg', { type: 'image/jpeg' }), new File(['b'], 'two.png', { type: 'image/png' })];
  fireEvent.change(screen.getByLabelText(/Add pictures/), { target: { files } });
  await flush();
  const c = calls();
  expect(c[0]).toEqual({ url: `/api/admin/visual-story/${VS}/scenes`, body: { op: 'create', heading: 'Your pictures', summary: '' } });
  const creates = c.filter((x) => x.url.endsWith('/shots'));
  expect(creates.map((x) => x.body)).toEqual([
    expect.objectContaining({ op: 'create', sceneOrder: 1, mode: 'STILL', durationSec: 8 }),
    expect.objectContaining({ op: 'create', sceneOrder: 1, mode: 'STILL', durationSec: 8 }),
  ]);
  expect(c.filter((x) => x.url.endsWith('/shots/001-002/upload')).map((x) => x.body.op)).toEqual(['presign', 'confirm']);
  expect(putToS3).toHaveBeenCalledTimes(2);
  expect(onChanged).toHaveBeenCalled();
});

it('lists each picture with its seconds; Moving saves the shot as a clip shot', async () => {
  routes(() => undefined);
  setup();
  expect(screen.getByLabelText('Seconds for picture 1')).toHaveValue(8);
  fireEvent.change(screen.getByLabelText('How picture 2 plays'), { target: { value: 'moving' } });
  await flush();
  expect(calls()).toEqual([{ url: `/api/admin/visual-story/${VS}/shots`, body: { op: 'update', sceneOrder: 1, shotOrder: 2, mode: 'HERO' } }]);
});

it('shows the total against the song, and Fit to the song sets every picture\'s seconds', async () => {
  routes(() => undefined);
  setup({ story: { ...story, windowEndSec: 30 } as VisualStory });
  expect(screen.getByText('Total 16 s of 30 s')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Make the video/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Fit to 30 s' }));
  await flush();
  expect(calls().map((x) => x.body)).toEqual([
    { op: 'update', sceneOrder: 1, shotOrder: 1, durationSec: 15 },
    { op: 'update', sceneOrder: 1, shotOrder: 2, durationSec: 15 },
  ]);
});

it('animates only the moving picture, chooses its clip, then renders', async () => {
  routes((u, i) => {
    if (u.endsWith('/video') && i?.method === 'POST') return json({ success: true, data: { jobId: 'gj_1700000000001_aaaaaaaa' } }, 202);
    if (u.includes('/video-jobs/')) return json({ success: true, data: { jobId: 'gj_1700000000001_aaaaaaaa', status: 'succeeded' } });
    if (u.endsWith('/render') && i?.method === 'POST') return json({ success: true, data: { renderId: 'rd_1', estimateSec: 60 } }, 202);
    return undefined;
  });
  const { onChanged } = setup({ shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8)] });
  fireEvent.click(screen.getByRole('button', { name: 'Make the video (1 moving · $0.64)' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Animate 1 picture for $0.64, then render the whole video?')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  await flush();
  await flush();
  expect(calls()).toEqual([
    { url: `/api/admin/visual-story/${VS}/shots/001-001/video`, body: undefined },
    { url: `/api/admin/visual-story/${VS}/select`, body: { sceneOrder: 1, shotOrder: 1, candId: 'cd_1700000000001_aaaaaaaa' } },
    { url: `/api/admin/visual-story/${VS}/render`, body: undefined },
  ]);
  expect(screen.getByRole('status')).toHaveTextContent('The video is rendering');
  expect(onChanged).toHaveBeenCalled();
});

it('a moving picture that already has a clip is not paid for again; a still showing a clip goes back to its picture', async () => {
  routes((u, i) => (u.endsWith('/render') && i?.method === 'POST' ? json({ success: true, data: { renderId: 'rd_1' } }, 202) : undefined));
  setup({
    shots: [shot(1, 8, { mode: 'HERO', selectedCandidateId: 'cd_p1' }), shot(2, 8, { selectedCandidateId: 'cd_v2' })],
    candidates: [pic(1), pic(1, 'HERO', 'cd_v1'), pic(2), pic(2, 'HERO', 'cd_v2')],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Make the video (0 moving · $0.00)' }));
  expect(screen.getByText('Render the whole video now? It is free.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await flush();
  expect(calls()).toEqual([
    { url: `/api/admin/visual-story/${VS}/select`, body: { sceneOrder: 1, shotOrder: 1, candId: 'cd_v1' } },
    { url: `/api/admin/visual-story/${VS}/select`, body: { sceneOrder: 1, shotOrder: 2, candId: 'cd_p2' } },
    { url: `/api/admin/visual-story/${VS}/render`, body: undefined },
  ]);
});

it('a failed clip stops before the render and names the picture', async () => {
  routes((u, i) => {
    if (u.endsWith('/video') && i?.method === 'POST') return json({ success: true, data: { jobId: 'gj_1700000000001_aaaaaaaa' } }, 202);
    if (u.includes('/video-jobs/')) return json({ success: true, data: { jobId: 'gj_1700000000001_aaaaaaaa', status: 'failed', error: 'The video service rejected the request.' } });
    return undefined;
  });
  setup({ shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8)] });
  fireEvent.click(screen.getByRole('button', { name: /Make the video/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await flush();
  await flush();
  expect(calls().some((x) => x.url.endsWith('/render'))).toBe(false);
  expect(screen.getByText('Picture 1: The video service rejected the request.')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Not rendered');
});

it('a row without a picture blocks the video and says which', () => {
  routes(() => undefined);
  setup({ shots: [shot(1, 8), shot(2, 8, { selectedCandidateId: null })], candidates: [pic(1)] });
  expect(screen.getByText('Picture 2 has no picture yet.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Make the video/ })).toBeDisabled();
});

it('will not start over the budget cap', () => {
  routes(() => undefined);
  setup({ shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8, { mode: 'HERO' })], story: { ...story, budgetUsdCap: 1 } as VisualStory });
  fireEvent.click(screen.getByRole('button', { name: /Make the video/ }));
  expect(screen.getByText("That is over this story's budget cap.")).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
});
