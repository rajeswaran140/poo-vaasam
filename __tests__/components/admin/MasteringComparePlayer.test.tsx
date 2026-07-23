/** @jest-environment jsdom */
/**
 * MasteringComparePlayer — A/B source vs master. jsdom has no Web Audio and no
 * real media playback, so AudioContext and the HTMLMediaElement transport are
 * stubbed; the test covers the wiring the user actually depends on: both play
 * URLs are fetched in play mode, the A/B switch is a radio group, and the
 * loudness-match control appears only when both measurements exist.
 */

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('lucide-react', () => ({
  Play: () => <svg data-testid="i-play" />,
  Pause: () => <svg data-testid="i-pause" />,
  Loader2: () => <svg data-testid="i-loader" />,
  AlertTriangle: () => <svg data-testid="i-alert" />,
}));

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MasteringComparePlayer } from '@/components/admin/MasteringComparePlayer';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;
const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body }) as unknown as Response;

class FakeGain { gain = { value: 1 }; connect() { return this; } }
class FakeCtx {
  destination = {};
  state = 'running';
  createGain() { return new FakeGain(); }
  createMediaElementSource() { return { connect: () => ({ connect: () => {} }) }; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

beforeEach(() => {
  mockedFetch.mockReset();
  (global as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  // jsdom stubs media methods as no-ops that throw; make them resolve.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: jest.fn().mockResolvedValue(undefined) });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: jest.fn() });
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
});

const props = {
  sourceKey: 'audio/mastering/1_a_song.wav',
  masterKey: 'audio/mastering/1_a_song-master-14LUFS.wav',
  beforeLufs: -17.9,
  afterLufs: -14,
};

it('fetches a play URL for BOTH the source and the master', async () => {
  mockedFetch.mockResolvedValue(json({ success: true, url: 'https://s3/x' }));
  render(<MasteringComparePlayer {...props} />);
  await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
  const urls = mockedFetch.mock.calls.map((c) => c[0] as string);
  expect(urls.some((u) => u.includes(encodeURIComponent(props.sourceKey)) && u.includes('mode=play'))).toBe(true);
  expect(urls.some((u) => u.includes(encodeURIComponent(props.masterKey)) && u.includes('mode=play'))).toBe(true);
});

it('exposes A/B as a radio group defaulting to the master', async () => {
  mockedFetch.mockResolvedValue(json({ success: true, url: 'https://s3/x' }));
  render(<MasteringComparePlayer {...props} />);
  expect(screen.getByRole('radiogroup', { name: /listen to/i })).toBeInTheDocument();
  const before = screen.getByRole('radio', { name: /Before/ });
  const after = screen.getByRole('radio', { name: /After/ });
  expect(after).toHaveAttribute('aria-checked', 'true');
  await act(async () => { fireEvent.click(before); });
  expect(before).toHaveAttribute('aria-checked', 'true');
  expect(after).toHaveAttribute('aria-checked', 'false');
});

it('offers loudness matching when both measurements exist, on by default', async () => {
  mockedFetch.mockResolvedValue(json({ success: true, url: 'https://s3/x' }));
  render(<MasteringComparePlayer {...props} />);
  const match = screen.getByRole('checkbox', { name: /match loudness/i });
  expect(match).toBeChecked();
  expect(screen.getByText(/hearing the sound, not the loudness/i)).toBeInTheDocument();
  await act(async () => { fireEvent.click(match); });
  expect(screen.getByText(/will sound louder/i)).toBeInTheDocument();
});

it('hides the match control and warns when a measurement is missing', async () => {
  mockedFetch.mockResolvedValue(json({ success: true, url: 'https://s3/x' }));
  render(<MasteringComparePlayer {...props} afterLufs={null} />);
  expect(screen.queryByRole('checkbox', { name: /match loudness/i })).not.toBeInTheDocument();
  expect(screen.getByText(/could not be matched/i)).toBeInTheDocument();
});

it('surfaces a play-URL failure instead of silently dying', async () => {
  mockedFetch.mockResolvedValue(json({ success: false, error: 'nope' }, false));
  render(<MasteringComparePlayer {...props} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/nope/i);
});

it('preloads only metadata, never the full multi-hundred-MB WAVs up front', () => {
  mockedFetch.mockResolvedValue(json({ success: true, url: 'https://s3/x' }));
  const { container } = render(<MasteringComparePlayer {...props} />);
  const audios = Array.from(container.querySelectorAll('audio'));
  expect(audios).toHaveLength(2);
  // "auto" would buffer both files (~140 MB) the instant a finished job renders.
  audios.forEach((a) => expect(a.getAttribute('preload')).toBe('metadata'));
});

it('enables playback at readyState 1 (metadata) — no waiting for buffered data', async () => {
  mockedFetch.mockResolvedValue(json({ success: true, url: 'https://s3/x' }));
  // preload="metadata" reaches HAVE_METADATA (1) and stops; it never hits 2
  // until play(). Gating on 2 would leave the button spinning forever.
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 1 });
  const { container } = render(<MasteringComparePlayer {...props} />);
  await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));

  const play = screen.getByRole('button', { name: /^play$/i });
  expect(play).toBeDisabled(); // nothing loaded yet
  const audios = Array.from(container.querySelectorAll('audio'));
  await act(async () => {
    audios.forEach((a) => fireEvent.loadedMetadata(a));
  });
  expect(play).toBeEnabled();
});

it('becomes ready even if the master metadata arrives before the source metadata', async () => {
  // Regression: the source element must carry onLoadedMetadata too. If only the
  // master fires it, onLoaded runs once, sees the source not-yet-ready and — with
  // no source metadata handler — never re-fires, deadlocking the button.
  mockedFetch.mockResolvedValue(json({ success: true, url: 'https://s3/x' }));
  const states = new WeakMap<HTMLMediaElement, number>();
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    configurable: true,
    get() { return states.get(this) ?? 0; },
  });
  const { container } = render(<MasteringComparePlayer {...props} />);
  await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
  const [srcAudio, masAudio] = Array.from(container.querySelectorAll('audio'));

  // Master metadata lands FIRST while the source is still at 0.
  await act(async () => { states.set(masAudio, 1); fireEvent.loadedMetadata(masAudio); });
  expect(screen.getByRole('button', { name: /^play$/i })).toBeDisabled();
  // Then the source metadata lands — its own handler must flip the button on.
  await act(async () => { states.set(srcAudio, 1); fireEvent.loadedMetadata(srcAudio); });
  expect(screen.getByRole('button', { name: /^play$/i })).toBeEnabled();
});
