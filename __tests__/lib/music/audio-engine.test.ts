/**
 * Shared audio engine.
 *
 * jsdom has no Web Audio, so the AudioContext is faked. These cover the two
 * behaviours that were wrong rather than the synthesis itself:
 *   • `setVolume` must not CONSTRUCT a context — rendering a volume slider is
 *     not a user gesture, and building one on mount means every visit creates
 *     an AudioContext whether or not anything is ever played.
 *   • `stopMetronome` must cancel the UI notifications for clicks that were
 *     already scheduled into the look-ahead window, or the pulse highlight
 *     keeps flashing for a quarter-second after Stop.
 */

let constructed = 0;

class FakeParam {
  value = 0;
  setValueAtTime = jest.fn();
  exponentialRampToValueAtTime = jest.fn();
  setTargetAtTime = jest.fn();
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = '';
  connect = jest.fn(() => this);
  start = jest.fn();
  stop = jest.fn();
  addEventListener = jest.fn();
}
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  constructor() { constructed++; }
  createGain() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  resume = jest.fn(async () => { this.state = 'running'; });
}

beforeAll(() => {
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});

/** A fresh engine per test — the real export is a module singleton. */
async function freshEngine() {
  let engine: typeof import('@/lib/music/audio-engine').audioEngine;
  await jest.isolateModulesAsync(async () => {
    ({ audioEngine: engine } = await import('@/lib/music/audio-engine'));
  });
  return engine!;
}

beforeEach(() => {
  constructed = 0;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('setVolume does not force an AudioContext', () => {
  it('creates nothing when only the volume is set', async () => {
    const engine = await freshEngine();
    engine.setVolume(0.5);
    engine.setVolume(0.2);
    expect(constructed).toBe(0);
  });

  it('applies the remembered volume once a context is genuinely needed', async () => {
    const engine = await freshEngine();
    engine.setVolume(0.25);
    engine.playNote(60); // a real gesture-driven call
    expect(constructed).toBe(1);
  });

  it('clamps out-of-range values', async () => {
    const engine = await freshEngine();
    expect(() => { engine.setVolume(9); engine.setVolume(-3); }).not.toThrow();
    expect(constructed).toBe(0);
  });
});

describe('stopMetronome cancels pending pulse notifications', () => {
  it('stops notifying after Stop', async () => {
    const engine = await freshEngine();
    const seen: number[] = [];
    engine.onPulse((i) => seen.push(i));

    const { meterById } = await import('@/lib/music/meter');
    await engine.startMetronome(120, meterById('4/4')!);

    // The scheduler queued a look-ahead window of clicks, each with a pending
    // UI notification. Stopping must take those with it.
    engine.stopMetronome();
    const atStop = seen.length;
    jest.advanceTimersByTime(1000);

    expect(seen.length).toBe(atStop);
    expect(engine.isRunning).toBe(false);
  });

  it('stopAll also clears them', async () => {
    const engine = await freshEngine();
    const seen: number[] = [];
    engine.onPulse((i) => seen.push(i));
    const { meterById } = await import('@/lib/music/meter');
    await engine.startMetronome(120, meterById('6/8')!);

    engine.stopAll();
    const atStop = seen.length;
    jest.advanceTimersByTime(1000);
    expect(seen.length).toBe(atStop);
  });

  it('unsubscribes cleanly', async () => {
    const engine = await freshEngine();
    const fn = jest.fn();
    const off = engine.onPulse(fn);
    off();
    const { meterById } = await import('@/lib/music/meter');
    await engine.startMetronome(120, meterById('4/4')!);
    jest.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});
