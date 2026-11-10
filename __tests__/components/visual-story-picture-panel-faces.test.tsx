/** @jest-environment jsdom */
/**
 * "Video from your pictures" — keeping faces. Pinned: a new picture includes
 * every character; each moving picture shows who is in it and saves a change
 * as the shot's cast; without characters the panel says how to keep faces.
 * (The photos themselves are sent by buildVideoRequest, tested with the route.)
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { PicturePanel } from '@/components/admin/visual-story/PicturePanel';
import { __resetPlayUrlCacheForTests } from '@/components/admin/visual-story/ui-utils';
import type { Candidate, Character, Scene, Shot, VisualStory } from '@/types/visualStory';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/lib/mastering-upload-client', () => ({ putToS3: jest.fn(async () => undefined) }));
jest.mock('@/lib/visual-story-last-frame', () => ({ grabLastFrame: jest.fn() }));
const mockFetch = adminFetch as jest.Mock;

const VS = 'vs_1700000000000_abcdef12';
const HUS = 'ch_1700000000000_husband1';
const WIFE = 'ch_1700000000000_wifewife';
const story = { vsId: VS, spentUsd: 0, reservedUsd: 0, budgetUsdCap: 10, aspectRatio: '9:16', windowStartSec: 0, windowEndSec: 16 } as unknown as VisualStory;
const scenes: Scene[] = [{ order: 1, heading: 'Your pictures', summary: '' }];
const characters: Character[] = [
  { charId: HUS, name: 'Husband', description: '', refImageKeys: ['k/h1.jpg'], createdAt: 't' },
  { charId: WIFE, name: 'Wife', description: '', refImageKeys: [], createdAt: 't' },
];
const shot = (shotOrder: number, over: Partial<Shot> = {}): Shot => ({
  sceneOrder: 1, shotOrder, mode: 'HERO', durationSec: 8, startSec: 0, visualPrompt: 'Gentle, natural movement.', negativePrompt: '', charIds: [HUS, WIFE],
  selectedCandidateId: `cd_p${shotOrder}`, ...over,
});
const pic = (shotOrder: number): Candidate => ({
  candId: `cd_p${shotOrder}`, sceneOrder: 1, shotOrder, jobId: null, providerId: 'upload', providerTaskId: null, mode: 'STILL', s3Key: `k/cd_p${shotOrder}.jpg`, costUsd: 0, createdAt: 't',
});
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
function routes(route: (url: string, init?: RequestInit) => Response | undefined) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => route(url, init) ?? json({ success: true, data: {} }));
}
const calls = () =>
  mockFetch.mock.calls.filter(([, i]) => i?.method === 'POST').map(([u, i]) => ({ url: String(u), body: i?.body ? JSON.parse(String(i.body)) : undefined }));
const flush = () => act(async () => { await jest.advanceTimersByTimeAsync(60_000); });

function setup(over: { shots?: Shot[]; candidates?: Candidate[]; characters?: Character[]; scenes?: Scene[] } = {}) {
  render(
    <PicturePanel
      vsId={VS}
      story={story}
      scenes={over.scenes ?? scenes}
      shots={over.shots ?? [shot(1), shot(2, { mode: 'STILL' })]}
      candidates={over.candidates ?? [pic(1), pic(2)]}
      genJobs={[]}
      characters={over.characters ?? characters}
      onChanged={jest.fn()}
    />
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
  __resetPlayUrlCacheForTests();
});
afterEach(() => jest.useRealTimers());

it('a new picture includes every character', async () => {
  let shotNo = 0;
  routes((u, i) => {
    if (u.endsWith('/shots')) return json({ success: true, data: { shot: { sceneOrder: 1, shotOrder: ++shotNo } } }, 201);
    if (u.endsWith('/upload')) {
      const b = JSON.parse(String(i?.body));
      return b.op === 'presign' ? json({ success: true, uploadUrl: 'https://s3', fields: {}, key: 'k' }) : json({ success: true, data: { candidate: { candId: 'cd_x' } } }, 201);
    }
    return undefined;
  });
  setup({ shots: [], candidates: [] });
  fireEvent.change(screen.getByLabelText(/Add pictures/), { target: { files: [new File(['a'], 'one.jpg', { type: 'image/jpeg' })] } });
  await flush();
  expect(calls().find((x) => x.url.endsWith('/shots'))?.body).toMatchObject({ op: 'create', mode: 'STILL', charIds: [HUS, WIFE] });
});

it('a moving picture shows who is in it; unticking saves the shot without that person', async () => {
  routes(() => undefined);
  setup();
  expect(screen.getByLabelText('Husband is in picture 1')).toBeChecked();
  expect(screen.getByLabelText('Wife is in picture 1')).toBeChecked();
  // A character without photos is flagged, since it cannot keep a face.
  expect(screen.getByText('(no photos yet)')).toBeInTheDocument();
  // A still picture is not animated, so it asks nothing.
  expect(screen.queryByLabelText('Husband is in picture 2')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Husband is in picture 1'));
  await flush();
  expect(calls()).toEqual([{ url: `/api/admin/visual-story/${VS}/shots`, body: { op: 'update', sceneOrder: 1, shotOrder: 1, charIds: [WIFE] } }]);
});

it('ticking adds the person back', async () => {
  routes(() => undefined);
  setup({ shots: [shot(1, { charIds: [WIFE] })] , candidates: [pic(1)] });
  fireEvent.click(screen.getByLabelText('Husband is in picture 1'));
  await flush();
  expect(calls()[0].body).toEqual({ op: 'update', sceneOrder: 1, shotOrder: 1, charIds: [WIFE, HUS] });
});

it('without characters it says how to keep the faces the same, and asks nothing per picture', () => {
  routes(() => undefined);
  setup({ characters: [] });
  expect(screen.getByText(/To keep the same faces in every clip, add the people/)).toBeInTheDocument();
  expect(screen.queryByText('In this picture:')).not.toBeInTheDocument();
});
