/** @jest-environment jsdom */
/**
 * MasteringPlayer — resource lifecycle and seek/loop interaction.
 *
 * These cover the defects found in the 2026-08-11 audit of the audition
 * player. Each one failed before the fix, so each is a real regression guard
 * rather than a restatement of the implementation:
 *
 *   1. the waveform's decode AudioContext leaked on every path except success
 *   2. the master WAV was fetched twice (a HEAD, then a full GET)
 *   3. an abandoned decode kept transferring after unmount
 *   4. seeking outside an active loop snapped straight back
 *   5. an expired SOURCE url was reported as the MASTER's link expiring
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MasteringPlayer } from '@/components/admin/MasteringPlayer';

/** Contexts built during a test, so we can assert every one was closed. */
interface Ctx {
  closed: boolean;
  isDecoder: boolean;
}
let contexts: Ctx[] = [];
/** Resolves the pending decode; lets a test unmount mid-decode. */
let releaseDecode: ((ok: boolean) => void) | null = null;
let fetchCalls: Array<{ url: string; method?: string; signal?: AbortSignal }> = [];

function installAudioContext() {
  class Fake {
    destination = {};
    state = 'running';
    private me: Ctx;
    constructor() {
      this.me = { closed: false, isDecoder: false };
      contexts.push(this.me);
    }
    createMediaElementSource() { return { connect: () => {} }; }
    createBiquadFilter() {
      return { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect: () => {} };
    }
    createAnalyser() {
      return { fftSize: 2048, connect: () => {}, getFloatTimeDomainData: (b: Float32Array) => b.fill(0.1) };
    }
    decodeAudioData() {
      this.me.isDecoder = true;
      return new Promise((resolve, reject) => {
        releaseDecode = (ok: boolean) =>
          ok
            ? resolve({ duration: 200, getChannelData: () => new Float32Array(2048) })
            : reject(new Error('corrupt WAV'));
      });
    }
    resume() { return Promise.resolve(); }
    close() { this.me.closed = true; this.state = 'closed'; return Promise.resolve(); }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = Fake;
}

/** A fetch that returns a decodable body of `size` bytes. */
function installFetch(size: number | null) {
  global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, method: init?.method, signal: init?.signal ?? undefined });
    if (init?.signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    return Promise.resolve({
      headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? (size === null ? null : String(size)) : null) },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      body: { cancel: () => Promise.resolve() },
    });
  }) as unknown as typeof fetch;
}

/** Let the fetch → size-check → arrayBuffer chain settle. */
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
};

beforeEach(() => {
  contexts = [];
  fetchCalls = [];
  releaseDecode = null;
  installAudioContext();
  installFetch(5_000_000);
});

const setup = (over: Partial<React.ComponentProps<typeof MasteringPlayer>> = {}) =>
  render(
    <MasteringPlayer
      masterUrl="https://s3/master.wav?sig=1"
      sourceUrl="https://s3/source.wav?sig=1"
      title="ஈழத்து மண்ணே"
      afterTp={-1}
      {...over}
    />
  );

describe('the waveform decode context is always released', () => {
  it('closes it when the component unmounts mid-decode', async () => {
    const { unmount } = setup();
    await settle();
    expect(contexts.some((c) => c.isDecoder)).toBe(true);

    unmount();
    await act(async () => {
      releaseDecode?.(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Browsers cap concurrent AudioContexts at ~6 and the player is keyed on
    // the master URL, so one leak per library row is enough to silence the
    // meter and equaliser with no visible cause.
    expect(contexts.filter((c) => c.isDecoder).every((c) => c.closed)).toBe(true);
  });

  it('closes it when decoding fails', async () => {
    setup();
    await settle();
    await act(async () => {
      releaseDecode?.(false);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(contexts.filter((c) => c.isDecoder).every((c) => c.closed)).toBe(true);
    expect(await screen.findByText(/Waveform could not be drawn/)).toBeInTheDocument();
  });

  it('closes it on the ordinary success path too', async () => {
    setup();
    await settle();
    await act(async () => {
      releaseDecode?.(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(contexts.filter((c) => c.isDecoder).every((c) => c.closed)).toBe(true);
  });
});

describe('the master is transferred once', () => {
  it('does not issue a HEAD before the GET', async () => {
    setup();
    await settle();
    const forMaster = fetchCalls.filter((c) => c.url.includes('master.wav'));
    // The <audio> element is already streaming this file; a HEAD plus a full
    // GET put a second copy of a WAV across the network for a picture.
    expect(forMaster.some((c) => c.method === 'HEAD')).toBe(false);
    expect(forMaster).toHaveLength(1);
  });

  it('skips the waveform without reading the body when the file is too large', async () => {
    installFetch(500 * 1024 * 1024);
    setup();
    await settle();
    expect(await screen.findByText(/Waveform skipped/)).toBeInTheDocument();
    // No decoder context should ever have been constructed for it.
    expect(contexts.some((c) => c.isDecoder)).toBe(false);
  });

  it('aborts the transfer when the row is switched away', async () => {
    const { unmount } = setup();
    await settle();
    const signal = fetchCalls.find((c) => c.url.includes('master.wav'))?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('does not report a draw failure when the abort is our own cleanup', async () => {
    const { unmount } = setup();
    await settle();
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText(/Waveform could not be drawn/)).not.toBeInTheDocument();
  });
});

describe('seeking out of a loop ends the loop', () => {
  /**
   * Dispatch a pointer gesture that actually carries an x-coordinate.
   *
   * ⚠️ `fireEvent.pointerDown(el, { clientX })` DOES NOT WORK here: jsdom has
   * no `PointerEvent`, so testing-library falls back to a plain `Event` and
   * silently drops `clientX`. Every gesture then reads as x=0, which looks
   * like a click at 0:00 rather than a drag. A `MouseEvent` carries clientX
   * natively and React's synthetic pointer handlers accept it.
   */
  const pointer = (el: Element, type: 'pointerdown' | 'pointerup', clientX: number, pointerId = 1) => {
    const e = new MouseEvent(type, { clientX, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'pointerId', { value: pointerId });
    fireEvent(el, e);
  };

  /** Drag the waveform to establish a 40s–80s loop on a 200s track. */
  const makeLoop = async () => {
    setup();
    await settle();
    await act(async () => { releaseDecode?.(true); await Promise.resolve(); });
    const wave = await screen.findByRole('slider', { name: /Waveform/i });
    // Give the element a width so pointer maths maps to real times.
    jest.spyOn(wave, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 200, top: 0, height: 84, right: 200, bottom: 84, x: 0, y: 0, toJSON: () => {},
    } as DOMRect);
    wave.setPointerCapture = () => {};
    wave.releasePointerCapture = () => {};
    pointer(wave, 'pointerdown', 40);
    pointer(wave, 'pointerup', 80);
    return wave;
  };

  it('keeps the loop when the seek lands inside it', async () => {
    const wave = await makeLoop();
    expect(await screen.findByText(/Looping/)).toBeInTheDocument();
    pointer(wave, 'pointerdown', 60, 2);
    pointer(wave, 'pointerup', 60, 2);
    expect(screen.getByText(/Looping/)).toBeInTheDocument();
  });

  it('clears the loop when the seek lands outside it', async () => {
    const wave = await makeLoop();
    expect(await screen.findByText(/Looping/)).toBeInTheDocument();
    // Click at 90% — far outside 40s–80s. Before the fix the loop survived and
    // `shouldLoopBack` yanked the playhead straight back, so click-to-seek
    // looked broken until you knew to press L first.
    pointer(wave, 'pointerdown', 180, 3);
    pointer(wave, 'pointerup', 180, 3);
    await waitFor(() => expect(screen.queryByText(/Looping/)).not.toBeInTheDocument());
  });

  it('clears the loop on a keyboard seek out of the region too', async () => {
    const wave = await makeLoop();
    expect(await screen.findByText(/Looping/)).toBeInTheDocument();
    // Home is an absolute seek to 0:00 — outside 40s–80s.
    fireEvent.keyDown(wave, { key: 'Home' });
    await waitFor(() => expect(screen.queryByText(/Looping/)).not.toBeInTheDocument());
  });
});

describe('a failed source is not blamed on the master', () => {
  it('falls back to the master and names the source, without calling onExpired', async () => {
    const onExpired = jest.fn();
    const { container } = setup({ onExpired });
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /A\/B vs source/i }));
    const audio = container.querySelector('audio') as HTMLAudioElement;
    fireEvent.error(audio);

    expect(onExpired).not.toHaveBeenCalled();
    expect(await screen.findByText(/unmastered source link expired/i)).toBeInTheDocument();
    // And we are back on the master, not stranded on a dead source.
    expect(screen.getByRole('button', { name: /A\/B vs source/i })).toBeInTheDocument();
  });

  it('still reports an expired master normally', async () => {
    const onExpired = jest.fn();
    const { container } = setup({ onExpired });
    await settle();
    fireEvent.error(container.querySelector('audio') as HTMLAudioElement);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
