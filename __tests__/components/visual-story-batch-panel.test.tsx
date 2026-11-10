/** @jest-environment jsdom */
/**
 * The "every shot" panel. What the owner must be able to trust: the price on
 * each button covers exactly the shots it will make, a confirm shows the story
 * total first, a shot that already has its picture or clip is skipped, each
 * clip starts from the shot's chosen picture, a budget refusal stops the run,
 * one failed shot is named without stopping the rest, and Stop stops.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { BatchPanel, shotsNeedingPicture } from '@/components/admin/visual-story/BatchPanel';
import type { Candidate, GenJob, Shot, VisualStory } from '@/types/visualStory';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const mockFetch = adminFetch as jest.Mock;

const VS = 'vs_1700000000000_abcdef12';
const story = { vsId: VS, spentUsd: 0.1, reservedUsd: 0, budgetUsdCap: 10, aspectRatio: '9:16' } as unknown as VisualStory;
const shot = (sceneOrder: number, shotOrder: number, durationSec: number, over: Partial<Shot> = {}): Shot => ({
  sceneOrder, shotOrder, mode: 'STILL', durationSec, startSec: 0, visualPrompt: 'p', negativePrompt: '', charIds: [], selectedCandidateId: null, ...over,
});
const cand = (candId: string, sceneOrder: number, shotOrder: number, mode: 'STILL' | 'HERO'): Candidate => ({
  candId, sceneOrder, shotOrder, jobId: null, providerId: 'grok', providerTaskId: null, mode, s3Key: `k/${candId}`, costUsd: 0, createdAt: 't',
});
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

type Route = (url: string, init?: RequestInit) => Response | undefined;
function routes(route: Route) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => route(url, init) ?? json({ success: true, data: {} }));
}
const posts = (part: string) => mockFetch.mock.calls.filter(([u, i]) => String(u).includes(part) && i?.method === 'POST').map(([u, i]) => [u, i?.body]);
const flush = () => act(async () => { await jest.advanceTimersByTimeAsync(60_000); });

function setup(shots: Shot[], candidates: Candidate[] = [], genJobs: GenJob[] = [], s: VisualStory = story) {
  const onChanged = jest.fn();
  render(<BatchPanel vsId={VS} story={s} shots={shots} candidates={candidates} genJobs={genJobs} onChanged={onChanged} />);
  return { onChanged };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
});
afterEach(() => jest.useRealTimers());

describe('pictures for every shot', () => {
  it('prices only the shots without a picture, confirms, then makes one each in order', async () => {
    routes(() => undefined);
    const { onChanged } = setup([shot(1, 1, 8), shot(1, 2, 7), shot(2, 1, 6)], [cand('cd_a', 1, 1, 'STILL')]);
    fireEvent.click(screen.getByRole('button', { name: 'Pictures for every shot (2 shots · $0.04)' }));
    expect(screen.getByText('Make one picture for each of 2 shots for $0.04?')).toBeInTheDocument();
    expect(screen.getByText('Story total after this: $0.14 of $10.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await flush();
    expect(posts('/still').map(([u]) => u)).toEqual([
      `/api/admin/visual-story/${VS}/shots/001-002/still`,
      `/api/admin/visual-story/${VS}/shots/002-001/still`,
    ]);
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Done: 2 of 2 pictures made.');
  });

  it('says so when every shot already has a picture', () => {
    routes(() => undefined);
    setup([shot(1, 1, 8)], [cand('cd_a', 1, 1, 'STILL')]);
    expect(screen.getByRole('button', { name: /Pictures for every shot/ })).toBeDisabled();
    expect(screen.getByText('Every shot has a picture.')).toBeInTheDocument();
  });

  it('a budget refusal stops the run and shows the message', async () => {
    routes((u, i) => (u.includes('/still') && i?.method === 'POST' ? json({ success: false, error: "This would go over the story's budget ($9.99 of $10.00)." }, 402) : undefined));
    setup([shot(1, 1, 8), shot(1, 2, 7)]);
    fireEvent.click(screen.getByRole('button', { name: /Pictures for every shot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await flush();
    expect(posts('/still')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent("This would go over the story's budget");
    expect(screen.getByRole('button', { name: 'Raise budget' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Stopped: 0 of 2 pictures made.');
  });

  it('names a shot that failed and carries on with the rest', async () => {
    routes((u, i) => (u.includes('001-001/still') && i?.method === 'POST' ? json({ success: false, error: 'The picture was refused.' }, 422) : undefined));
    setup([shot(1, 1, 8), shot(1, 2, 7)]);
    fireEvent.click(screen.getByRole('button', { name: /Pictures for every shot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await flush();
    expect(posts('/still')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Done: 1 of 2 pictures made.');
    expect(screen.getByText('Scene 1, shot 1: The picture was refused.')).toBeInTheDocument();
  });

  it('waits and tries again when rate-limited', async () => {
    let n = 0;
    routes((u, i) => (u.includes('/still') && i?.method === 'POST' && n++ === 0 ? json({ success: false, error: 'Too many requests' }, 429) : undefined));
    setup([shot(1, 1, 8)]);
    fireEvent.click(screen.getByRole('button', { name: /Pictures for every shot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await flush();
    expect(posts('/still')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Done: 1 of 1 pictures made.');
  });

  it('Stop finishes the current shot and starts no more', async () => {
    let release: () => void = () => {};
    routes((u, i) => {
      if (u.includes('/still') && i?.method === 'POST') return undefined;
      return undefined;
    });
    mockFetch.mockImplementationOnce(() => new Promise((r) => { release = () => r(json({ success: true, data: {} })); }));
    setup([shot(1, 1, 8), shot(1, 2, 7), shot(1, 3, 6)]);
    fireEvent.click(screen.getByRole('button', { name: /Pictures for every shot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await act(async () => release());
    await flush();
    expect(posts('/still')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Stopped: 1 of 3 pictures made.');
  });
});

describe('videos for every shot', () => {
  const job = (jobId: string, status: GenJob['status']) => ({ jobId, status } as GenJob);

  it('prices the shots without a clip, starts each from its chosen picture, and follows them to the end', async () => {
    const polls: Record<string, GenJob['status'][]> = { gj_1: ['running', 'succeeded'], gj_2: ['succeeded'] };
    let next = 0;
    routes((u, i) => {
      if (u.endsWith('/video') && i?.method === 'POST') return json({ success: true, data: { jobId: `gj_${++next}` } }, 202);
      const m = /video-jobs\/(gj_\d)$/.exec(u);
      if (m) {
        const list = polls[m[1]];
        return json({ success: true, data: job(m[1], list.length > 1 ? list.shift()! : list[0]) });
      }
      return undefined;
    });
    const shots = [
      shot(1, 1, 8, { mode: 'HERO', selectedCandidateId: 'cd_v' }), // already has a clip: skipped
      shot(1, 2, 7, { mode: 'HERO', selectedCandidateId: 'cd_p' }), // chosen picture, not yet the first frame: pinned first
      shot(2, 1, 6, { mode: 'HERO', selectedCandidateId: 'cd_q', firstFrameCandidateId: 'cd_q' }), // already pinned
    ];
    const cands = [cand('cd_v', 1, 1, 'HERO'), cand('cd_p', 1, 2, 'STILL'), cand('cd_q', 2, 1, 'STILL')];
    const { onChanged } = setup(shots, cands);

    fireEvent.click(screen.getByRole('button', { name: 'Videos for every shot (2 shots · $1.04)' }));
    expect(screen.getByText('Make a video clip for each of 2 shots for $1.04?')).toBeInTheDocument();
    expect(screen.getByText(/starts from the shot's chosen picture/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await flush();
    await flush();

    const shotPosts = posts(`/${VS}/shots`).filter(([u]) => String(u).endsWith('/shots'));
    expect(shotPosts.map(([, b]) => JSON.parse(String(b)))).toEqual([{ op: 'update', sceneOrder: 1, shotOrder: 2, firstFrameCandidateId: 'cd_p' }]);
    expect(posts('/video').map(([u]) => u)).toEqual([
      `/api/admin/visual-story/${VS}/shots/001-002/video`,
      `/api/admin/visual-story/${VS}/shots/002-001/video`,
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('Done: 2 of 2 clips made.');
    expect(onChanged).toHaveBeenCalled();
    // The pin goes in before that shot's clip is asked for.
    const order = mockFetch.mock.calls.map(([u]) => String(u)).filter((u) => u.endsWith('/shots') || u.endsWith('/video'));
    expect(order.slice(0, 2)).toEqual([`/api/admin/visual-story/${VS}/shots`, `/api/admin/visual-story/${VS}/shots/001-002/video`]);
  });

  it('skips a shot whose clip is already rendering', () => {
    routes(() => undefined);
    setup(
      [shot(1, 1, 8, { mode: 'HERO', selectedCandidateId: 'cd_a' }), shot(1, 2, 7, { mode: 'HERO', selectedCandidateId: 'cd_b' })],
      [cand('cd_a', 1, 1, 'STILL'), cand('cd_b', 1, 2, 'STILL')],
      [{ jobId: 'gj_x', status: 'running', sceneOrder: 1, shotOrder: 1 } as GenJob]
    );
    expect(screen.getByRole('button', { name: 'Videos for every shot (1 shot · $0.56)' })).toBeInTheDocument();
  });

  it('will not start over the budget cap', () => {
    routes(() => undefined);
    setup(
      [shot(1, 1, 15, { mode: 'HERO', selectedCandidateId: 'cd_a' }), shot(1, 2, 15, { mode: 'HERO', selectedCandidateId: 'cd_b' })],
      [cand('cd_a', 1, 1, 'STILL'), cand('cd_b', 1, 2, 'STILL')],
      [],
      { ...story, budgetUsdCap: 2 } as VisualStory
    );
    fireEvent.click(screen.getByRole('button', { name: /Videos for every shot/ }));
    expect(screen.getByText("That is over this story's budget cap.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('names a clip that failed and still makes the rest', async () => {
    let next = 0;
    routes((u, i) => {
      if (u.endsWith('/video') && i?.method === 'POST') return json({ success: true, data: { jobId: `gj_${++next}` } }, 202);
      if (u.endsWith('video-jobs/gj_1')) return json({ success: true, data: { jobId: 'gj_1', status: 'failed', error: 'The video service rejected the request.' } });
      if (u.endsWith('video-jobs/gj_2')) return json({ success: true, data: { jobId: 'gj_2', status: 'succeeded' } });
      return undefined;
    });
    setup(withPictures([shot(1, 1, 8), shot(1, 2, 7)]), pics([shot(1, 1, 8), shot(1, 2, 7)]));
    fireEvent.click(screen.getByRole('button', { name: /Videos for every shot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await flush();
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Done: 1 of 2 clips made.');
    expect(screen.getByText('Scene 1, shot 1: The video service rejected the request.')).toBeInTheDocument();
  });
});

const withPictures = (list: Shot[]) => list.map((s) => ({ ...s, mode: 'HERO' as const, selectedCandidateId: `cd_${s.sceneOrder}${s.shotOrder}` }));
const pics = (list: Shot[]) => list.map((s) => cand(`cd_${s.sceneOrder}${s.shotOrder}`, s.sceneOrder, s.shotOrder, 'STILL'));

describe('review fixes', () => {
  it('Stop pressed in the gap between shots pays for no more', async () => {
    routes(() => undefined);
    setup([shot(1, 1, 8), shot(1, 2, 7), shot(1, 3, 6)]);
    fireEvent.click(screen.getByRole('button', { name: /Pictures for every shot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(1000); }); // first picture done, now in the gap
    expect(posts('/still')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await flush();
    expect(posts('/still')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Stopped: 1 of 3 pictures made.');
  });

  it('Stop pressed while waiting out a rate limit does not resend', async () => {
    routes((u, i) => (u.includes('/still') && i?.method === 'POST' ? json({ success: false, error: 'Too many requests' }, 429) : undefined));
    setup([shot(1, 1, 8)]);
    fireEvent.click(screen.getByRole('button', { name: /Pictures for every shot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await flush();
    expect(posts('/still')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Stopped: 0 of 1 pictures made.');
  });

  it('while clips render there is no Stop, and it says they keep rendering', async () => {
    routes((u, i) => {
      if (u.endsWith('/video') && i?.method === 'POST') return json({ success: true, data: { jobId: 'gj_1' } }, 202);
      if (u.endsWith('video-jobs/gj_1')) return json({ success: true, data: { jobId: 'gj_1', status: 'running' } });
      return undefined;
    });
    const list = withPictures([shot(1, 1, 8)]);
    setup(list.map((s) => ({ ...s, firstFrameCandidateId: s.selectedCandidateId! })), pics(list));
    fireEvent.click(screen.getByRole('button', { name: /Videos for every shot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText(/Rendering: 0 of 1 clips finished/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.getByText(/keep rendering even if you leave this page/)).toBeInTheDocument();
  });

  it('leaves out shots with no chosen picture or no prompt, and says how many need a picture', () => {
    routes(() => undefined);
    setup(
      [shot(1, 1, 8, { mode: 'HERO', selectedCandidateId: 'cd_a' }), shot(1, 2, 7, { mode: 'HERO' }), shot(1, 3, 6, { mode: 'HERO', selectedCandidateId: 'cd_c', visualPrompt: '  ' })],
      [cand('cd_a', 1, 1, 'STILL'), cand('cd_c', 1, 3, 'STILL')]
    );
    expect(screen.getByRole('button', { name: 'Videos for every shot (1 shot · $0.64)' })).toBeInTheDocument();
    expect(screen.getByText('1 shot needs a picture before its clip.')).toBeInTheDocument();
  });

  it('a dropped connection on a clip says it may have started', async () => {
    mockFetch.mockImplementation(async (u: string, i?: RequestInit) => {
      if (u.endsWith('/video') && i?.method === 'POST') throw new TypeError('fetch failed');
      return json({ success: true, data: {} });
    });
    const list = withPictures([shot(1, 1, 8)]);
    setup(list.map((s) => ({ ...s, firstFrameCandidateId: s.selectedCandidateId! })), pics(list));
    fireEvent.click(screen.getByRole('button', { name: /Videos for every shot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await flush();
    expect(screen.getByText(/Scene 1, shot 1: The connection dropped; the clip may have started/)).toBeInTheDocument();
  });
});

describe('videos for every shot respects Still / Moving (audit 2026-11-09)', () => {
  it('a shot set to Still stays a picture: not counted, not priced, and the panel says how many', () => {
    routes(() => undefined);
    setup(
      [shot(1, 1, 8, { mode: 'HERO', selectedCandidateId: 'cd_a' }), shot(1, 2, 7, { mode: 'STILL', selectedCandidateId: 'cd_b' })],
      [cand('cd_a', 1, 1, 'STILL'), cand('cd_b', 1, 2, 'STILL')]
    );
    expect(screen.getByRole('button', { name: 'Videos for every shot (1 shot · $0.64)' })).toBeInTheDocument();
    expect(screen.getByText(/1 shot is set to Still and stays a picture/)).toBeInTheDocument();
  });
  it('a moving shot that continues from the clip before it is left to Make the video, which makes them in order', () => {
    routes(() => undefined);
    setup(
      [
        shot(1, 1, 8, { mode: 'HERO', selectedCandidateId: 'cd_a' }),
        shot(1, 2, 7, { mode: 'HERO', selectedCandidateId: 'cd_b', chainFromPrevious: true }),
      ],
      [cand('cd_a', 1, 1, 'STILL'), cand('cd_b', 1, 2, 'STILL')]
    );
    expect(screen.getByRole('button', { name: 'Videos for every shot (1 shot · $0.64)' })).toBeInTheDocument();
    expect(screen.getByText(/1 shot continues from the clip before it/)).toBeInTheDocument();
  });
  it('a chained shot after a Still shot is an ordinary moving shot and is counted', () => {
    routes(() => undefined);
    setup(
      [
        shot(1, 1, 8, { mode: 'STILL', selectedCandidateId: 'cd_a' }),
        shot(1, 2, 7, { mode: 'HERO', selectedCandidateId: 'cd_b', chainFromPrevious: true }),
      ],
      [cand('cd_a', 1, 1, 'STILL'), cand('cd_b', 1, 2, 'STILL')]
    );
    expect(screen.getByRole('button', { name: 'Videos for every shot (1 shot · $0.56)' })).toBeInTheDocument();
  });
});

describe('your own clips', () => {
  it('a row holding your own clip is never counted for Pictures for every shot', () => {
    const base = { sceneOrder: 1, mode: 'HERO', durationSec: 8, startSec: 0, negativePrompt: '', charIds: [], selectedCandidateId: null } as const;
    const own = { ...base, shotOrder: 1, visualPrompt: 'Your own clip.' } as unknown as Shot;
    const plain = { ...base, shotOrder: 2, visualPrompt: 'A lamp' } as unknown as Shot;
    expect(shotsNeedingPicture([own, plain], [])).toEqual([plain]);
  });
});
