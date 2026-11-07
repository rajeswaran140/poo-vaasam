/**
 * BackgroundClipsField — the background clips of a Mastering render, one or a
 * story's 10-20 (2026-11-07). What must hold: the list plays in the order on
 * screen, a story's clips arrive in story order without being uploaded again,
 * a shot with no clip is said, and the list never grows past twenty.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/lib/mastering-upload-client', () => ({ uploadToWorkspace: jest.fn() }));

import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BackgroundClipsField, type BackgroundClip } from '@/components/admin/BackgroundClipsField';
import { adminFetch } from '@/lib/client-auth';
import { uploadToWorkspace } from '@/lib/mastering-upload-client';

const fetchMock = adminFetch as jest.Mock;
const uploadMock = uploadToWorkspace as jest.Mock;
const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const P = 'audio/mastering/visual-story/vs_a/candidates/';

let latest: BackgroundClip[] = [];
let lastError: string | null = null;
function Harness({ initial = [] as BackgroundClip[], masterJobId = 'm1' as string | null }) {
  const [clips, setClips] = useState<BackgroundClip[]>(initial);
  latest = clips;
  return (
    <BackgroundClipsField
      idPrefix="t"
      clips={clips}
      onChange={(u) => setClips((prev) => u(prev))}
      masterJobId={masterJobId}
      songSeconds={361}
      disabled={false}
      onError={(m) => { lastError = m; }}
    />
  );
}

const story = { vsId: 'vs_a', title: 'Homeland story', updatedAt: '2026-11-07T01:00:00Z' };
const tree = {
  shots: [
    { sceneOrder: 1, shotOrder: 1, selectedCandidateId: 'c_1', durationSec: 15 },
    { sceneOrder: 1, shotOrder: 2, selectedCandidateId: null, durationSec: 15 },
    { sceneOrder: 2, shotOrder: 1, selectedCandidateId: 'c_3', durationSec: 10 },
  ],
  candidates: [
    { candId: 'c_1', sceneOrder: 1, shotOrder: 1, s3Key: `${P}c_1.mp4`, createdAt: '2026-11-07T00:00:00Z' },
    { candId: 'c_3', sceneOrder: 2, shotOrder: 1, s3Key: `${P}c_3.mp4`, createdAt: '2026-11-07T00:00:00Z' },
  ],
};

beforeEach(() => {
  fetchMock.mockReset();
  uploadMock.mockReset();
  latest = [];
  lastError = null;
});

const clip = (name: string) => new File(['x'], name, { type: 'video/mp4' });

it('uploads several files in the order picked, as backgrounds', async () => {
  uploadMock.mockResolvedValueOnce('audio/mastering/1_a_one.mp4').mockResolvedValueOnce('audio/mastering/1_b_two.mp4');
  render(<Harness />);
  fireEvent.change(screen.getByLabelText(/^Background videos or GIFs/), { target: { files: [clip('one.mp4'), clip('two.mp4')] } });
  await waitFor(() => expect(latest.map((c) => c.key)).toEqual(['audio/mastering/1_a_one.mp4', 'audio/mastering/1_b_two.mp4']));
  expect(uploadMock).toHaveBeenCalledWith(expect.any(File), expect.any(Function), expect.any(AbortSignal), 'background');
  expect(screen.getByText('2 clips')).toBeInTheDocument();
});

it('moves and removes clips, and the order on screen is the order kept', () => {
  render(<Harness initial={[{ key: 'k1', name: 'one' }, { key: 'k2', name: 'two' }, { key: 'k3', name: 'three' }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move clip 3 up' }));
  expect(latest.map((c) => c.key)).toEqual(['k1', 'k3', 'k2']);
  fireEvent.click(screen.getByRole('button', { name: 'Move clip 1 down' }));
  expect(latest.map((c) => c.key)).toEqual(['k3', 'k1', 'k2']);
  expect(screen.getByRole('button', { name: 'Move clip 1 up' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove clip 2' }));
  expect(latest.map((c) => c.key)).toEqual(['k3', 'k2']);
  fireEvent.click(screen.getByRole('button', { name: 'Remove all' }));
  expect(latest).toEqual([]);
});

it("adds a story's clips in story order, without uploading, and says which shots have none", async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url.startsWith('/api/admin/visual-story?masterJobId=m1') ? json({ success: true, data: [story] })
      : url === '/api/admin/visual-story/vs_a' ? json({ success: true, data: tree })
      : json({ success: false }, false));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Add clips from a visual story' }));
  fireEvent.change(await screen.findByLabelText('Visual story'), { target: { value: 'vs_a' } });
  expect(await screen.findByText(/2 clips, in story order · 0:25 of video/)).toBeInTheDocument();
  expect(screen.getByText('No clip yet, left out: Scene 1, shot 2.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 clips' }));
  expect(latest).toEqual([
    { key: `${P}c_1.mp4`, name: 'Scene 1, shot 1', seconds: 15 },
    { key: `${P}c_3.mp4`, name: 'Scene 2, shot 1', seconds: 10 },
  ]);
  expect(uploadMock).not.toHaveBeenCalled();
  // The total, and that a 6:01 song repeats them.
  expect(screen.getByText('2 clips · 0:25 of video · the song is 6:01, so the clips repeat from clip 1')).toBeInTheDocument();
});

it('lists every story when none is linked to this song, and says so', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url.includes('masterJobId') ? json({ success: true, data: [] }) : json({ success: true, data: [story] }));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Add clips from a visual story' }));
  expect(await screen.findByText('No story is linked to this song, so every story is listed.')).toBeInTheDocument();
  expect(within(screen.getByLabelText('Visual story')).getByRole('option', { name: 'Homeland story' })).toBeInTheDocument();
});

it('never grows past twenty clips, and says what did not fit', async () => {
  const nineteen = Array.from({ length: 19 }, (_, i) => ({ key: `k${i}`, name: `c${i}` }));
  fetchMock.mockImplementation(async (url: string) =>
    url.includes('masterJobId') ? json({ success: true, data: [story] }) : json({ success: true, data: tree }));
  render(<Harness initial={nineteen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add clips from a visual story' }));
  fireEvent.change(await screen.findByLabelText('Visual story'), { target: { value: 'vs_a' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Add 1 clip' }));
  expect(latest).toHaveLength(20);
  expect(lastError).toBe("Only the first 1 of the story's 2 clips fit — 20 clips at most.");
  // Full: no more ways to add.
  expect(screen.queryByRole('button', { name: 'Add clips from a visual story' })).toBeNull();
  expect(screen.queryByLabelText(/^Background videos or GIFs/)).toBeNull();
});
