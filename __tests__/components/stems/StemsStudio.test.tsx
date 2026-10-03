/** @jest-environment jsdom */
// __tests__/components/stems/StemsStudio.test.tsx
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const uploadMock = jest.fn();
jest.mock('@/lib/mastering-upload-client', () => ({ uploadToWorkspace: (...a: unknown[]) => uploadMock(...a), putToS3: jest.fn() }));

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { StemsStudio } from '@/components/admin/stems/StemsStudio';
import { adminFetch } from '@/lib/client-auth';
const mockedFetch = adminFetch as jest.Mock;

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
const ID = '1696000000000_ab12cd34_2_Drums';
const KEY = `audio/mastering/stems/${JOB}/${ID}.wav`;
const ok = (b: unknown) => ({ ok: true, json: async () => b }) as Response;
const refuse = (error: string, status = 400) => ({ ok: false, status, json: async () => ({ success: false, error }) }) as Response;
const SET = {
  masterJobId: JOB, order: [ID],
  stems: { [ID]: { key: KEY, name: 'Drums', previewKey: `audio/mastering/stems/${JOB}/preview/${ID}.m4a`, previewError: null, durationSec: 221.9, sampleRate: 48000, channels: 2 } },
  mix: {}, remix: null, createdAt: 't', updatedAt: 't',
};
function route(over: Partial<Record<'get' | 'add' | 'patch' | 'del' | 'play', Response>> = {}, set: unknown = SET) {
  mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
    const m = init?.method ?? 'GET';
    if (url === `/api/admin/stems/${JOB}` && m === 'GET') return Promise.resolve(over.get ?? ok({ success: true, set, master: { id: JOB, title: 'பாடல்', target: -14 } }));
    if (url === `/api/admin/stems/${JOB}/stems` && m === 'POST') return Promise.resolve(over.add ?? ok({ success: true, set }));
    if (url.startsWith(`/api/admin/stems/${JOB}/stems/`) && m === 'PATCH') return Promise.resolve(over.patch ?? ok({ success: true }));
    if (url.startsWith(`/api/admin/stems/${JOB}/stems/`) && m === 'DELETE') return Promise.resolve(over.del ?? ok({ success: true }));
    if (url.startsWith('/api/admin/mastering/download')) return Promise.resolve(over.play ?? ok({ success: true, url: 'https://s3/p' }));
    return Promise.resolve(ok({}));
  });
}
beforeEach(() => { mockedFetch.mockReset(); uploadMock.mockReset().mockResolvedValue(KEY); });

it('names the song and lists its stems with length and rate', async () => {
  route();
  render(<StemsStudio masterJobId={JOB} />);
  expect(await screen.findByText('பாடல்')).toBeInTheDocument();
  const row = screen.getByRole('listitem', { name: /Drums/ });
  expect(within(row).getByText(/3:42/)).toBeInTheDocument();
  expect(within(row).getByText(/48 kHz/)).toBeInTheDocument();
});

it('uploads dropped stems as stems of THIS master, then registers each', async () => {
  route({}, null);
  render(<StemsStudio masterJobId={JOB} />);
  await screen.findByText('பாடல்');
  const input = screen.getByLabelText(/Add stem WAVs/i);
  fireEvent.change(input, { target: { files: [new File(['x'], '2_Drums.wav', { type: 'audio/wav' })] } });
  await waitFor(() => expect(uploadMock).toHaveBeenCalled());
  expect(uploadMock.mock.calls[0][3]).toBe('stem');
  expect(uploadMock.mock.calls[0][4]).toEqual({ masterJobId: JOB });
  await waitFor(() => {
    const add = mockedFetch.mock.calls.find((c) => c[0] === `/api/admin/stems/${JOB}/stems`);
    expect(JSON.parse(add![1].body)).toEqual({ key: KEY, filename: '2_Drums.wav' });
  });
});

it('shows "Preparing listening copy…" until the copy exists', async () => {
  route({}, { ...SET, stems: { [ID]: { ...SET.stems[ID], previewKey: null } } });
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  expect(within(row).getByText(/Preparing listening copy/)).toBeInTheDocument();
});

it('renames a stem inline', async () => {
  route();
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  fireEvent.click(within(row).getByRole('button', { name: /Rename Drums/ }));
  const box = within(row).getByLabelText(/Stem name/);
  fireEvent.change(box, { target: { value: 'Kick and snare' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => {
    const call = mockedFetch.mock.calls.find((c) => String(c[0]).endsWith(`/stems/${ID}`) && c[1]?.method === 'PATCH');
    expect(JSON.parse(call![1].body)).toEqual({ name: 'Kick and snare' });
  });
});

it('reports a refused removal inside that stem\'s row', async () => {
  route({ del: refuse('That stem is no longer in the set.', 404) });
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  fireEvent.click(within(row).getByRole('button', { name: /Remove Drums/ }));
  await waitFor(() => expect(within(row).getByRole('alert')).toHaveTextContent(/no longer in the set/));
});

it('flags a stem whose rate differs from the rest', async () => {
  const B = '1696000000001_ab12cd35_Bass';
  route({}, { ...SET, order: [ID, B, 'c'], stems: {
    [ID]: SET.stems[ID],
    [B]: { ...SET.stems[ID], key: `audio/mastering/stems/${JOB}/${B}.wav`, name: 'Bass', sampleRate: 44100 },
    c: { ...SET.stems[ID], key: `audio/mastering/stems/${JOB}/c.wav`, name: 'Strings' },
  } });
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Bass/ });
  expect(within(row).getByText(/44\.1 kHz — will be resampled to 48 kHz/)).toBeInTheDocument();
});

it('downloads a stem\'s full WAV, not its listening copy', async () => {
  route();
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  fireEvent.click(within(row).getByRole('button', { name: /Download Drums/ }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('https://s3/p', '_blank', 'noopener'));
  const call = mockedFetch.mock.calls.find((c) => String(c[0]).startsWith('/api/admin/mastering/download'))!;
  expect(String(call[0])).toContain(`key=${encodeURIComponent(KEY)}`);
  expect(String(call[0])).not.toContain('mode=play');
  open.mockRestore();
});

it('never says SUNO', async () => {
  route();
  render(<StemsStudio masterJobId={JOB} />);
  await screen.findByText('பாடல்');
  expect(document.body.textContent).not.toMatch(/suno/i);
});

// Not in the brief's Step 1 fixture, but the Task 4 interface says the add
// route "may include previewQueued: false" — left unhandled, that stem would
// sit at previewKey: null forever with no visible error and no way to
// recover. This covers the recovery path: a row error with a Retry that
// re-registers the already-uploaded key rather than re-uploading the file.
it('flags a stem whose preview render could not be queued, and retries by re-registering only', async () => {
  route({ add: ok({ success: true, set: SET, previewQueued: false }) }, null);
  render(<StemsStudio masterJobId={JOB} />);
  await screen.findByText('பாடல்');
  const input = screen.getByLabelText(/Add stem WAVs/i);
  fireEvent.change(input, { target: { files: [new File(['x'], '2_Drums.wav', { type: 'audio/wav' })] } });
  await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/didn't start/);

  fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
  await waitFor(() => {
    const posts = mockedFetch.mock.calls.filter(
      (c) => c[0] === `/api/admin/stems/${JOB}/stems` && c[1]?.method === 'POST'
    );
    expect(posts.length).toBe(2);
  });
  // Still exactly one upload — the retry re-posted the same key, it did not
  // send the file to S3 a second time.
  expect(uploadMock).toHaveBeenCalledTimes(1);
});
