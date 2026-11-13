/** @jest-environment jsdom */
/**
 * Time lyrics automatically: listen once, place every line, list the unheard
 * ones, and undo in one press.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { AutoTime } from '@/components/admin/video-text/AutoTime';
import type { TextBlock } from '@/types/videoText';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const fetchMock = adminFetch as jest.Mock;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

const LYRICS = 'one line\ntwo line';
const start: TextBlock[] = [
  { id: 'title', track: 'title', text: 'Song', startSec: 0, endSec: 5 },
  { id: 'a', track: 'lyric', text: 'one line', startSec: 5, endSec: 6 },
  { id: 'b', track: 'lyric', text: 'two line', startSec: 6, endSec: 7 },
];
const timed = [
  { text: 'one line', startSec: 10, endSec: 12, heard: true },
  { text: 'two line', startSec: 20, endSec: 22, heard: false },
];

const host: { setLyrics?: (s: string) => void; setSource?: (s: string) => void; setBlocks?: (b: TextBlock[]) => void } = {};
function setup(initial: TextBlock[] = start) {
  function Host() {
    const [blocks, setBlocks] = React.useState(initial);
    const [lyrics, setLyrics] = React.useState(LYRICS);
    const [source, setSource] = React.useState('k1');
    host.setLyrics = setLyrics;
    host.setSource = setSource;
    host.setBlocks = setBlocks;
    return (
      <>
        <AutoTime projectId="p1" sourceKey={source} durationSec={60} lyricsText={lyrics} blocks={blocks} onChange={setBlocks} pollMs={1000} />
        <ul>{blocks.filter((b) => b.track === 'lyric').map((b) => <li key={b.id} data-testid={b.text}>{`${b.startSec}-${b.endSec}`}</li>)}</ul>
      </>
    );
  }
  render(<Host />);
}
const flush = () => act(async () => { await jest.advanceTimersByTimeAsync(1000); });

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
});
afterEach(() => jest.useRealTimers());

it('listens, then times every line and names the unheard ones; Undo puts the old timing back', async () => {
  let started = false;
  let listened = false;
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (!body) return json(listened ? { status: 'ready' } : started ? { status: 'running', startedAt: 't' } : { status: 'idle' });
    if (body.op === 'start') {
      started = true;
      return json({ status: 'running', startedAt: 't' }, 202);
    }
    if (body.op === 'align') {
      expect(body.lyricsText).toBe(LYRICS);
      return json({ lines: timed });
    }
    return json({}, 400);
  });
  setup();
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Time lyrics automatically' }));
  await flush();
  expect(screen.getByRole('button', { name: 'Listening to the song…' })).toBeDisabled();
  expect(screen.getByTestId('one line')).toHaveTextContent('5-6');

  listened = true;
  await flush();
  expect(screen.getByTestId('one line')).toHaveTextContent('10-12');
  expect(screen.getByTestId('two line')).toHaveTextContent('20-22');
  expect(screen.getByRole('status')).toHaveTextContent('Timed 2 lines. 1 were not heard clearly');
  expect(screen.getByRole('status')).toHaveTextContent('line 2.');

  fireEvent.click(screen.getByRole('button', { name: 'Undo automatic timing' }));
  expect(screen.getByTestId('one line')).toHaveTextContent('5-6');
  expect(screen.queryByRole('button', { name: 'Undo automatic timing' })).not.toBeInTheDocument();
});

it('a video already listened to re-times in one step, with no new listen', async () => {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (!body) return json({ status: 'ready' });
    if (body.op === 'align') return json({ lines: timed });
    throw new Error(`unexpected ${body.op}`);
  });
  setup();
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Time lyrics automatically (about a second)' }));
  await flush();
  expect(screen.getByTestId('one line')).toHaveTextContent('10-12');
  expect(fetchMock.mock.calls.some(([, i]) => i?.body && JSON.parse(String(i.body)).op === 'start')).toBe(false);
});

it('shows why it failed and leaves the timing alone', async () => {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (!body) return json({ status: 'idle' });
    return json({ error: 'Automatic timing could not be started. Try again.' }, 502);
  });
  setup();
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Time lyrics automatically' }));
  await flush();
  expect(screen.getByRole('alert')).toHaveTextContent('could not be started');
  expect(screen.getByTestId('one line')).toHaveTextContent('5-6');
  expect(screen.getByRole('button', { name: 'Time lyrics automatically' })).toBeEnabled();
});

it('reports a run that failed while listening', async () => {
  let calls = 0;
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (!body) return json(calls++ === 0 ? { status: 'idle' } : { status: 'error', error: 'Automatic timing failed for this video.' });
    return json({ status: 'running', startedAt: 't' }, 202);
  });
  setup();
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Time lyrics automatically' }));
  await flush();
  await flush();
  expect(screen.getByRole('alert')).toHaveTextContent('failed for this video');
});

it('shows nothing until there are lyrics', () => {
  fetchMock.mockResolvedValue(json({ status: 'idle' }));
  render(<AutoTime projectId="p1" sourceKey="k1" durationSec={60} lyricsText="   " blocks={[]} onChange={jest.fn()} />);
  expect(screen.queryByTestId('auto-time')).not.toBeInTheDocument();
});

describe('audit fixes', () => {
  it('lyrics edited while the lines are being timed: nothing is applied, and it says why', async () => {
    let release: (() => void) | null = null;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (!body) return json({ status: 'ready' });
      await new Promise<void>((r) => { release = r; });
      return json({ lines: timed });
    });
    setup();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Time lyrics automatically (about a second)' }));
    await flush();
    act(() => host.setLyrics!('one line fixed\ntwo line'));
    await act(async () => { release!(); await jest.advanceTimersByTimeAsync(10); });
    expect(screen.getByRole('alert')).toHaveTextContent('lyrics changed while the lines were being timed');
    expect(screen.getByTestId('one line')).toHaveTextContent('5-6');
  });

  it('Undo is withdrawn once the timeline is edited after the timing', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return body ? json({ lines: timed }) : json({ status: 'ready' });
    });
    setup();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Time lyrics automatically (about a second)' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Undo automatic timing' })).toBeInTheDocument();
    // A hand edit: move the first line.
    act(() => host.setBlocks!([start[0], { id: 'a', track: 'lyric', text: 'one line', startSec: 11, endSec: 12 }, { id: 'b', track: 'lyric', text: 'two line', startSec: 20, endSec: 22 }]));
    await flush();
    expect(screen.queryByRole('button', { name: 'Undo automatic timing' })).not.toBeInTheDocument();
    expect(screen.getByTestId('one line')).toHaveTextContent('11-12');
  });

  it('a new video while listening frees the button, and the old run never applies', async () => {
    let video = 'k1';
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.op === 'start') return json({ status: 'running', startedAt: 't' }, 202);
      if (body?.op === 'align') return json({ lines: timed });
      return json(video === 'k1' ? { status: 'running', startedAt: 't' } : { status: 'idle' });
    });
    setup();
    await flush();
    expect(screen.getByRole('button', { name: 'Listening to the song…' })).toBeDisabled();
    video = 'k2';
    act(() => host.setSource!('k2'));
    await flush();
    await flush();
    expect(screen.getByRole('button', { name: 'Time lyrics automatically' })).toBeEnabled();
    expect(screen.getByTestId('one line')).toHaveTextContent('5-6');
  });
});
