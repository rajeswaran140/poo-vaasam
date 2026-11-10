/** @jest-environment jsdom */
/**
 * "Video from your pictures" — the owner's own clips (MP4s made elsewhere,
 * e.g. in Grok). Pinned: each clip becomes its own row at the clip's own
 * length; a clip too long or unreadable is refused before anything is
 * created; the row is never sent to Grok, costs nothing, and is chosen for
 * the render; Fit leaves its seconds alone.
 */
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { putToS3 } from '@/lib/mastering-upload-client';
import { PicturePanel } from '@/components/admin/visual-story/PicturePanel';
import { __resetPlayUrlCacheForTests } from '@/components/admin/visual-story/ui-utils';
import { OWN_CLIP_PROMPT } from '@/types/visualStory';
import type { Candidate, Scene, Shot, VisualStory } from '@/types/visualStory';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/lib/mastering-upload-client', () => ({ putToS3: jest.fn(async () => undefined) }));
jest.mock('@/lib/visual-story-last-frame', () => ({ grabLastFrame: jest.fn() }));
const mockDuration = jest.fn();
jest.mock('@/lib/visual-story-clip-length', () => ({
  ...jest.requireActual('@/lib/visual-story-clip-length'),
  readClipDuration: (f: File) => mockDuration(f),
}));
const mockFetch = adminFetch as jest.Mock;

const VS = 'vs_1700000000000_abcdef12';
const story = { vsId: VS, spentUsd: 0, reservedUsd: 0, budgetUsdCap: 10, aspectRatio: '16:9', windowStartSec: 0, windowEndSec: 18 } as unknown as VisualStory;
const scenes: Scene[] = [{ order: 1, heading: 'Your pictures', summary: '' }];
const shot = (shotOrder: number, durationSec: number, over: Partial<Shot> = {}): Shot => ({
  sceneOrder: 1, shotOrder, mode: 'STILL', durationSec, startSec: 0, visualPrompt: 'Gentle, natural movement.', negativePrompt: '', charIds: [],
  selectedCandidateId: `cd_p${shotOrder}`, ...over,
});
const ownRow = (shotOrder: number, durationSec: number, over: Partial<Shot> = {}) =>
  shot(shotOrder, durationSec, { mode: 'HERO', visualPrompt: OWN_CLIP_PROMPT, selectedCandidateId: `cd_own${shotOrder}`, ...over });
const cand = (shotOrder: number, mode: 'STILL' | 'HERO', candId: string, ext: string): Candidate => ({
  candId, sceneOrder: 1, shotOrder, jobId: null, providerId: 'upload', providerTaskId: null, mode, s3Key: `k/${candId}.${ext}`, costUsd: 0, createdAt: 't',
});
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
function routes(route: (url: string, init?: RequestInit) => Response | undefined) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => route(url, init) ?? json({ success: true, data: {} }));
}
const calls = () =>
  mockFetch.mock.calls.filter(([, i]) => i?.method === 'POST').map(([u, i]) => ({ url: String(u), body: i?.body ? JSON.parse(String(i.body)) : undefined }));
const flush = () => act(async () => { await jest.advanceTimersByTimeAsync(60_000); });

function setup(over: { shots?: Shot[]; candidates?: Candidate[]; story?: VisualStory; scenes?: Scene[] } = {}) {
  render(
    <PicturePanel
      vsId={VS}
      story={over.story ?? story}
      scenes={over.scenes ?? scenes}
      shots={over.shots ?? []}
      candidates={over.candidates ?? []}
      genJobs={[]}
      onChanged={jest.fn()}
    />
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
  mockDuration.mockReset();
  (putToS3 as jest.Mock).mockClear();
  __resetPlayUrlCacheForTests();
});
afterEach(() => jest.useRealTimers());

it('each clip becomes its own row at the clip\'s own length (rounded), uploaded as an MP4', async () => {
  let shotNo = 0;
  routes((u, i) => {
    if (u.endsWith('/scenes')) return json({ success: true, data: { scene: { order: 1 } } }, 201);
    if (u.endsWith('/shots')) return json({ success: true, data: { shot: { sceneOrder: 1, shotOrder: ++shotNo } } }, 201);
    if (u.endsWith('/upload')) {
      const b = JSON.parse(String(i?.body));
      return b.op === 'presign' ? json({ success: true, uploadUrl: 'https://s3', fields: {}, key: `k${shotNo}` }) : json({ success: true, data: { candidate: { candId: `cd_c${shotNo}` } } }, 201);
    }
    return undefined;
  });
  mockDuration.mockResolvedValueOnce(7.6).mockResolvedValueOnce(20.2);
  setup({ scenes: [] });
  const files = [new File(['a'], 'one.mp4', { type: 'video/mp4' }), new File(['b'], 'two.mp4', { type: 'video/mp4' })];
  fireEvent.change(screen.getByLabelText(/Add your own clips/), { target: { files } });
  await flush();
  const creates = calls().filter((x) => x.url.endsWith('/shots')).map((x) => x.body);
  expect(creates).toEqual([
    { op: 'create', sceneOrder: 1, mode: 'HERO', durationSec: 8, visualPrompt: OWN_CLIP_PROMPT },
    // Longer than Grok's 15 s: kept at its own length.
    { op: 'create', sceneOrder: 1, mode: 'HERO', durationSec: 20, visualPrompt: OWN_CLIP_PROMPT },
  ]);
  const presigns = calls().filter((x) => x.url.endsWith('/upload') && x.body.op === 'presign').map((x) => x.body);
  expect(presigns).toEqual([
    { op: 'presign', contentType: 'video/mp4', size: 1 },
    { op: 'presign', contentType: 'video/mp4', size: 1 },
  ]);
  expect(putToS3).toHaveBeenCalledTimes(2);
  expect(calls().some((x) => x.url.endsWith('/video') || x.url.endsWith('/still'))).toBe(false);
});

it('a clip too long, or one whose length cannot be read, is refused before anything is created', async () => {
  routes((u) => (u.endsWith('/shots') ? json({ success: true, data: { shot: { sceneOrder: 1, shotOrder: 1 } } }, 201) : undefined));
  mockDuration.mockResolvedValueOnce(75).mockResolvedValueOnce(NaN);
  setup();
  const files = [new File(['a'], 'long.mp4', { type: 'video/mp4' }), new File(['b'], 'bad.mp4', { type: 'video/mp4' })];
  fireEvent.change(screen.getByLabelText(/Add your own clips/), { target: { files } });
  await flush();
  expect(calls().filter((x) => x.url.endsWith('/shots'))).toEqual([]);
  const list = screen.getByRole('list', { name: 'What went wrong' });
  expect(within(list).getByText('long.mp4: The clip is 75 s long; the most for one clip is 60 s.')).toBeInTheDocument();
  expect(within(list).getByText(/bad\.mp4: Could not read how long the clip is/)).toBeInTheDocument();
});

it('a clip row shows its length, costs nothing, is never sent to Grok, and is chosen for the render', async () => {
  routes((u, i) => {
    if (u.startsWith('/api/admin/mastering/download')) return json({ success: true, url: 'https://s3/play' });
    return u.endsWith('/render') && i?.method === 'POST' ? json({ success: true, data: { renderId: 'rd_1' } }, 202) : undefined;
  });
  // Row 1 your clip (not yet chosen), row 2 a still picture.
  setup({
    shots: [ownRow(1, 10, { selectedCandidateId: null }), shot(2, 8)],
    candidates: [cand(1, 'HERO', 'cd_own1', 'mp4'), cand(2, 'STILL', 'cd_p2', 'jpg')],
  });
  expect(screen.getByText('10 s · your clip (free)')).toBeInTheDocument();
  // A playable preview, so the clips' order can be checked before rendering.
  await flush();
  expect(screen.getByLabelText('Clip 1 preview')).toHaveAttribute('src', 'https://s3/play');
  expect(screen.queryByLabelText('Seconds for clip 1')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('How clip 1 plays')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Make the video (0 moving · $0.00)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await flush();
  expect(calls()).toEqual([
    { url: `/api/admin/visual-story/${VS}/select`, body: { sceneOrder: 1, shotOrder: 1, candId: 'cd_own1' } },
    { url: `/api/admin/visual-story/${VS}/render`, body: undefined },
  ]);
});

it('Fit leaves your clips at their own length and fits the pictures to what is left', async () => {
  routes(() => undefined);
  setup({
    story: { ...story, windowEndSec: 24 } as VisualStory,
    shots: [ownRow(1, 10), shot(2, 8)],
    candidates: [cand(1, 'HERO', 'cd_own1', 'mp4'), cand(2, 'STILL', 'cd_p2', 'jpg')],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fit to 24 s' }));
  await flush();
  expect(calls().map((x) => x.body)).toEqual([{ op: 'update', sceneOrder: 1, shotOrder: 2, durationSec: 14 }]);
});

it('Fit says why when the clips leave the pictures too little or too much', async () => {
  routes(() => undefined);
  setup({
    story: { ...story, windowEndSec: 60 } as VisualStory,
    shots: [ownRow(1, 10), shot(2, 8)],
    candidates: [cand(1, 'HERO', 'cd_own1', 'mp4'), cand(2, 'STILL', 'cd_p2', 'jpg')],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fit to 60 s' }));
  await flush();
  expect(calls()).toEqual([]);
  expect(screen.getByRole('alert')).toHaveTextContent('Your clips take 10 s, so 1 picture must fill 50 s at 1-15 s each.');
});

it('a clip row whose upload never arrived blocks the video and says so', () => {
  routes(() => undefined);
  setup({ shots: [ownRow(1, 10), shot(2, 8)], candidates: [cand(2, 'STILL', 'cd_p2', 'jpg')] });
  expect(screen.getByText('Clip 1 has no clip yet. Remove it and add the clip again.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Make the video/ })).toBeDisabled();
});
