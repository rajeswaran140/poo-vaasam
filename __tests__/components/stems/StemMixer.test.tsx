/** @jest-environment jsdom */
// __tests__/components/stems/StemMixer.test.tsx
//
// Web Audio is faked per the task brief: these fakes only implement what the
// mixer is allowed to touch (gain.value, gain.setTargetAtTime, connect,
// buffer, start, stop, onended, decodeAudioData, resume, close). Reaching for
// anything else (cancelScheduledValues, res.status…) is a bug in the
// component, not a gap in the fake.
//
// `disconnect` on FakeGain and `connectedTo` on FakeSource were added for the
// additive-loading regression test below (fix round 1): the fix disconnects
// a removed stem's gain node, and the test needs to see which FakeGain a
// FakeSource.connect() call actually wired up.

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { StemMixer } from '@/components/admin/stems/StemMixer';
import { adminFetch } from '@/lib/client-auth';
import type { StemSet } from '@/types/stemSet';

const mockedFetch = adminFetch as jest.Mock;

class FakeGain {
  gain = {
    value: 1,
    setTargetAtTime: jest.fn((v: number) => {
      this.gain.value = v;
    }),
  };
  connect = jest.fn();
  disconnect = jest.fn();
}
class FakeSource {
  buffer: unknown = null;
  connectedTo: FakeGain | null = null;
  connect = jest.fn((dest: FakeGain) => {
    this.connectedTo = dest;
  });
  start = jest.fn();
  stop = jest.fn();
  onended: (() => void) | null = null;
}
let gains: FakeGain[] = [];
let sources: FakeSource[] = [];
class FakeContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  createGain = () => {
    const g = new FakeGain();
    gains.push(g);
    return g;
  };
  createBufferSource = () => {
    const s = new FakeSource();
    sources.push(s);
    return s;
  };
  decodeAudioData = jest.fn(async () => ({ duration: 221.9 }));
  resume = jest.fn(async () => {});
  close = jest.fn(async () => {});
}

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
const V = 'vocals-id';
const K = 'keys-id';
const D = 'drums-id';
const B = 'bass-id';

function stem(over: Partial<StemSet['stems'][string]> & { name: string }) {
  return {
    key: `audio/mastering/stems/${JOB}/${over.name}.wav`,
    previewKey: `audio/mastering/stems/${JOB}/preview/${over.name}.m4a`,
    previewError: null,
    previewRequestedAt: null,
    durationSec: 221.9,
    sampleRate: 48000,
    channels: 2,
    ...over,
  };
}

const SET: StemSet = {
  masterJobId: JOB,
  order: [V, K, D, B],
  stems: {
    [V]: stem({ name: 'Vocals' }),
    [K]: stem({ name: 'Keys' }),
    [D]: stem({ name: 'Drums' }),
    [B]: stem({ name: 'Bass', previewKey: null, durationSec: null, sampleRate: null, channels: null }),
  },
  mix: { [D]: { gainDb: -60, muted: false } },
  remix: null,
  createdAt: 't',
  updatedAt: 't',
};

const ok = (b: unknown) => ({ ok: true, json: async () => b }) as Response;
const refuse = (error: string, status = 400) =>
  ({ ok: false, status, json: async () => ({ success: false, error }) }) as Response;

function route(putResponse?: Response) {
  mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
    const m = init?.method ?? 'GET';
    if (url.startsWith('/api/admin/mastering/download') && m === 'GET') {
      const key = new URL(url, 'https://x').searchParams.get('key');
      return Promise.resolve(ok({ success: true, url: `https://s3/${key}` }));
    }
    if (url === `/api/admin/stems/${JOB}/mix` && m === 'PUT') {
      return Promise.resolve(putResponse ?? ok({ success: true }));
    }
    return Promise.resolve(ok({}));
  });
}

beforeEach(() => {
  mockedFetch.mockReset();
  gains = [];
  sources = [];
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
  global.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })) as never;
});

afterEach(() => {
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
});

it('renders one fader per stem with a listening copy, labelled "{name} level", with dB readouts', async () => {
  route();
  render(<StemMixer set={SET} masterJobId={JOB} />);

  const vocals = await screen.findByRole('slider', { name: 'Vocals level' });
  expect(vocals).toHaveAttribute('min', '-60');
  expect(vocals).toHaveAttribute('max', '6');
  expect(vocals).toHaveAttribute('step', '0.5');
  expect(screen.getByRole('slider', { name: 'Keys level' })).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Drums level' })).toBeInTheDocument();

  const region = screen.getByRole('region', { name: /Mixer/ });
  expect(within(region).getAllByText('0.0 dB').length).toBeGreaterThan(0);
  expect(within(region).getByText('−∞')).toBeInTheDocument();
  await waitFor(() => expect(gains.length).toBe(3));
});

it('moving a fader to -6 sets that stem\'s GainNode to 10^(-6/20)', async () => {
  route();
  render(<StemMixer set={SET} masterJobId={JOB} />);
  await screen.findByRole('slider', { name: 'Vocals level' });
  await waitFor(() => expect(gains.length).toBe(3)); // Vocals, Keys, Drums — Bass has no preview

  const vocalsFader = screen.getByRole('slider', { name: 'Vocals level' });
  fireEvent.change(vocalsFader, { target: { value: '-6' } });

  await waitFor(() => expect(gains[0].gain.value).toBeCloseTo(0.501, 2));
});

it('Mute sets the stem\'s gain to 0', async () => {
  route();
  render(<StemMixer set={SET} masterJobId={JOB} />);
  await screen.findByRole('slider', { name: 'Vocals level' });
  await waitFor(() => expect(gains.length).toBe(3));

  fireEvent.click(screen.getByRole('button', { name: 'Mute Vocals' }));
  await waitFor(() => expect(gains[0].gain.value).toBe(0));
});

it('Solo mutes every other stem, and un-soloing restores them', async () => {
  route();
  render(<StemMixer set={SET} masterJobId={JOB} />);
  await screen.findByRole('slider', { name: 'Vocals level' });
  await waitFor(() => expect(gains.length).toBe(3));

  // Keys (index 1) starts at 0 dB → gain 1 once soloing elsewhere forces it down.
  fireEvent.click(screen.getByRole('button', { name: 'Solo Vocals' }));
  await waitFor(() => expect(gains[1].gain.value).toBe(0));

  fireEvent.click(screen.getByRole('button', { name: 'Solo Vocals' }));
  await waitFor(() => expect(gains[1].gain.value).toBeCloseTo(1, 5));
});

it('Reset returns every fader to 0 dB and clears mute and solo', async () => {
  route();
  render(<StemMixer set={SET} masterJobId={JOB} />);
  await screen.findByRole('slider', { name: 'Vocals level' });
  await waitFor(() => expect(gains.length).toBe(3));

  fireEvent.click(screen.getByRole('button', { name: 'Mute Vocals' }));
  fireEvent.click(screen.getByRole('button', { name: 'Solo Keys' }));
  const drumsFader = screen.getByRole('slider', { name: 'Drums level' });
  fireEvent.change(drumsFader, { target: { value: '-6' } });

  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

  expect(screen.getByRole('slider', { name: 'Vocals level' })).toHaveValue('0');
  expect(screen.getByRole('slider', { name: 'Drums level' })).toHaveValue('0');
  expect(screen.getByRole('button', { name: 'Mute Vocals' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'Solo Keys' })).toHaveAttribute('aria-pressed', 'false');
  await waitFor(() => expect(gains[0].gain.value).toBeCloseTo(1, 5));
});

it('autosaves a fader change about 400ms later with the full mix, never solo', async () => {
  const ID = 'only-stem';
  const ONE: StemSet = {
    masterJobId: JOB,
    order: [ID],
    stems: { [ID]: stem({ name: 'Vocals' }) },
    mix: {},
    remix: null,
    createdAt: 't',
    updatedAt: 't',
  };
  route();
  render(<StemMixer set={ONE} masterJobId={JOB} />);
  const fader = await screen.findByRole('slider', { name: 'Vocals level' });
  fireEvent.click(screen.getByRole('button', { name: 'Solo Vocals' })); // must never reach the body
  fireEvent.change(fader, { target: { value: '-6' } });

  await waitFor(
    () => {
      const puts = mockedFetch.mock.calls.filter((c) => c[0] === `/api/admin/stems/${JOB}/mix` && c[1]?.method === 'PUT');
      expect(puts.length).toBe(1);
    },
    { timeout: 2000 }
  );
  const put = mockedFetch.mock.calls.find((c) => c[0] === `/api/admin/stems/${JOB}/mix` && c[1]?.method === 'PUT')!;
  expect(JSON.parse(put[1].body)).toEqual({ mix: { [ID]: { gainDb: -6, muted: false } } });
});

it('a failed save shows role="alert" inside the mixer region', async () => {
  route(refuse('Could not save the mix.', 502));
  render(<StemMixer set={SET} masterJobId={JOB} />);
  const fader = await screen.findByRole('slider', { name: 'Vocals level' });
  fireEvent.change(fader, { target: { value: '-6' } });

  const region = screen.getByRole('region', { name: /Mixer/ });
  await waitFor(
    () => expect(within(region).getByRole('alert')).toHaveTextContent(/Could not save the mix/),
    { timeout: 2000 }
  );
});

it('shows the mix note verbatim', async () => {
  route();
  render(<StemMixer set={SET} masterJobId={JOB} />);
  expect(
    screen.getByText('A mix of the stems is a new version — it will not sound exactly like the original release.')
  ).toBeInTheDocument();
  await waitFor(() => expect(gains.length).toBe(3));
});

it('lists a stem with no listening copy as waiting for it, with no fader, while the rest of the mixer still works', async () => {
  route();
  render(<StemMixer set={SET} masterJobId={JOB} />);
  await screen.findByRole('slider', { name: 'Vocals level' });

  expect(screen.getByText(/Bass is waiting for its listening copy/)).toBeInTheDocument();
  expect(screen.queryByRole('slider', { name: 'Bass level' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Mute Vocals' }));
  await waitFor(() => expect(gains[0].gain.value).toBe(0));
});

it('degrades quietly with no AudioContext: renders faders, shows the no-playback message, makes no download call', async () => {
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  route();
  render(<StemMixer set={SET} masterJobId={JOB} />);

  expect(await screen.findByRole('slider', { name: 'Vocals level' })).toBeInTheDocument();
  expect(screen.getByText('This browser cannot play the mix.')).toBeInTheDocument();
  await Promise.resolve();
  expect(mockedFetch).not.toHaveBeenCalledWith(
    expect.stringContaining('/api/admin/mastering/download'),
    expect.anything()
  );
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
});

// Fix round 1 regression test: StemMixer resolves each stem's presigned
// play-URL with its own adminFetch round-trip, so `stems` passed into
// useStemMixer grows ONE ID AT A TIME in production — Vocals' URL can
// resolve, get loaded and start playing, and only THEN does Keys' URL
// resolve. The buggy version cleared and re-fetched/re-decoded every stem
// on every such change, which (a) re-downloaded already-loaded stems and
// (b) replaced Vocals' GainNode out from under its already-playing source,
// so the fader stopped reaching the sound actually coming out of the
// speakers. This test forces the two URLs to resolve in separate ticks and
// checks both halves of the bug are fixed.
it('loads each listening copy exactly once across separate ticks, and keeps a playing stem wired to its own gain node', async () => {
  const ID1 = 'vocals-id';
  const ID2 = 'keys-id';
  const TWO: StemSet = {
    masterJobId: JOB,
    order: [ID1, ID2],
    stems: {
      [ID1]: stem({ name: 'Vocals' }),
      [ID2]: stem({ name: 'Keys' }),
    },
    mix: {},
    remix: null,
    createdAt: 't',
    updatedAt: 't',
  };

  // Keys' presigned-URL round-trip only resolves once `releaseKeys()` is
  // called — a separate tick from Vocals', which resolves immediately.
  let releaseKeys: (() => void) | null = null;
  const keysUrlGate = new Promise<void>((resolve) => {
    releaseKeys = resolve;
  });
  mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
    const m = init?.method ?? 'GET';
    if (url.startsWith('/api/admin/mastering/download') && m === 'GET') {
      const key = new URL(url, 'https://x').searchParams.get('key') ?? '';
      const body = ok({ success: true, url: `https://s3/${key}` });
      return key.includes('Keys') ? keysUrlGate.then(() => body) : Promise.resolve(body);
    }
    return Promise.resolve(ok({}));
  });

  const bytesFetchCalls: string[] = [];
  global.fetch = jest.fn(async (url: string) => {
    bytesFetchCalls.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  }) as never;

  render(<StemMixer set={TWO} masterJobId={JOB} />);

  // Vocals loads alone — Keys' URL is still gated.
  await waitFor(() => expect(gains.length).toBe(1));
  const vocalsFader = await screen.findByRole('slider', { name: 'Vocals level' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).not.toBeDisabled());

  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  await waitFor(() => expect(sources.length).toBe(1));
  const vocalsGainAtPlay = gains[0];
  expect(sources[0].connectedTo).toBe(vocalsGainAtPlay);

  // Now let Keys' URL resolve, in its own tick.
  releaseKeys!();
  await waitFor(() => expect(gains.length).toBe(2));

  // Vocals' gain node was never replaced — same object — and the source
  // already playing through it is still connected to that exact object.
  expect(gains[0]).toBe(vocalsGainAtPlay);
  expect(sources[0].connectedTo).toBe(gains[0]);

  // Exactly one audio-bytes fetch per stem: no re-fetch of Vocals triggered
  // by Keys joining.
  expect(bytesFetchCalls.length).toBe(2);
  expect(new Set(bytesFetchCalls).size).toBe(2);

  // The fader still reaches the GainNode the playing source is wired to.
  fireEvent.change(vocalsFader, { target: { value: '-6' } });
  await waitFor(() => expect(sources[0].connectedTo!.gain.value).toBeCloseTo(0.501, 2));
});

// Final-review fix wave (F3): a stem still waiting for its listening copy
// can't be auditioned, but it can be left out of the render — Mute and the
// level readout are there, and the mute is saved like any other.
it('a stem with no listening copy can still be muted, and the mute is saved', async () => {
  route();
  render(<StemMixer set={SET} masterJobId={JOB} />);
  await screen.findByRole('slider', { name: 'Vocals level' });

  expect(screen.getByText(/Bass is waiting for its listening copy/)).toBeInTheDocument();
  expect(screen.queryByRole('slider', { name: 'Bass level' })).toBeNull();
  const mute = screen.getByRole('button', { name: 'Mute Bass' });
  expect(screen.getByTestId(`level-${B}`)).toHaveTextContent('0.0 dB');

  fireEvent.click(mute);
  expect(mute).toHaveAttribute('aria-pressed', 'true');
  await waitFor(
    () => {
      const put = mockedFetch.mock.calls.find((c) => c[0] === `/api/admin/stems/${JOB}/mix` && c[1]?.method === 'PUT');
      expect(put).toBeDefined();
      expect(JSON.parse(put![1].body).mix[B]).toEqual({ gainDb: 0, muted: true });
    },
    { timeout: 2000 }
  );
});

describe('the transport while a stem is still loading', () => {
  const TWO: StemSet = {
    masterJobId: JOB,
    order: [V, K],
    stems: { [V]: stem({ name: 'Vocals' }), [K]: stem({ name: 'Keys' }) },
    mix: {},
    remix: null,
    createdAt: 't',
    updatedAt: 't',
  };

  // Keys' presigned URL and Keys' audio bytes are each released by hand, so
  // the test can hold the mixer in "playing, but a new stem is still loading".
  function gateKeys() {
    let releaseUrl: () => void = () => {};
    const urlGate = new Promise<void>((r) => { releaseUrl = r; });
    let releaseBytes: () => void = () => {};
    const bytesGate = new Promise<void>((r) => { releaseBytes = r; });
    mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
      const m = init?.method ?? 'GET';
      if (url.startsWith('/api/admin/mastering/download') && m === 'GET') {
        const key = new URL(url, 'https://x').searchParams.get('key') ?? '';
        const body = ok({ success: true, url: `https://s3/${key}` });
        return key.includes('Keys') ? urlGate.then(() => body) : Promise.resolve(body);
      }
      return Promise.resolve(ok({}));
    });
    const bytesCalls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      bytesCalls.push(url);
      if (url.includes('Keys')) await bytesGate;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    }) as never;
    return { releaseUrl, releaseBytes, bytesCalls };
  }

  it('keeps Pause and the seek bar usable while a newly added stem loads (F4)', async () => {
    const gate = gateKeys();
    render(<StemMixer set={TWO} masterJobId={JOB} />);
    await waitFor(() => expect(gains.length).toBe(1)); // Vocals loaded
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(sources.length).toBe(1));
    await screen.findByRole('button', { name: 'Pause' });

    // Keys' URL lands, its bytes don't: the mixer is no longer `ready`.
    gate.releaseUrl();
    await waitFor(() => expect(gate.bytesCalls.some((u) => u.includes('Keys'))).toBe(true));

    expect(screen.getByRole('button', { name: 'Pause' })).not.toBeDisabled();
    const seekBar = screen.getByRole('slider', { name: 'Playback position' });
    expect(seekBar).not.toBeDisabled();

    // A seek mid-load keeps playing, from the new position.
    fireEvent.change(seekBar, { target: { value: '10' } });
    await waitFor(() => expect(sources.length).toBe(2));
    expect(sources[1].start).toHaveBeenCalledWith(expect.any(Number), 10);
    expect(screen.getByRole('button', { name: 'Pause' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument();
    gate.releaseBytes();
    await waitFor(() => expect(gains.length).toBe(2));
  });

  it('never re-fetches a listening copy that failed to load when another stem joins (F6)', async () => {
    let releaseKeysUrl: () => void = () => {};
    const keysUrlGate = new Promise<void>((r) => { releaseKeysUrl = r; });
    mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
      const m = init?.method ?? 'GET';
      if (url.startsWith('/api/admin/mastering/download') && m === 'GET') {
        const key = new URL(url, 'https://x').searchParams.get('key') ?? '';
        const body = ok({ success: true, url: `https://s3/${key}` });
        return key.includes('Keys') ? keysUrlGate.then(() => body) : Promise.resolve(body);
      }
      return Promise.resolve(ok({}));
    });
    const bytesCalls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      bytesCalls.push(url);
      if (url.includes('Vocals')) throw new Error('network down');
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    }) as never;

    render(<StemMixer set={TWO} masterJobId={JOB} />);
    await waitFor(() => expect(bytesCalls.filter((u) => u.includes('Vocals'))).toHaveLength(1));
    // Let the failure settle, then a second stem joins: stemsKey changes.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).not.toBeDisabled());
    releaseKeysUrl();
    await waitFor(() => expect(gains.length).toBe(1)); // Keys loaded
    expect(bytesCalls.filter((u) => u.includes('Vocals'))).toHaveLength(1);
  });
});

it('Play after reaching the end starts again from the top (F7)', async () => {
  const ONE: StemSet = {
    masterJobId: JOB,
    order: [V],
    stems: { [V]: stem({ name: 'Vocals' }) },
    mix: {},
    remix: null,
    createdAt: 't',
    updatedAt: 't',
  };
  route();
  render(<StemMixer set={ONE} masterJobId={JOB} />);
  await waitFor(() => expect(gains.length).toBe(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).not.toBeDisabled());

  // At the very end, paused — where a finished playback leaves the transport.
  fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '221.9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));

  await waitFor(() => expect(sources.length).toBe(1));
  expect(sources[0].start).toHaveBeenCalledWith(expect.any(Number), 0);
});
