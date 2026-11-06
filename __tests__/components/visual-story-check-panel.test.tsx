/** @jest-environment jsdom */
/**
 * COMPONENT TESTS — the storyboard check panel. What the owner must be able
 * to trust: the price is on the button, the lyrics are sent once and cleared,
 * each problem opens its shot, an edited storyboard says the check is out of
 * date, and a failure is said inside the panel.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CheckPanel } from '@/components/admin/visual-story/CheckPanel';
import { adminFetch } from '@/lib/client-auth';
import { buildCheckInput, buildCheckMessage } from '@/lib/visual-story-check';
import { checkReserveUsd } from '@/services/video/cost';
import type { Shot, VisualStory } from '@/types/visualStory';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/lib/poll-job', () => ({ pollJob: jest.fn(async () => ({ checkId: 'ck_1' })) }));
const mockFetch = adminFetch as jest.Mock;

const VS = 'vs_1730000000000_abcdef12';
const CK = 'ck_1730000000000_abcdef12';
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

const story = { vsId: VS, aspectRatio: '16:9', windowStartSec: 0, windowEndSec: 30, style: '' } as unknown as VisualStory;
const scenes = [{ order: 1, heading: 'One', summary: 's' }];
const shots: Shot[] = [
  { sceneOrder: 1, shotOrder: 1, mode: 'STILL', durationSec: 15, startSec: 0, visualPrompt: 'a', negativePrompt: '', charIds: [], selectedCandidateId: null },
  { sceneOrder: 1, shotOrder: 2, mode: 'STILL', durationSec: 15, startSec: 15, visualPrompt: 'b', negativePrompt: '', charIds: [], selectedCandidateId: null },
];
const done = {
  checkId: CK, status: 'done', createdAt: '2026-11-06T10:00:00Z', updatedAt: 't', reservedUsd: 0.07, shotsHash: 'h',
  withLyrics: true, summary: 'Two small problems.', costUsd: 0.03,
  issues: [
    { kind: 'text', sceneOrder: 1, shotOrder: 2, problem: 'A shop sign will show words.', suggestion: 'Say "a plain wooden shopfront".' },
    { kind: 'repeat', sceneOrder: 1, shotOrder: 7, problem: 'Gone shot.', suggestion: 'x' },
  ],
};

function setup(latest: { check: unknown; outOfDate: boolean }, post?: () => Response) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/check') && init?.method === 'POST') return post ? post() : json({ success: true, data: { checkId: CK } }, 202);
    if (url.endsWith('/check')) return json({ success: true, data: latest });
    return json({ success: false }, 404);
  });
  const onOpen = jest.fn();
  const onChanged = jest.fn();
  render(<CheckPanel vsId={VS} story={story} scenes={scenes} shots={shots} characters={[]} onOpen={onOpen} onChanged={onChanged} />);
  return { onOpen, onChanged };
}

beforeEach(() => mockFetch.mockReset());

it('shows the price, and the last check with links that open each shot', async () => {
  const { onOpen } = setup({ check: done, outOfDate: false });
  const price = checkReserveUsd(buildCheckMessage(buildCheckInput({ story, scenes, shots, characters: [] })).length);
  expect(screen.getByRole('button', { name: `Check storyboard (up to $${price.toFixed(2)})` })).toBeInTheDocument();

  expect(await screen.findByText('Two small problems.')).toBeInTheDocument();
  expect(screen.getByText('Words in the picture')).toBeInTheDocument();
  expect(screen.getByText(/with lyrics · \$0\.03/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Scene 1, shot 2' }));
  expect(onOpen).toHaveBeenCalledWith(1, 2);
  // A shot deleted since the check is named, not linked.
  expect(screen.getByText('Scene 1, shot 7 (gone)')).toBeInTheDocument();
  expect(screen.queryByText(/changed the storyboard/)).not.toBeInTheDocument();
});

it('says when the storyboard changed since the check', async () => {
  setup({ check: done, outOfDate: true });
  expect(await screen.findByText(/You have changed the storyboard since this check/)).toBeInTheDocument();
});

it('says so plainly when nothing was found', async () => {
  setup({ check: { ...done, issues: [], summary: 'Ready to generate.' }, outOfDate: false });
  expect(await screen.findByText('No problems found.')).toBeInTheDocument();
});

it('sends the lyrics once, clears them, and reloads the spend', async () => {
  const { onChanged } = setup({ check: null, outOfDate: false });
  const box = screen.getByLabelText(/Lyrics \(optional/);
  fireEvent.change(box, { target: { value: 'Placeholder line' } });
  fireEvent.click(screen.getByRole('button', { name: /Check storyboard/ }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  const post = mockFetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(post[1].body)).toEqual({ lyrics: 'Placeholder line' });
  expect((box as HTMLTextAreaElement).value).toBe('');
});

it('shows a refusal inside the panel', async () => {
  setup({ check: null, outOfDate: false }, () => json({ success: false, error: 'A check is already running. Wait for it to finish.' }, 409));
  fireEvent.click(screen.getByRole('button', { name: /Check storyboard/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A check is already running. Wait for it to finish.');
});

it('shows why the last check failed', async () => {
  setup({ check: { ...done, status: 'failed', error: 'The check took too long. Please try again.' }, outOfDate: false });
  expect(await screen.findByText('Last check failed: The check took too long. Please try again.')).toBeInTheDocument();
});
