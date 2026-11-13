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
jest.mock('@/lib/visual-story-last-frame', () => ({ grabLastFrame: jest.fn(async () => new Blob(['last'], { type: 'image/jpeg' })) }));
import { grabLastFrame } from '@/lib/visual-story-last-frame';
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
  (grabLastFrame as jest.Mock).mockClear();
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
      // The real route answers presign at the top level, confirm under data.
      return b.op === 'presign' ? json({ success: true, uploadUrl: 'https://s3', fields: {}, key: `k${shotNo}` }) : json({ success: true, data: { candidate: { candId: `cd_up${shotNo}` } } }, 201);
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
  expect((putToS3 as jest.Mock).mock.calls[0][0]).toBe('https://s3');
  expect(screen.queryByRole('list', { name: 'What went wrong' })).not.toBeInTheDocument();
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
    // The picture is pinned first, so a later re-make still starts from it once the clip is chosen.
    { url: `/api/admin/visual-story/${VS}/shots`, body: { op: 'update', sceneOrder: 1, shotOrder: 1, firstFrameCandidateId: 'cd_p1' } },
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

describe('review fixes', () => {
  it('a clip already rendering is waited for and used, not left out or paid again', async () => {
    routes((u, i) => {
      if (u.includes('/video-jobs/gj_1700000000002_bbbbbbbb')) return json({ success: true, data: { jobId: 'gj_1700000000002_bbbbbbbb', status: 'succeeded' } });
      if (u.endsWith('/render') && i?.method === 'POST') return json({ success: true, data: { renderId: 'rd_1' } }, 202);
      return undefined;
    });
    setup({
      shots: [shot(1, 8, { mode: 'HERO', firstFrameCandidateId: 'cd_p1' }), shot(2, 8)],
      genJobs: [{ jobId: 'gj_1700000000002_bbbbbbbb', status: 'running', sceneOrder: 1, shotOrder: 1 } as GenJob],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Make the video (0 moving · $0.00)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await flush();
    expect(calls().some((x) => x.url.endsWith('/video'))).toBe(false);
    expect(calls()).toContainEqual({ url: `/api/admin/visual-story/${VS}/select`, body: { sceneOrder: 1, shotOrder: 1, candId: 'cd_1700000000002_bbbbbbbb' } });
    expect(calls().at(-1)!.url).toMatch(/\/render$/);
  });

  it('a moving picture that ends with no clip stops before the render', async () => {
    routes(() => undefined);
    // Moving, no clip, and its clip cannot be started (no picture to pin is fine; the route refuses).
    routes((u, i) => (u.endsWith('/video') && i?.method === 'POST' ? json({ success: false, error: 'Write a visual prompt first.' }, 400) : undefined));
    setup({ shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8)] });
    fireEvent.click(screen.getByRole('button', { name: /Make the video/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await flush();
    expect(calls().some((x) => x.url.endsWith('/render'))).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent('Not rendered');
  });

  it('is not shown for a drafted story (shots outside the pictures scene)', () => {
    routes(() => undefined);
    setup({ scenes: [{ order: 1, heading: 'Morning by the sea', summary: 's' }] });
    expect(screen.queryByRole('region', { name: 'Video from your pictures' })).not.toBeInTheDocument();
  });

  it('refuses before paying when the render would be too long for the worker', () => {
    routes(() => undefined);
    const many = Array.from({ length: 41 }, (_, i) => shot(i + 1, 15));
    setup({ shots: many, candidates: many.map((s) => pic(s.shotOrder)), story: { ...story, windowEndSec: 615 } as VisualStory });
    expect(screen.getByText(/too long to render in one go/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Make the video/ })).toBeDisabled();
  });

  it('a row can be removed, after a yes', async () => {
    routes(() => undefined);
    setup({ shots: [shot(1, 8), shot(2, 8, { selectedCandidateId: null })], candidates: [pic(1)] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove picture 2' }));
    await flush();
    expect(calls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove picture 2' }));
    await flush();
    expect(calls()).toEqual([{ url: `/api/admin/visual-story/${VS}/shots`, body: { op: 'delete', sceneOrder: 1, shotOrder: 2 } }]);
  });

  describe('Remove asks first (audit 2026-11-13: one tap deleted paid clips)', () => {
    const grokClip = (shotOrder: number, candId: string): Candidate => ({ ...pic(shotOrder, 'HERO', candId), providerId: 'grok', jobId: 'gj_x', costUsd: 2 });

    it('one tap deletes nothing, and Keep closes the question', async () => {
      routes(() => undefined);
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'Remove picture 1' }));
      expect(screen.getByText('Remove picture 1? Its picture is deleted.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
      await flush();
      expect(screen.queryByText(/Remove picture 1\?/)).not.toBeInTheDocument();
      expect(calls()).toEqual([]);
    });

    it('says when paid clips go with the row, and that they cost again', () => {
      routes(() => undefined);
      setup({ shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8)], candidates: [pic(1), grokClip(1, 'cd_c1'), grokClip(1, 'cd_c2'), pic(2)] });
      fireEvent.click(screen.getByRole('button', { name: 'Remove picture 1' }));
      expect(
        screen.getByText('Remove picture 1? Its picture and the 2 clips made for it are deleted. Those clips were paid for; making them again costs again.')
      ).toBeInTheDocument();
    });

    it('one paid clip reads in the singular', () => {
      routes(() => undefined);
      setup({ shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8)], candidates: [pic(1), grokClip(1, 'cd_c1'), pic(2)] });
      fireEvent.click(screen.getByRole('button', { name: 'Remove picture 1' }));
      expect(
        screen.getByText('Remove picture 1? Its picture and the clip made for it are deleted. That clip was paid for; making it again costs again.')
      ).toBeInTheDocument();
    });

    it('a failed remove says so in that row', async () => {
      routes((u) => (u.endsWith('/shots') ? json({ success: false, error: 'A clip is still being made.' }, 409) : undefined));
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'Remove picture 2' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove picture 2' }));
      await flush();
      const row = screen.getByRole('alert');
      expect(row).toHaveTextContent('Could not remove picture 2:');
      expect(within(screen.getAllByRole('listitem')[1]).getByRole('alert')).toBe(row);
    });
  });

  it('Stop is not offered while pictures upload', async () => {
    let release: () => void = () => {};
    mockFetch.mockImplementation(() => new Promise((r) => { release = () => r(json({ success: true, data: { scene: { order: 1 } } }, 201)); }));
    setup({ scenes: [], shots: [], candidates: [] });
    fireEvent.change(screen.getByLabelText(/Add pictures/), { target: { files: [new File(['a'], 'one.jpg', { type: 'image/jpeg' })] } });
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    await act(async () => release());
  });
});

describe('chaining: continue from the previous picture\'s clip', () => {
  const J1 = 'gj_1700000000001_aaaaaaaa';
  const J2 = 'gj_1700000000002_bbbbbbbb';

  it('offers the option only on a moving row after a moving row, and saves it', async () => {
    routes(() => undefined);
    setup({ shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8, { mode: 'HERO' }), shot(3, 8)] });
    expect(screen.queryByLabelText('Picture 1 continues from picture 0')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Picture 3 continues from picture 2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Picture 2 continues from picture 1'));
    await flush();
    expect(calls()).toEqual([{ url: `/api/admin/visual-story/${VS}/shots`, body: { op: 'update', sceneOrder: 1, shotOrder: 2, chainFromPrevious: true } }]);
  });

  it('makes the first clip, grabs its last frame, starts the next clip from it, then renders', async () => {
    let next = 0;
    routes((u, i) => {
      if (u.endsWith('/video') && i?.method === 'POST') return json({ success: true, data: { jobId: [J1, J2][next++] } }, 202);
      if (u.includes('/video-jobs/')) return json({ success: true, data: { jobId: u.split('/').pop(), status: 'succeeded' } });
      if (u.endsWith('/upload')) {
        const b = JSON.parse(String(i?.body));
        return b.op === 'presign'
          ? json({ success: true, uploadUrl: 'https://s3', fields: {}, key: 'k-last' })
          : json({ success: true, data: { candidate: { candId: 'cd_1700000000009_cccccccc' } } }, 201);
      }
      if (u.endsWith('/render') && i?.method === 'POST') return json({ success: true, data: { renderId: 'rd_1' } }, 202);
      return undefined;
    });
    // Picture 2 continues from picture 1, so it needs no picture of its own.
    setup({ shots: [shot(1, 8, { mode: 'HERO', firstFrameCandidateId: 'cd_p1' }), shot(2, 8, { mode: 'HERO', chainFromPrevious: true, selectedCandidateId: null })], candidates: [pic(1)] });
    expect(screen.getByText('Starts where picture 1 ends.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Make the video (2 moving · $1.28)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    for (let k = 0; k < 4; k++) await flush();

    const seq = calls().map((x) => `${x.url.replace(`/api/admin/visual-story/${VS}`, '')} ${x.body ? JSON.stringify(x.body) : ''}`.trim());
    expect(seq).toEqual([
      '/shots/001-001/video',
      '/shots/001-002/upload {"op":"presign","contentType":"image/jpeg","size":4}',
      '/shots/001-002/upload {"op":"confirm","key":"k-last"}',
      '/shots {"op":"update","sceneOrder":1,"shotOrder":2,"firstFrameCandidateId":"cd_1700000000009_cccccccc","chainedFromCandId":"cd_1700000000001_aaaaaaaa"}',
      '/shots/001-002/video',
      '/select {"sceneOrder":1,"shotOrder":1,"candId":"cd_1700000000001_aaaaaaaa"}',
      '/select {"sceneOrder":1,"shotOrder":2,"candId":"cd_1700000000002_bbbbbbbb"}',
      '/render',
    ]);
    // The frame came from picture 1's new clip, signed fresh.
    expect(mockFetch.mock.calls.some(([u]) => String(u).startsWith('/api/admin/mastering/download') && String(u).includes(encodeURIComponent(`candidates/cd_1700000000001_aaaaaaaa.mp4`)))).toBe(true);
    expect(grabLastFrame).toHaveBeenCalledWith('https://s3/play');
    expect(screen.getByRole('status')).toHaveTextContent('The video is rendering');
  });

  it('when the first clip fails, the chained one is not made and nothing renders', async () => {
    routes((u, i) => {
      if (u.endsWith('/video') && i?.method === 'POST') return json({ success: true, data: { jobId: J1 } }, 202);
      if (u.includes('/video-jobs/')) return json({ success: true, data: { jobId: J1, status: 'failed', error: 'Refused.' } });
      return undefined;
    });
    setup({ shots: [shot(1, 8, { mode: 'HERO', firstFrameCandidateId: 'cd_p1' }), shot(2, 8, { mode: 'HERO', chainFromPrevious: true })] });
    fireEvent.click(screen.getByRole('button', { name: /Make the video/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    for (let k = 0; k < 3; k++) await flush();
    expect(calls().filter((x) => x.url.endsWith('/video'))).toHaveLength(1);
    expect(calls().some((x) => x.url.endsWith('/render'))).toBe(false);
    expect(screen.getByText('Picture 2: picture 1 has no clip, so it cannot continue from it.')).toBeInTheDocument();
  });

  it('a last frame that cannot be copied names the picture and stops before the render', async () => {
    (grabLastFrame as jest.Mock).mockRejectedValueOnce(new Error('The clip could not be loaded.'));
    routes((u, i) => (u.endsWith('/render') && i?.method === 'POST' ? json({ success: true, data: {} }, 202) : undefined));
    setup({
      shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8, { mode: 'HERO', chainFromPrevious: true })],
      candidates: [pic(1), pic(1, 'HERO', 'cd_1700000000001_aaaaaaaa'), pic(2)],
    });
    fireEvent.click(screen.getByRole('button', { name: /Make the video/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    for (let k = 0; k < 3; k++) await flush();
    expect(screen.getByText('Picture 2: The clip could not be loaded.')).toBeInTheDocument();
    expect(calls().some((x) => x.url.endsWith('/render'))).toBe(false);
  });
});

describe('chaining review fixes', () => {
  const V1 = 'cd_1700000000001_aaaaaaaa';
  const V1B = 'cd_1700000000005_dddddddd';
  const J2 = 'gj_1700000000002_bbbbbbbb';
  const clip = (shotOrder: number, candId: string, createdAt: string): Candidate => ({ ...pic(shotOrder, 'HERO', candId), s3Key: `k/${candId}.mp4`, createdAt });

  it('a chained clip made from the previous clip that is still current is not paid again', () => {
    routes(() => undefined);
    setup({
      shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8, { mode: 'HERO', chainFromPrevious: true, chainedFromCandId: V1 })],
      candidates: [pic(1), clip(1, V1, 't1'), clip(2, 'cd_1700000000006_eeeeeeee', 't2')],
    });
    expect(screen.getByRole('button', { name: 'Make the video (0 moving · $0.00)' })).toBeInTheDocument();
  });

  it('when the previous clip was re-made, the chained clip is re-made from the new last frame (and priced)', async () => {
    routes((u, i) => {
      if (u.endsWith('/video') && i?.method === 'POST') return json({ success: true, data: { jobId: J2 } }, 202);
      if (u.includes('/video-jobs/')) return json({ success: true, data: { jobId: J2, status: 'succeeded' } });
      if (u.endsWith('/upload')) {
        const b = JSON.parse(String(i?.body));
        return b.op === 'presign' ? json({ success: true, uploadUrl: 'https://s3', fields: {}, key: 'k' }) : json({ success: true, data: { candidate: { candId: 'cd_1700000000009_cccccccc' } } }, 201);
      }
      if (u.endsWith('/render') && i?.method === 'POST') return json({ success: true, data: {} }, 202);
      return undefined;
    });
    setup({
      shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8, { mode: 'HERO', chainFromPrevious: true, chainedFromCandId: V1 })],
      // Picture 1 now has a newer clip (V1B) than the one picture 2 was chained from.
      candidates: [pic(1), clip(1, V1, 't1'), clip(1, V1B, 't3'), clip(2, 'cd_1700000000006_eeeeeeee', 't2')],
    });
    expect(screen.getByText('Will be made again, to start where picture 1 now ends.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Make the video (1 moving · $0.64)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    for (let k = 0; k < 3; k++) await flush();
    // The frame is taken from the clip's stored key, not a rebuilt one.
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes(encodeURIComponent(`k/${V1B}.mp4`)))).toBe(true);
    expect(calls()).toContainEqual({ url: `/api/admin/visual-story/${VS}/shots`, body: { op: 'update', sceneOrder: 1, shotOrder: 2, firstFrameCandidateId: 'cd_1700000000009_cccccccc', chainedFromCandId: V1B } });
    expect(calls().filter((x) => x.url.endsWith('/video'))).toHaveLength(1);
  });

  it('a re-run reuses the last frame already copied from the same clip (no second upload)', async () => {
    routes((u, i) => {
      if (u.endsWith('/video') && i?.method === 'POST') return json({ success: true, data: { jobId: J2 } }, 202);
      if (u.includes('/video-jobs/')) return json({ success: true, data: { jobId: J2, status: 'succeeded' } });
      if (u.endsWith('/render') && i?.method === 'POST') return json({ success: true, data: {} }, 202);
      return undefined;
    });
    setup({
      shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8, { mode: 'HERO', chainFromPrevious: true, chainedFromCandId: V1, firstFrameCandidateId: 'cd_last', selectedCandidateId: 'cd_last' })],
      candidates: [pic(1), clip(1, V1, 't1'), pic(2, 'STILL', 'cd_last')],
    });
    fireEvent.click(screen.getByRole('button', { name: /Make the video/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    for (let k = 0; k < 3; k++) await flush();
    expect(grabLastFrame).not.toHaveBeenCalled();
    expect(calls().some((x) => x.url.endsWith('/upload'))).toBe(false);
    expect(calls().filter((x) => x.url.endsWith('/video'))).toHaveLength(1);
  });

  it('a budget refusal stops the chain: no frame is copied for the next row', async () => {
    routes((u, i) => {
      if (u.endsWith('/video') && i?.method === 'POST') return json({ success: false, error: "This would go over the story's budget." }, 402);
      if (u.endsWith('/upload')) {
        const b = JSON.parse(String(i?.body));
        return b.op === 'presign' ? json({ success: true, uploadUrl: 'https://s3', fields: {}, key: 'k' }) : json({ success: true, data: { candidate: { candId: 'cd_1700000000009_cccccccc' } } }, 201);
      }
      return undefined;
    });
    setup({ shots: [shot(1, 8, { mode: 'HERO', firstFrameCandidateId: 'cd_p1' }), shot(2, 8, { mode: 'HERO', chainFromPrevious: true })], candidates: [pic(1), clip(1, V1, 't1')] });
    fireEvent.click(screen.getByRole('button', { name: /Make the video/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    for (let k = 0; k < 3; k++) await flush();
    expect(screen.getByRole('alert')).toHaveTextContent("over the story's budget");
    expect(calls().filter((x) => x.url.endsWith('/upload'))).toHaveLength(2); // presign + confirm once, then the 402 stops it
    expect(calls().filter((x) => x.url.endsWith('/video'))).toHaveLength(1);
  });
});

describe('audit 2026-11-13: Stop during a chained run, and a clip whose row changed length', () => {
  const JA = 'gj_1700000000001_aaaaaaaa';
  const clipFor = (shotOrder: number, durationSec?: number): Candidate => ({
    ...pic(shotOrder, 'HERO', `cd_v${shotOrder}`), providerId: 'grok', jobId: 'gj_x', ...(durationSec !== undefined ? { durationSec } : {}),
  });

  it('Stop is shown while a clip is being made, and pressing it starts no more clips and does not render', async () => {
    let status = 'running';
    routes((u, i) => {
      if (u.endsWith('/video') && i?.method === 'POST') return json({ success: true, data: { jobId: JA } }, 202);
      if (u.includes('/video-jobs/')) return json({ success: true, data: { jobId: JA, status } });
      if (u.endsWith('/render') && i?.method === 'POST') return json({ success: true, data: { renderId: 'rd_1' } }, 202);
      return undefined;
    });
    setup({
      shots: [
        shot(1, 8, { mode: 'HERO', firstFrameCandidateId: 'cd_p1' }),
        shot(2, 8, { mode: 'HERO', chainFromPrevious: true, selectedCandidateId: null }),
      ],
      candidates: [pic(1)],
    });
    fireEvent.click(screen.getByRole('button', { name: /Make the video/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(100); });
    // Clip 1 is being made: Stop is there, with the true story about leaving.
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByText(/If you leave, clips already started still finish, but no more start/)).toBeInTheDocument();
    expect(screen.queryByText(/keep rendering even if you leave/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByText(/Stopping: the clips being made now finish/)).toBeInTheDocument();
    status = 'succeeded';
    for (let k = 0; k < 4; k++) await flush();
    const posted = calls().map((x) => x.url.replace(`/api/admin/visual-story/${VS}`, ''));
    expect(posted.filter((u) => u.endsWith('/video'))).toEqual(['/shots/001-001/video']);
    expect(posted).not.toContain('/render');
    expect(screen.getByRole('status')).toHaveTextContent('Not rendered');
  });

  it('a made clip whose row now has different seconds is out of date: no "Clip made", it says so, and it is priced again', () => {
    routes(() => undefined);
    setup({ shots: [shot(1, 11, { mode: 'HERO', selectedCandidateId: 'cd_v1' }), shot(2, 5)], candidates: [pic(1), clipFor(1, 8), pic(2)] });
    expect(screen.queryByText('Clip made')).not.toBeInTheDocument();
    expect(screen.getByText('Its clip is 8 s; this row needs it slower than 88 %. Make the video makes it again for 11 s, or shorten the row to 9 s or less.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Make the video \(1 moving/ })).toBeInTheDocument();
  });

  it('a made clip a little short of its row plays slower and stays made and free (14 s clip, 15.2 s row)', () => {
    routes(() => undefined);
    setup({ shots: [shot(1, 15.2, { mode: 'HERO', selectedCandidateId: 'cd_v1' }), shot(2, 5)], candidates: [pic(1), clipFor(1, 14), pic(2)] });
    expect(screen.getByText('Clip made')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Make the video \(0 moving/ })).toBeInTheDocument();
  });
  it('a made clip longer than its row is trimmed and stays made (14 s clip, 13.2 s row)', () => {
    routes(() => undefined);
    setup({ shots: [shot(1, 13.2, { mode: 'HERO', selectedCandidateId: 'cd_v1' }), shot(2, 5)], candidates: [pic(1), clipFor(1, 14), pic(2)] });
    expect(screen.getByText('Clip made')).toBeInTheDocument();
  });

  it('a made clip with matching seconds stays made and free', () => {
    routes(() => undefined);
    setup({ shots: [shot(1, 8, { mode: 'HERO', selectedCandidateId: 'cd_v1' }), shot(2, 8)], candidates: [pic(1), clipFor(1, 8), pic(2)] });
    expect(screen.getByText('Clip made')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Make the video \(0 moving/ })).toBeInTheDocument();
  });

  it('Fit leaves a row with a made clip at its length and fits the rest', async () => {
    routes(() => undefined);
    setup({
      shots: [shot(1, 8, { mode: 'HERO', selectedCandidateId: 'cd_v1' }), shot(2, 8)],
      candidates: [pic(1), clipFor(1, 8), pic(2)],
      story: { ...story, windowEndSec: 20 } as VisualStory,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fit to 20 s' }));
    await flush();
    expect(calls().map((x) => x.body)).toEqual([{ op: 'update', sceneOrder: 1, shotOrder: 2, durationSec: 12 }]);
  });

  it('Fit to the song still works after a lyrics fit left a made row in tenths (13.2 s)', async () => {
    routes(() => undefined);
    setup({
      shots: [shot(1, 13.2, { mode: 'HERO', selectedCandidateId: 'cd_v1' }), shot(2, 8), shot(3, 8)],
      candidates: [pic(1), clipFor(1, 14), pic(2), pic(3)],
      story: { ...story, windowEndSec: 30 } as VisualStory,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fit to 30 s' }));
    await flush();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // 16.8 s left for two pictures: whole seconds, with the tenth on the last.
    const after = [13.2, 8, 8];
    for (const c of calls()) after[c.body.shotOrder - 1] = c.body.durationSec;
    expect(Math.round(after.reduce((a, b) => a + b, 0) * 10) / 10).toBe(30);
    expect(after.slice(1)).toEqual([8, 8.8]);
  });

  it('Fit also keeps older clips with no recorded length', async () => {
    routes(() => undefined);
    setup({
      shots: [shot(1, 8, { mode: 'HERO', selectedCandidateId: 'cd_v1' }), shot(2, 8)],
      candidates: [pic(1), clipFor(1), pic(2)],
      story: { ...story, windowEndSec: 20 } as VisualStory,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fit to 20 s' }));
    await flush();
    expect(calls().map((x) => x.body)).toEqual([{ op: 'update', sceneOrder: 1, shotOrder: 2, durationSec: 12 }]);
  });

  it('when made clips leave too little room, Fit says so plainly', async () => {
    routes(() => undefined);
    setup({
      shots: [shot(1, 8, { mode: 'HERO', selectedCandidateId: 'cd_v1' }), shot(2, 8)],
      candidates: [pic(1), clipFor(1, 8), pic(2)],
      story: { ...story, windowEndSec: 40 } as VisualStory,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fit to 40 s' }));
    await flush();
    expect(calls()).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent('Your clips and the clips already made take 8 s, so 1 picture must fill 32 s');
  });
});

describe('review 2026-11-13: a clip the next row continues from stays whole seconds', () => {
  it('rounds tenths typed into a row the next row continues from (its clip cannot be trimmed)', async () => {
    routes(() => undefined);
    setup({ shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8, { mode: 'HERO', chainFromPrevious: true })] });
    const field = screen.getByLabelText('Seconds for picture 1');
    fireEvent.change(field, { target: { value: '9.4' } });
    await act(async () => { fireEvent.blur(field); });
    expect(calls()[0].body).toMatchObject({ op: 'update', shotOrder: 1, durationSec: 9 });
  });
  it('keeps tenths on a row nothing continues from', async () => {
    routes(() => undefined);
    setup({ shots: [shot(1, 8, { mode: 'HERO' }), shot(2, 8, { mode: 'HERO' })] });
    const field = screen.getByLabelText('Seconds for picture 1');
    fireEvent.change(field, { target: { value: '9.4' } });
    await act(async () => { fireEvent.blur(field); });
    expect(calls()[0].body).toMatchObject({ op: 'update', shotOrder: 1, durationSec: 9.4 });
  });
});

