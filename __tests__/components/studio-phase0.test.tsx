/** @jest-environment jsdom */
/**
 * The Composition Studio listening-test page (/admin/music-lab/studio-test).
 *
 * Assertions are made inside the page's own sections, not on the document:
 * an error is only useful next to the step that caused it, and "nothing
 * names the source" only matters inside the listening panel.
 */
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { PHASE0_PREFIX, MANIFEST_KEY, type Manifest, type Results } from '@/lib/studio-phase0/model';

const client = {
  workerProbe: jest.fn(),
  fetchJson: jest.fn(),
  fetchKey: jest.fn(),
  measureLufs: jest.fn(),
  loadResults: jest.fn(),
  saveResults: jest.fn(),
};
jest.mock('@/lib/studio-phase0/client', () => ({
  workerProbe: (...a: unknown[]) => client.workerProbe(...a),
  fetchJson: (...a: unknown[]) => client.fetchJson(...a),
  fetchKey: (...a: unknown[]) => client.fetchKey(...a),
  measureLufs: (...a: unknown[]) => client.measureLufs(...a),
  loadResults: (...a: unknown[]) => client.loadResults(...a),
  saveResults: (...a: unknown[]) => client.saveResults(...a),
}));
const engine = {
  liveContext: jest.fn().mockResolvedValue({}),
  loadPack: jest.fn(),
  renderLine: jest.fn(),
  playLive: jest.fn(),
};
jest.mock('@/lib/studio-phase0/engine', () => ({
  liveContext: (...a: unknown[]) => engine.liveContext(...a),
  loadPack: (...a: unknown[]) => engine.loadPack(...a),
  renderLine: (...a: unknown[]) => engine.renderLine(...a),
  playLive: (...a: unknown[]) => engine.playLive(...a),
  SAMPLE_RATE: 48000,
}));
const upload = jest.fn();
jest.mock('@/lib/mastering-upload-client', () => ({
  uploadToWorkspace: (...a: unknown[]) => upload(...a),
}));
let playerProps: Record<string, unknown> | null = null;
jest.mock('@/components/admin/MasteringComparePlayer', () => ({
  MasteringComparePlayer: (p: Record<string, unknown>) => {
    playerProps = p;
    return null;
  },
}));
const newSessionSpy = jest.fn();
jest.mock('@/lib/studio-phase0/model', () => {
  const actual = jest.requireActual('@/lib/studio-phase0/model');
  return {
    ...actual,
    newSession: (...a: unknown[]) => {
      newSessionSpy(...a);
      return actual.newSession(...a);
    },
  };
});

import { StudioPhase0 } from '@/components/admin/music/StudioPhase0';
const { newSession, buildTrials } = jest.requireActual('@/lib/studio-phase0/model');

const MANIFEST: Manifest = {
  version: 1,
  lines: [
    { lineId: 'F1', instrument: 'flute', stemKey: `${PHASE0_PREFIX}lines/F1/stem.wav`, notesKey: `${PHASE0_PREFIX}lines/F1/notes.json`, durationSec: 2, spanStartSec: 0 },
    { lineId: 'P1', instrument: 'percussion', stemKey: `${PHASE0_PREFIX}lines/P1/stem.wav`, notesKey: `${PHASE0_PREFIX}lines/P1/notes.json`, durationSec: 2, spanStartSec: 0 },
  ],
  packs: [
    { packId: 'vsco2-flute', instrument: 'flute', packKey: 'audio/mastering/studio-samples/vsco2-flute/pack.json' },
    { packId: 'vcsl-darbuka', instrument: 'percussion', packKey: 'audio/mastering/studio-samples/vcsl-darbuka/pack.json' },
  ],
};
// F1-vsco2-flute, F1-vsco2-flute-gamaka, P1-vcsl-darbuka
const TRIALS = buildTrials(MANIFEST);

function wire({ results = null as Results | null } = {}) {
  client.workerProbe.mockResolvedValue(true);
  client.fetchJson.mockImplementation(async (key: string) =>
    key === MANIFEST_KEY ? MANIFEST : { lineId: key.includes('F1') ? 'F1' : 'P1', durationSec: 2, notes: [] }
  );
  client.loadResults.mockResolvedValue(results);
  client.saveResults.mockResolvedValue(undefined);
  client.measureLufs.mockResolvedValue(-18);
  engine.loadPack.mockImplementation(async (spec: { packId: string }) => ({ packId: spec.packId, buffers: new Map() }));
  engine.renderLine.mockResolvedValue([new Float32Array(4), new Float32Array(4)]);
  engine.playLive.mockResolvedValue(() => {});
  upload.mockImplementation(async (file: File) => `audio/mastering/123_abcd1234_${file.name}`);
}

const section = (name: string) => screen.getByRole('region', { name });

async function startAndLoad() {
  render(<StudioPhase0 />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load the test' }));
  await waitFor(() => expect(within(section('Load')).getByText(/everything loaded/i)).toBeInTheDocument());
}

async function prepareAll() {
  fireEvent.click(within(section('Prepare trials')).getByRole('button', { name: 'Prepare trials' }));
  await waitFor(() =>
    expect(within(section('Prepare trials')).getAllByText(/^Ready$/)).toHaveLength(TRIALS.length)
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  playerProps = null;
});

it('shows only the reload prompt when the worker probe fails, and never fetches the manifest', async () => {
  wire();
  client.workerProbe.mockResolvedValue(false);
  render(<StudioPhase0 />);
  expect(await screen.findByText(/needs a fresh load/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load the test' })).toBeNull();
  expect(client.fetchJson).not.toHaveBeenCalled();
});

it('a failed measure shows its error in that trial row, other rows complete, and Retry re-measures only that trial', async () => {
  wire();
  let failed = false;
  client.measureLufs.mockImplementation(async (key: string) => {
    if (!failed && key.includes('studio-phase0-P1')) {
      failed = true;
      throw new Error('Measurement failed');
    }
    return -18;
  });
  await startAndLoad();
  fireEvent.click(within(section('Prepare trials')).getByRole('button', { name: 'Prepare trials' }));
  const prep = section('Prepare trials');
  const alert = await within(prep).findByRole('alert');
  expect(alert).toHaveTextContent('Measurement failed');
  const failedRow = alert.closest('li')!;
  await waitFor(() => expect(within(prep).getAllByText(/^Ready$/)).toHaveLength(TRIALS.length - 1));

  const rendersBefore = engine.renderLine.mock.calls.length;
  const uploadsBefore = upload.mock.calls.length;
  client.measureLufs.mockClear();
  fireEvent.click(within(failedRow as HTMLElement).getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(within(prep).getAllByText(/^Ready$/)).toHaveLength(TRIALS.length));
  expect(engine.renderLine.mock.calls.length).toBe(rendersBefore);
  expect(upload.mock.calls.length).toBe(uploadsBefore);
  expect(client.measureLufs.mock.calls.every(([k]) => String(k).includes('P1'))).toBe(true);
});

it('during a trial nothing names the source, line, pack or key', async () => {
  wire();
  await startAndLoad();
  await prepareAll();
  const listen = section('Listen');
  expect(within(listen).getByText(/Trial 1 of 3/)).toBeInTheDocument();
  expect(listen.textContent).not.toMatch(/fluidr3|vsco|vcsl|F1|P1|studio-phase0-|audio\/mastering/i);
  expect(playerProps).toMatchObject({ labels: { a: 'A', b: 'B' } });
});

it('Save maps the A/B scores through renderSide', async () => {
  wire();
  await startAndLoad();
  await prepareAll();
  const saved = client.saveResults.mock.calls.at(-1)![0] as Results;
  const first = saved.order[0];
  const side = saved.trials[first].renderSide;
  const listen = section('Listen');
  fireEvent.click(within(within(listen).getByRole('radiogroup', { name: 'Score for A' })).getByRole('radio', { name: '4' }));
  fireEvent.click(within(within(listen).getByRole('radiogroup', { name: 'Score for B' })).getByRole('radio', { name: '2' }));
  fireEvent.click(within(within(listen).getByRole('radiogroup', { name: 'Which one is Suno?' })).getByRole('radio', { name: "Can't tell" }));
  await act(async () => {
    fireEvent.click(within(listen).getByRole('button', { name: 'Save' }));
  });
  const after = client.saveResults.mock.calls.at(-1)![0] as Results;
  const rating = after.trials[first].ratings[0];
  expect(rating).toMatchObject(side === 'A' ? { renderScore: 4, sunoScore: 2 } : { renderScore: 2, sunoScore: 4 });
  expect(rating.guess).toBe('unsure');
});

it('after Save the trial is revealed, and Change rating records revised: true', async () => {
  wire();
  await startAndLoad();
  await prepareAll();
  const listen = section('Listen');
  const rate = async () => {
    fireEvent.click(within(within(listen).getByRole('radiogroup', { name: 'Score for A' })).getByRole('radio', { name: '3' }));
    fireEvent.click(within(within(listen).getByRole('radiogroup', { name: 'Score for B' })).getByRole('radio', { name: '3' }));
    fireEvent.click(within(within(listen).getByRole('radiogroup', { name: 'Which one is Suno?' })).getByRole('radio', { name: 'A' }));
    await act(async () => {
      fireEvent.click(within(listen).getByRole('button', { name: 'Save' }));
    });
  };
  await rate();
  expect(within(listen).getByText(/was the render/)).toBeInTheDocument();
  fireEvent.click(within(listen).getByRole('button', { name: 'Change rating' }));
  await rate();
  const after = client.saveResults.mock.calls.at(-1)![0] as Results;
  const first = after.order[0];
  expect(after.trials[first].ratings.map((r) => r.revised)).toEqual([false, true]);
});

it('reopening with saved results resumes the same order and does not start a new session', async () => {
  const stored = newSession(TRIALS, 'aaaaaaaabbbbbbbb') as Results;
  for (const id of stored.order) {
    stored.trials[id] = { ...stored.trials[id], renderKey: `audio/mastering/1_x_studio-phase0-${id}.wav`, renderLufs: -18, stemLufs: -17 };
  }
  wire({ results: stored });
  await startAndLoad();
  expect(newSessionSpy).not.toHaveBeenCalled();
  expect(engine.renderLine).not.toHaveBeenCalled();
  expect(within(section('Prepare trials')).getAllByText(/^Ready$/)).toHaveLength(TRIALS.length);
  expect(within(section('Listen')).getByText(/Trial 1 of 3/)).toBeInTheDocument();
});

it('lists CSP violations on the page, and shows zero when there are none', async () => {
  wire();
  await startAndLoad();
  expect(within(section('CSP violations')).getByText(/^0 violations/)).toBeInTheDocument();
  await act(async () => {
    const e = new Event('securitypolicyviolation') as Event & { violatedDirective?: string; blockedURI?: string };
    e.violatedDirective = 'worker-src';
    e.blockedURI = 'blob';
    document.dispatchEvent(e);
  });
  expect(within(section('CSP violations')).getByText(/worker-src/)).toBeInTheDocument();
});

describe('final review fixes', () => {
  async function rateCurrent(a: string, b: string) {
    const listen = section('Listen');
    fireEvent.click(within(within(listen).getByRole('radiogroup', { name: 'Score for A' })).getByRole('radio', { name: a }));
    fireEvent.click(within(within(listen).getByRole('radiogroup', { name: 'Score for B' })).getByRole('radio', { name: b }));
    fireEvent.click(within(within(listen).getByRole('radiogroup', { name: 'Which one is Suno?' })).getByRole('radio', { name: "Can't tell" }));
    await act(async () => {
      fireEvent.click(within(listen).getByRole('button', { name: 'Save' }));
    });
  }

  it('lists a line excluded because its Suno stem scored below 3 (I2)', async () => {
    wire();
    await startAndLoad();
    await prepareAll();
    for (let i = 0; i < TRIALS.length; i++) {
      await rateCurrent('2', '2');
      const next = screen.queryByRole('button', { name: 'Next trial' });
      if (next) fireEvent.click(next);
    }
    const summary = section('Summary');
    expect(within(summary).getByText(/Excluded/)).toBeInTheDocument();
    expect(summary.textContent).toMatch(/F1.*Suno scored 2/);
  });

  it('hides the non-blind Lines panel once the trials are prepared', async () => {
    wire();
    await startAndLoad();
    expect(section('Lines')).toBeInTheDocument();
    await prepareAll();
    expect(screen.queryByRole('region', { name: 'Lines' })).toBeNull();
  });

  it('refuses saved results made for a different set of trials, instead of stalling', async () => {
    const other = newSession(TRIALS.slice(0, 2), 'aaaaaaaabbbbbbbb') as Results;
    wire({ results: other });
    render(<StudioPhase0 />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load the test' }));
    const alert = await within(section('Load')).findByRole('alert');
    expect(alert).toHaveTextContent(/different set of trials/);
    expect(screen.queryByRole('region', { name: 'Prepare trials' })).toBeNull();
  });
});
