/** @jest-environment jsdom */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/components/admin/MasteringComparePlayer', () => ({ MasteringComparePlayer: () => null }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MasteringStudio } from '@/components/admin/MasteringStudio';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;
const base = {
  status: 'done', createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
  target: -14, beforeLufs: -17.9, beforeTp: -1.2, afterLufs: -14, afterTp: -1,
  beforeLra: 3, afterLra: 3, normalizationType: 'linear', source: null, error: null,
};
const parent = { ...base, id: 'p1', s3Key: 'audio/mastering/in.wav', masterKey: 'audio/mastering/in_p1-master-14LUFS.wav', savedAt: '2026-07-30T16:00:00.000Z', title: 'ஈழத்து மண்ணே' };
const child = { ...base, id: 'c1', s3Key: 'audio/mastering/stems/p1/remix.wav', masterKey: 'audio/mastering/stems/p1/remix_c1-master-14LUFS.wav', savedAt: '2026-07-31T16:00:00.000Z', title: 'ஈழத்து மண்ணே — remix', derivedFrom: { jobId: 'p1', via: 'stem-remix' } };

function routeFetch() {
  mockedFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/masters')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, masters: [child, parent] }) } as Response);
    }
    if (url === '/api/admin/music-lab/master' && init?.method === 'POST') {
      return Promise.resolve({ ok: true, status: 202, json: async () => ({ success: true, jobId: 'new1', status: 'queued' }) } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

beforeEach(() => {
  mockedFetch.mockReset();
  window.history.replaceState({}, '', '/admin/mastering');
  window.localStorage.clear();
  window.sessionStorage.clear();
});

it('labels a derived master with its parent', async () => {
  routeFetch();
  render(<MasteringStudio />);
  fireEvent.click(screen.getByRole('button', { name: /Saved masters/i }));
  expect(await screen.findByText('Remix of ஈழத்து மண்ணே')).toBeTruthy();
});

it('sends the reopened master as the parent of the new job', async () => {
  routeFetch();
  render(<MasteringStudio />);
  fireEvent.click(screen.getByRole('button', { name: /Saved masters/i }));
  await screen.findByText('Remix of ஈழத்து மண்ணே');
  // Rows render newest first: [child, parent]. The reopen button reads "Edit & re-master".
  fireEvent.click(screen.getAllByRole('button', { name: /Edit & re-master/ })[1]);
  fireEvent.click(await screen.findByRole('button', { name: /Master to -14 LUFS/ }));
  await waitFor(() => {
    const post = mockedFetch.mock.calls.find(([u, i]) => u === '/api/admin/music-lab/master' && i?.method === 'POST');
    expect(post).toBeTruthy();
    expect(JSON.parse(post![1].body).derivedFrom).toEqual({ jobId: 'p1' });
  });
});

it('reads ?parent= from a Master-this-remix link', async () => {
  routeFetch();
  window.history.replaceState({}, '', `/admin/mastering?source=${encodeURIComponent('audio/mastering/stems/p1/remix.wav')}&title=x&target=-14&parent=p1`);
  render(<MasteringStudio />);
  fireEvent.click(await screen.findByRole('button', { name: /Master to -14 LUFS/ }));
  await waitFor(() => {
    const post = mockedFetch.mock.calls.find(([u, i]) => u === '/api/admin/music-lab/master' && i?.method === 'POST');
    expect(JSON.parse(post![1].body).derivedFrom).toEqual({ jobId: 'p1' });
  });
});

it('a recovered job in progress wins over a ?parent= link, and gets no parent', async () => {
  routeFetch();
  // readStored() reads sessionStorage['mastering-studio-job'] (a StoredJob).
  window.sessionStorage.setItem('mastering-studio-job', JSON.stringify({
    jobId: 'running1', sourceKey: 'audio/mastering/other.wav', name: 'other.wav', size: 1, target: -14,
  }));
  window.history.replaceState({}, '', `/admin/mastering?source=${encodeURIComponent('audio/mastering/in.wav')}&parent=p1`);
  render(<MasteringStudio />);
  expect(await screen.findByText(/A job already in progress was reopened instead of the link/)).toBeTruthy();
  const posts = mockedFetch.mock.calls.filter(([u, i]) => u === '/api/admin/music-lab/master' && i?.method === 'POST');
  expect(posts).toHaveLength(0);
});

it('re-opening another master replaces the pending parent', async () => {
  routeFetch();
  render(<MasteringStudio />);
  fireEvent.click(screen.getByRole('button', { name: /Saved masters/i }));
  await screen.findByText('Remix of ஈழத்து மண்ணே');
  fireEvent.click(screen.getAllByRole('button', { name: /Edit & re-master/ })[1]); // parent
  // Re-opening closes the library panel; open it again to pick the child.
  fireEvent.click(screen.getByRole('button', { name: /Saved masters/i }));
  fireEvent.click((await screen.findAllByRole('button', { name: /Edit & re-master/ }))[0]); // then the child
  fireEvent.click(await screen.findByRole('button', { name: /Master to -14 LUFS/ }));
  await waitFor(() => {
    const post = mockedFetch.mock.calls.find(([u, i]) => u === '/api/admin/music-lab/master' && i?.method === 'POST');
    expect(JSON.parse(post![1].body).derivedFrom).toEqual({ jobId: 'c1' });
  });
});
