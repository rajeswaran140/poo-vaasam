/** @jest-environment jsdom */
// __tests__/components/stems/StemsStudio.test.tsx
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const uploadMock = jest.fn();
jest.mock('@/lib/mastering-upload-client', () => ({ uploadToWorkspace: (...a: unknown[]) => uploadMock(...a), putToS3: jest.fn() }));

import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
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
function route(over: Partial<Record<'get' | 'add' | 'patch' | 'del' | 'play' | 'remix', Response>> = {}, set: unknown = SET) {
  mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
    const m = init?.method ?? 'GET';
    if (url === `/api/admin/stems/${JOB}` && m === 'GET') return Promise.resolve(over.get ?? ok({ success: true, set, master: { id: JOB, title: 'பாடல்', target: -14 } }));
    if (url === `/api/admin/stems/${JOB}/stems` && m === 'POST') return Promise.resolve(over.add ?? ok({ success: true, set }));
    if (url.startsWith(`/api/admin/stems/${JOB}/stems/`) && m === 'PATCH') return Promise.resolve(over.patch ?? ok({ success: true }));
    if (url.startsWith(`/api/admin/stems/${JOB}/stems/`) && m === 'DELETE') return Promise.resolve(over.del ?? ok({ success: true }));
    if (url === `/api/admin/stems/${JOB}/remix` && m === 'POST') return Promise.resolve(over.remix ?? ok({ success: true, status: 'queued' }));
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
  route({}, { ...SET, stems: { [ID]: { ...SET.stems[ID], previewKey: null, previewRequestedAt: new Date().toISOString() } } });
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  expect(within(row).getByText(/Preparing listening copy/)).toBeInTheDocument();
});

it('still shows "Preparing listening copy…" (no alert) for a stem requested under 5 minutes ago', async () => {
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  route({}, { ...SET, stems: { [ID]: { ...SET.stems[ID], previewKey: null, previewRequestedAt: fresh } } });
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  expect(within(row).getByText(/Preparing listening copy/)).toBeInTheDocument();
  expect(within(row).queryByRole('alert')).toBeNull();
});

it('shows "Taking longer than expected" and a Retry for a stem stuck more than 5 minutes, and stops polling it', async () => {
  jest.useFakeTimers();
  try {
    const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    route({}, { ...SET, stems: { [ID]: { ...SET.stems[ID], previewKey: null, previewRequestedAt: stale } } });
    render(<StemsStudio masterJobId={JOB} />);
    const row = await screen.findByRole('listitem', { name: /Drums/ });
    expect(within(row).getByRole('alert')).toHaveTextContent(/Taking longer than expected/);
    expect(within(row).getByRole('button', { name: /Retry Drums/ })).toBeInTheDocument();

    const getCallsBefore = mockedFetch.mock.calls.filter((c) => c[0] === `/api/admin/stems/${JOB}`).length;
    fireEvent.click(document.body); // no-op interaction, just lets effects settle
    jest.advanceTimersByTime(10000);
    await Promise.resolve();
    await Promise.resolve();
    const getCallsAfter = mockedFetch.mock.calls.filter((c) => c[0] === `/api/admin/stems/${JOB}`).length;
    expect(getCallsAfter).toBe(getCallsBefore);
  } finally {
    jest.useRealTimers();
  }
});

it('treats a stem with no previewRequestedAt (added before the field existed) as stale immediately', async () => {
  route({}, { ...SET, stems: { [ID]: { ...SET.stems[ID], previewKey: null, previewRequestedAt: null } } });
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  expect(within(row).getByRole('alert')).toHaveTextContent(/Taking longer than expected/);
});

it('keeps polling after a failed GET mid-poll, and still shows the load error at the top', async () => {
  jest.useFakeTimers();
  try {
    const pendingSet = { ...SET, stems: { [ID]: { ...SET.stems[ID], previewKey: null, previewRequestedAt: new Date().toISOString() } } };
    let getCalls = 0;
    mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
      const m = init?.method ?? 'GET';
      if (url === `/api/admin/stems/${JOB}` && m === 'GET') {
        getCalls++;
        if (getCalls === 2) return Promise.resolve(refuse('Could not load the stems.', 502));
        return Promise.resolve(ok({ success: true, set: pendingSet, master: { id: JOB, title: 'பாடல்', target: -14 } }));
      }
      return Promise.resolve(ok({}));
    });
    render(<StemsStudio masterJobId={JOB} />);
    await screen.findByText(/Preparing listening copy/);
    expect(getCalls).toBe(1);

    jest.advanceTimersByTime(4000);
    await waitFor(() => expect(getCalls).toBe(2));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Could not load the stems/));

    jest.advanceTimersByTime(4000);
    await waitFor(() => expect(getCalls).toBe(3));
  } finally {
    jest.useRealTimers();
  }
});

it('renames a stem inline', async () => {
  route();
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  fireEvent.click(within(row).getByRole('button', { name: /Rename Drums/ }));
  const box = within(row).getByLabelText(/Stem name/);
  expect(box).toHaveAttribute('maxLength', '80');
  fireEvent.change(box, { target: { value: 'Kick and snare' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => {
    const call = mockedFetch.mock.calls.find((c) => String(c[0]).endsWith(`/stems/${ID}`) && c[1]?.method === 'PATCH');
    expect(JSON.parse(call![1].body)).toEqual({ name: 'Kick and snare' });
  });
});

it('asks to confirm before removing a stem, and does not DELETE when declined', async () => {
  route();
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  fireEvent.click(within(row).getByRole('button', { name: /Remove Drums/ }));
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/Remove Drums\?.*upload it again/));
  await Promise.resolve();
  expect(mockedFetch.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false);
  confirmSpy.mockRestore();
});

it('removes the stem once the confirmation is accepted', async () => {
  route();
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  fireEvent.click(within(row).getByRole('button', { name: /Remove Drums/ }));
  await waitFor(() => expect(mockedFetch.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(true));
  confirmSpy.mockRestore();
});

it('does not render the upload area when the master cannot be loaded (e.g. a 404)', async () => {
  route({ get: refuse('No saved master with that id.', 404) });
  render(<StemsStudio masterJobId={JOB} />);
  await screen.findByRole('alert');
  expect(screen.queryByLabelText(/Add stem WAVs/i)).toBeNull();
});

it('reports a refused removal inside that stem\'s row', async () => {
  route({ del: refuse('That stem is no longer in the set.', 404) });
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  fireEvent.click(within(row).getByRole('button', { name: /Remove Drums/ }));
  await waitFor(() => expect(within(row).getByRole('alert')).toHaveTextContent(/no longer in the set/));
  confirmSpy.mockRestore();
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

// The add route persists an invoke failure onto the STEM itself now
// (previewError, written server-side — see admin-stems.test.ts), so the
// uploaded stem's row owns the one alert and the one Retry. StemUpload's
// queue row just says "Added": the worker invoke is a 201, after all, and
// showing a second, differently-worded alert there would be two sources of
// truth for the same failure.
it('persists a worker-invoke failure onto the stem itself, with one alert and one Retry', async () => {
  const MESSAGE = 'The listening copy could not be started — press Retry.';
  const failedSet = { ...SET, stems: { [ID]: { ...SET.stems[ID], previewKey: null, previewError: MESSAGE } } };
  route({ add: ok({ success: true, set: failedSet, previewQueued: false }) }, null);
  render(<StemsStudio masterJobId={JOB} />);
  await screen.findByText('பாடல்');
  const input = screen.getByLabelText(/Add stem WAVs/i);
  fireEvent.change(input, { target: { files: [new File(['x'], '2_Drums.wav', { type: 'audio/wav' })] } });
  await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));

  const row = await screen.findByRole('listitem', { name: /Drums/ });
  // Exactly one alert in the whole page, and it lives in the stem's own row.
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(within(row).getByRole('alert')).toHaveTextContent(MESSAGE);

  fireEvent.click(within(row).getByRole('button', { name: /Retry Drums/ }));
  await waitFor(() => {
    const posts = mockedFetch.mock.calls.filter(
      (c) => c[0] === `/api/admin/stems/${JOB}/stems` && c[1]?.method === 'POST'
    );
    expect(posts.length).toBe(2);
  });
  // The retry re-POSTs the stem's key directly — it never re-uploads.
  expect(uploadMock).toHaveBeenCalledTimes(1);
});

// A worker-invoke failure is now PERSISTED on the stem (previewError in the
// loaded set), not just held in StemUpload's own local, reload-losing state.
// A stem loaded straight off GET with previewError set must show the same
// alert + a way to retry — otherwise a reload loses the Retry entirely and
// the row is stuck looking exactly like one still rendering.
it("shows a loaded stem's previewError with a Retry that re-POSTs the same key", async () => {
  const MESSAGE = 'The listening copy could not be started — press Retry.';
  // The retry succeeds server-side (the route clears the error and the
  // worker invoke goes through this time) — SET itself, unmodified, is a
  // realistic "cleared" response.
  route(
    { add: ok({ success: true, set: SET }) },
    { ...SET, stems: { [ID]: { ...SET.stems[ID], previewKey: null, previewError: MESSAGE } } }
  );
  render(<StemsStudio masterJobId={JOB} />);
  const row = await screen.findByRole('listitem', { name: /Drums/ });
  expect(within(row).getByRole('alert')).toHaveTextContent(MESSAGE);

  fireEvent.click(within(row).getByRole('button', { name: /Retry Drums/ }));
  await waitFor(() => {
    const call = mockedFetch.mock.calls.find(
      (c) => c[0] === `/api/admin/stems/${JOB}/stems` && c[1]?.method === 'POST'
    );
    expect(call).toBeDefined();
    const body = JSON.parse(call![1].body);
    expect(body.key).toBe(KEY);
    expect(typeof body.filename).toBe('string');
    expect(body.filename.length).toBeGreaterThan(0);
  });
  // The set refreshes from the retry's own response — the row stops
  // showing the alert without a separate reload or poll tick.
  await waitFor(() => expect(within(row).queryByRole('alert')).toBeNull());
});

describe('rendering a remix', () => {
  const REMIX_KEY = `audio/mastering/stems/${JOB}/remix/1696000000000-remix.wav`;
  const renderedSet = {
    ...SET,
    remix: {
      key: REMIX_KEY,
      renderedAt: '2026-10-03T00:00:00.000Z',
      mixUsed: {},
      notes: ['Drums resampled from 44.1 kHz to 48 kHz'],
      error: null,
      requestedAt: '2026-10-02T23:59:00.000Z',
    },
  };

  it('renders a remix, shows it ready with its notes and a player, and links to Master this remix', async () => {
    jest.useFakeTimers();
    try {
      let getCalls = 0;
      mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
        const m = init?.method ?? 'GET';
        if (url === `/api/admin/stems/${JOB}` && m === 'GET') {
          getCalls++;
          return Promise.resolve(ok({
            success: true,
            set: getCalls === 1 ? SET : renderedSet,
            master: { id: JOB, title: 'பாடல்', target: -14 },
          }));
        }
        if (url === `/api/admin/stems/${JOB}/remix` && m === 'POST') return Promise.resolve(ok({ success: true, status: 'queued' }));
        if (url.startsWith('/api/admin/mastering/download')) return Promise.resolve(ok({ success: true, url: 'https://s3/remix-play' }));
        return Promise.resolve(ok({}));
      });

      const { container } = render(<StemsStudio masterJobId={JOB} />);
      await screen.findByText('பாடல்');
      const region = screen.getByRole('region', { name: 'Remix' });

      await act(async () => {
        fireEvent.click(within(region).getByRole('button', { name: /Render remix/ }));
      });
      expect(within(region).getByRole('button', { name: /Rendering…/ })).toBeDisabled();

      jest.advanceTimersByTime(4000);
      await waitFor(() => expect(within(region).getByText('Remix ready')).toBeInTheDocument());
      expect(within(region).getByRole('button', { name: /Render remix/ })).toBeEnabled();
      expect(within(region).getByText('Drums resampled from 44.1 kHz to 48 kHz')).toBeInTheDocument();

      await waitFor(() => expect(container.querySelector('audio')).toHaveAttribute('src', 'https://s3/remix-play'));
      // The URL above is only proof of SOMETHING resolving — every /download
      // call in this test answers the same way. Confirm the request that
      // produced it actually asked for the remix's own key.
      const playCall = mockedFetch.mock.calls.find((c) => String(c[0]).startsWith('/api/admin/mastering/download'))!;
      expect(String(playCall[0])).toContain(`key=${encodeURIComponent(REMIX_KEY)}`);
      expect(String(playCall[0])).toContain('mode=play');

      const link = within(region).getByRole('link', { name: /Master this remix/ });
      const expectedHref = `/admin/mastering?source=${encodeURIComponent(REMIX_KEY)}&title=${encodeURIComponent('பாடல் — remix')}&target=-14`;
      expect(link).toHaveAttribute('href', expectedHref);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows a 409 refusal inside the render section, without offering Remix ready', async () => {
    route({ remix: refuse('Every stem is muted — unmute at least one to render a remix.', 409) });
    render(<StemsStudio masterJobId={JOB} />);
    await screen.findByText('பாடல்');
    const region = screen.getByRole('region', { name: 'Remix' });

    await act(async () => {
      fireEvent.click(within(region).getByRole('button', { name: /Render remix/ }));
    });

    expect(within(region).getByRole('alert')).toHaveTextContent('Every stem is muted — unmute at least one to render a remix.');
    expect(within(region).getByRole('button', { name: /Render remix/ })).toBeEnabled();
    expect(within(region).queryByText('Remix ready')).toBeNull();
  });

  it('shows a remix.error already on the set on arrival — a failure persisted from an earlier session', async () => {
    const MESSAGE = 'The remix could not be started — press Render remix again.';
    route({}, {
      ...SET,
      remix: { key: null, renderedAt: null, mixUsed: null, notes: [], error: MESSAGE, requestedAt: '2026-10-02T23:59:00.000Z' },
    });
    render(<StemsStudio masterJobId={JOB} />);
    await screen.findByText('பாடல்');
    const region = screen.getByRole('region', { name: 'Remix' });

    expect(within(region).getByRole('alert')).toHaveTextContent(MESSAGE);
    expect(within(region).getByRole('button', { name: /Render remix/ })).toBeEnabled();
    expect(within(region).queryByText('Remix ready')).toBeNull();
  });

  it('shows a remix.error surfaced by the worker during the poll, and re-enables the button', async () => {
    jest.useFakeTimers();
    try {
      const MESSAGE = 'ffmpeg exited with code 1';
      const failedSet = {
        ...SET,
        remix: { key: null, renderedAt: null, mixUsed: null, notes: [], error: MESSAGE, requestedAt: '2026-10-02T23:59:00.000Z' },
      };
      let getCalls = 0;
      mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
        const m = init?.method ?? 'GET';
        if (url === `/api/admin/stems/${JOB}` && m === 'GET') {
          getCalls++;
          return Promise.resolve(ok({
            success: true,
            set: getCalls === 1 ? SET : failedSet,
            master: { id: JOB, title: 'பாடல்', target: -14 },
          }));
        }
        if (url === `/api/admin/stems/${JOB}/remix` && m === 'POST') return Promise.resolve(ok({ success: true, status: 'queued' }));
        return Promise.resolve(ok({}));
      });

      render(<StemsStudio masterJobId={JOB} />);
      await screen.findByText('பாடல்');
      const region = screen.getByRole('region', { name: 'Remix' });

      await act(async () => {
        fireEvent.click(within(region).getByRole('button', { name: /Render remix/ }));
      });
      expect(within(region).getByRole('button', { name: /Rendering…/ })).toBeDisabled();

      jest.advanceTimersByTime(4000);
      await waitFor(() => expect(within(region).getByRole('alert')).toHaveTextContent(MESSAGE));
      expect(within(region).getByRole('button', { name: /Render remix/ })).toBeEnabled();
      expect(within(region).queryByText('Remix ready')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
