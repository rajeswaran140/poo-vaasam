/** @jest-environment jsdom */
// __tests__/components/stems/StemMixer.test.tsx
//
// Web Audio is faked per the task brief: these fakes only implement what the
// mixer is allowed to touch (gain.value, gain.setTargetAtTime, connect,
// buffer, start, stop, onended, decodeAudioData, resume, close). Reaching for
// anything else (disconnect, cancelScheduledValues, res.status…) is a bug in
// the component, not a gap in the fake.

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
}
class FakeSource {
  buffer: unknown = null;
  connect = jest.fn();
  start = jest.fn();
  stop = jest.fn();
  onended: (() => void) | null = null;
}
let gains: FakeGain[] = [];
class FakeContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  createGain = () => {
    const g = new FakeGain();
    gains.push(g);
    return g;
  };
  createBufferSource = () => new FakeSource();
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
