// __tests__/components/repair-marks-player.test.tsx
/** @jest-environment jsdom */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MasteringPlayer } from '@/components/admin/MasteringPlayer';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;
const JOB = 'job1';
const mark = (over: Record<string, unknown> = {}) => ({
  markId: 'm1', masterJobId: JOB, start: 102, end: null, reason: 'pronunciation', note: '', status: 'open',
  fixedIn: null, version: 1, createdAt: 't', updatedAt: 't', ...over,
});

function installAudioContext() {
  class Fake {
    destination = {};
    createMediaElementSource() { return { connect: () => {} }; }
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect: () => {} }; }
    createAnalyser() { return { fftSize: 2048, connect: () => {}, getFloatTimeDomainData: (b: Float32Array) => b.fill(0.1) }; }
    close() {}
    resume() {}
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = Fake;
}

const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

beforeEach(() => {
  installAudioContext();
  global.fetch = jest.fn().mockResolvedValue({ headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as typeof fetch;
  mockedFetch.mockReset();
});

const setup = (marks: unknown[] = []) => {
  let created = 0;
  mockedFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith(`/master/${JOB}/marks`) && (!init || !init.method || init.method === 'GET')) {
      return json(200, { success: true, marks });
    }
    if (url.endsWith(`/master/${JOB}/marks`) && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      created += 1;
      return json(201, { success: true, mark: mark({ markId: `new${created}`, ...body }) });
    }
    return json(200, { success: true });
  });
  return render(<MasteringPlayer masterUrl="https://s3/m.wav?sig=1" title="பாடல்" masterJobId={JOB} />);
};

it('loads the saved marks of this master', async () => {
  setup([mark({ note: 'ழ sung as ல' })]);
  expect(await screen.findByText('ழ sung as ல')).toBeTruthy();
});

it('M saves a moment through the API', async () => {
  setup();
  await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /Mark here/ }));
  await waitFor(() => {
    const post = mockedFetch.mock.calls.find(([, i]) => i?.method === 'POST');
    expect(JSON.parse(post![1].body)).toMatchObject({ start: 0, end: null, reason: 'pronunciation' });
  });
});

it('three quick marks are three saves, each with its own row', async () => {
  setup();
  await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
  const btn = screen.getByRole('button', { name: /Mark here/ });
  fireEvent.click(btn); fireEvent.click(btn); fireEvent.click(btn);
  await waitFor(() => expect(mockedFetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(3));
  expect(await screen.findAllByRole('listitem')).toHaveLength(3);
});

it('a failed save shows its error in that row', async () => {
  setup();
  await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
  mockedFetch.mockImplementationOnce(() => json(502, { success: false, error: 'Could not save the mark.' }));
  fireEvent.click(screen.getByRole('button', { name: /Mark here/ }));
  const row = (await screen.findByText('Could not save the mark.')).closest('li')!;
  expect(within(row).getByRole('button', { name: /Discard/ })).toBeTruthy();
});

it('a stale edit reloads the list and says so', async () => {
  setup([mark()]);
  await screen.findByRole('combobox', { name: /Status for 1:42/ });
  mockedFetch.mockImplementationOnce(() => json(409, { success: false, code: 'stale', error: 'Changed in another tab — reload to see it.' }));
  fireEvent.change(screen.getByRole('combobox', { name: /Status for 1:42/ }), { target: { value: 'fixed' } });
  expect(await screen.findByText(/Changed in another tab — reloaded/)).toBeTruthy();
  const gets = mockedFetch.mock.calls.filter(([u, i]) => String(u).endsWith('/marks') && (!i || !i.method || i.method === 'GET'));
  expect(gets.length).toBeGreaterThanOrEqual(2);
});

it('without masterJobId, marks stay in the page as before (no API calls)', async () => {
  render(<MasteringPlayer masterUrl="https://s3/m.wav?sig=1" title="x" />);
  fireEvent.click(screen.getByRole('button', { name: /Mark here/ }));
  expect(mockedFetch).not.toHaveBeenCalled();
});

it('two quick edits of one row both save, the second with the new version', async () => {
  setup([mark()]);
  const sel = await screen.findByRole('combobox', { name: /Status for 1:42/ });
  mockedFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const b = JSON.parse(String(init.body));
      return json(200, { success: true, mark: mark({ status: b.status, version: b.version + 1 }) });
    }
    return json(200, { success: true, marks: [mark()] });
  });
  fireEvent.change(sel, { target: { value: 'fixed' } });
  fireEvent.change(sel, { target: { value: 'wont-fix' } });
  await waitFor(() => expect(mockedFetch.mock.calls.filter(([, i]) => i?.method === 'PATCH')).toHaveLength(2));
  const patches = mockedFetch.mock.calls.filter(([, i]) => i?.method === 'PATCH').map(([, i]) => JSON.parse(i.body));
  expect(patches.map((p) => p.version)).toEqual([1, 2]);
  expect(screen.queryByText(/Changed in another tab/)).toBeNull();
});

it('a failed reload keeps the saved rows and shows an error banner', async () => {
  setup([mark({ note: 'keep me' })]);
  await screen.findByText('keep me');
  mockedFetch.mockImplementationOnce(() => json(409, { success: false, code: 'stale', error: 'x' }));
  mockedFetch.mockImplementationOnce(() => json(500, { success: false, error: 'Could not load the marks.' }));
  fireEvent.change(screen.getByRole('combobox', { name: /Status for 1:42/ }), { target: { value: 'fixed' } });
  expect(await screen.findByText('Could not load the marks.')).toBeTruthy();
  expect(screen.getByText('keep me')).toBeTruthy();
});
