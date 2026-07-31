/** @jest-environment jsdom */
/**
 * MasteringPlayer — the auditioning surface: meter, A/B, loop, keyboard.
 *
 * jsdom has no Web Audio and no real media pipeline, so the graph is faked and
 * the tests target behaviour that survives that: what renders, what the
 * keyboard does to the element, and the honesty of the labels.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MasteringPlayer } from '@/components/admin/MasteringPlayer';

function installAudioContext() {
  class Fake {
    destination = {};
    createMediaElementSource() {
      return { connect: () => {} };
    }
    createBiquadFilter() {
      return { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect: () => {} };
    }
    createAnalyser() {
      return {
        fftSize: 2048,
        connect: () => {},
        getFloatTimeDomainData: (b: Float32Array) => b.fill(0.1),
      };
    }
    close() {}
    resume() {}
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = Fake;
}

beforeEach(() => {
  installAudioContext();
  // Waveform decoding is not exercised here; a HEAD with no size skips it.
  global.fetch = jest.fn().mockResolvedValue({
    headers: { get: () => null },
    arrayBuffer: async () => new ArrayBuffer(8),
  }) as unknown as typeof fetch;
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

describe('what it renders', () => {
  it('names the master being auditioned', () => {
    setup();
    expect(screen.getByText('ஈழத்து மண்ணே')).toBeInTheDocument();
  });

  it('shows both meter rows', () => {
    setup();
    expect(screen.getByText('peak')).toBeInTheDocument();
    expect(screen.getByText('rms')).toBeInTheDocument();
  });

  it('quotes the job\'s measured true peak as the authoritative figure', () => {
    setup();
    // The live meter is sample-peak; the report's true peak is what counts.
    expect(screen.getByText(/-1\.0 dBTP/)).toBeInTheDocument();
    expect(screen.getByText(/Sample-peak while playing/)).toBeInTheDocument();
  });

  it('lists the keyboard shortcuts, so they are discoverable', () => {
    setup();
    expect(screen.getByText(/Space play\/pause/)).toBeInTheDocument();
  });
});

describe('A/B against the source', () => {
  it('offers the toggle when a source URL exists', () => {
    setup();
    expect(screen.getByRole('button', { name: /A\/B vs source/i })).toBeInTheDocument();
  });

  it('hides it when there is no source to compare against', () => {
    setup({ sourceUrl: null });
    expect(screen.queryByRole('button', { name: /A\/B vs source/i })).not.toBeInTheDocument();
  });

  it('says plainly when the UNMASTERED take is playing', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /A\/B vs source/i }));
    expect(screen.getByText(/Playing the UNMASTERED take/i)).toBeInTheDocument();
  });

  it('offers the way back', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /A\/B vs source/i }));
    expect(screen.getByRole('button', { name: /Back to master/i })).toBeInTheDocument();
  });
});

describe('keyboard', () => {
  const region = () => screen.getByLabelText(/Player for/i);

  it('seeks forward with the right arrow', () => {
    setup();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 100, configurable: true });
    audio.currentTime = 10;
    fireEvent.keyDown(region(), { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(15);
  });

  it('seeks back, and never before the start', () => {
    setup();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 100, configurable: true });
    audio.currentTime = 2;
    fireEvent.keyDown(region(), { key: 'ArrowLeft' });
    expect(audio.currentTime).toBe(0);
  });

  it('jumps by decile with a number key', () => {
    setup();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true });
    fireEvent.keyDown(region(), { key: '5' });
    expect(audio.currentTime).toBe(100);
  });

  it('does NOT hijack arrow keys aimed at a control — the EQ sliders keep them', () => {
    // A real scenario, not a contrived one: the EQ sliders live inside the
    // player region, and arrow keys there must adjust the band rather than
    // seeking the track.
    setup();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 100, configurable: true });
    audio.currentTime = 10;
    fireEvent.click(screen.getByRole('button', { name: /Equaliser/i }));
    fireEvent.keyDown(screen.getByLabelText('Low 60 Hz'), { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(10);
  });
});

describe('expiry', () => {
  it('reports an expired link upward rather than sitting dead', async () => {
    const onExpired = jest.fn();
    setup({ onExpired });
    fireEvent.error(document.querySelector('audio') as HTMLAudioElement);
    await waitFor(() => expect(onExpired).toHaveBeenCalled());
  });
});

describe('waveform cost guard', () => {
  it('explains a skipped waveform instead of silently omitting it', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      headers: { get: (h: string) => (h === 'content-length' ? String(400 * 1024 * 1024) : null) },
    }) as unknown as typeof fetch;
    setup();
    expect(await screen.findByText(/Waveform skipped/i)).toBeInTheDocument();
  });
});

describe('playback rate — the composer control', () => {
  it('offers 0.75x, where sung Tamil consonants become audible', () => {
    setup();
    expect(screen.getByRole('button', { name: '0.75×' })).toBeInTheDocument();
  });

  it('applies the rate to the element', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '0.75×' }));
    expect((document.querySelector('audio') as HTMLAudioElement).playbackRate).toBe(0.75);
  });

  it('requests pitch preservation where the browser supports it', () => {
    // jsdom has no preservesPitch, so declare it the way a real browser does.
    Object.defineProperty(HTMLMediaElement.prototype, 'preservesPitch', {
      value: false,
      writable: true,
      configurable: true,
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: '0.5×' }));
    const el = document.querySelector('audio') as unknown as Record<string, unknown>;
    expect(el.preservesPitch).toBe(true);
    delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).preservesPitch;
  });

  it('WARNS when the browser cannot preserve pitch — a transposed vowel cannot be judged', () => {
    // No preservesPitch anywhere (the jsdom default), so speed shifts pitch.
    setup();
    fireEvent.click(screen.getByRole('button', { name: '0.5×' }));
    expect(screen.getByText(/changing pitch along with speed/i)).toBeInTheDocument();
  });

  it('explains the slow rate only when slowed, so the note is not always on', () => {
    setup();
    expect(screen.queryByText(/Slowed for detail/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '0.75×' }));
    expect(screen.getByText(/Slowed for detail/i)).toBeInTheDocument();
  });

  it('marks the active rate for assistive tech', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '1.5×' }));
    expect(screen.getByRole('button', { name: '1.5×' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('audition marks — capture at the moment of judgement', () => {
  const region = () => screen.getByLabelText(/Player for/i);

  it('explains how to mark before any exist', () => {
    setup();
    expect(screen.getByText(/Press/)).toBeInTheDocument();
    expect(screen.getByText(/Music Lab/)).toBeInTheDocument();
  });

  it('drops a mark at the current position with the M key', () => {
    setup();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true });
    audio.currentTime = 102;
    fireEvent.keyDown(region(), { key: 'm' });
    expect(screen.getByRole('button', { name: '1:42' })).toBeInTheDocument();
  });

  it('uses the Music Lab failure vocabulary, not invented labels', () => {
    setup();
    const select = screen.getByLabelText('Mark reason');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'pronunciation' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'vocal delivery' })).toBeInTheDocument();
  });

  it('summarises the dominant reason — which IS the take\'s failureReason', () => {
    setup();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true });
    audio.currentTime = 10;
    fireEvent.keyDown(region(), { key: 'm' });
    audio.currentTime = 20;
    fireEvent.keyDown(region(), { key: 'm' });
    expect(screen.getByText(/that is the take/i)).toHaveTextContent(/pronunciation/);
  });

  it('a mark seeks back to its moment', () => {
    setup();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true });
    audio.currentTime = 102;
    fireEvent.keyDown(region(), { key: 'm' });
    audio.currentTime = 0;
    fireEvent.click(screen.getByRole('button', { name: '1:42' }));
    expect(audio.currentTime).toBeCloseTo(102, 0);
  });

  it('a mark can be removed', () => {
    setup();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true });
    audio.currentTime = 30;
    fireEvent.keyDown(region(), { key: 'm' });
    fireEvent.click(screen.getByRole('button', { name: /Remove mark at 0:30/ }));
    expect(screen.queryByRole('button', { name: '0:30' })).not.toBeInTheDocument();
  });

  it('offers Copy notes only once there is something to copy', () => {
    setup();
    expect(screen.queryByRole('button', { name: /Copy notes/i })).not.toBeInTheDocument();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true });
    audio.currentTime = 5;
    fireEvent.keyDown(region(), { key: 'm' });
    expect(screen.getByRole('button', { name: /Copy notes/i })).toBeInTheDocument();
  });
});

describe('defects found auditing the composer tools', () => {
  const region = () => screen.getByLabelText(/Player for/i);

  it('KEEPS the playback rate across an A/B swap', () => {
    // Setting src resets playbackRate. Without restoring it, an A/B started at
    // 0.75x would play the source at 1x — a difference that is only speed.
    setup();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    fireEvent.click(screen.getByRole('button', { name: '0.75×' }));
    expect(audio.playbackRate).toBe(0.75);
    fireEvent.click(screen.getByRole('button', { name: /A\/B vs source/i }));
    expect(audio.playbackRate).toBe(0.75);
  });

  it('does not drop a mark when typing in the reason dropdown', () => {
    // "m" in the select should reach melody/mixing, not the mark shortcut.
    setup();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true });
    audio.currentTime = 42;
    fireEvent.keyDown(screen.getByLabelText('Mark reason'), { key: 'm' });
    expect(screen.queryByRole('button', { name: '0:42' })).not.toBeInTheDocument();
  });

  it('gives every mark a unique id, even after a removal at the same time', () => {
    // The old id was time+list-length, which repeated in exactly this sequence
    // and made one removal delete two marks.
    setup();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true });
    audio.currentTime = 5;
    fireEvent.keyDown(region(), { key: 'm' });
    audio.currentTime = 10;
    fireEvent.keyDown(region(), { key: 'm' });
    fireEvent.click(screen.getByRole('button', { name: /Remove mark at 0:05/ }));
    audio.currentTime = 10;
    fireEvent.keyDown(region(), { key: 'm' });
    // Two distinct marks at 0:10 — removing one must leave the other.
    expect(screen.getAllByRole('button', { name: '0:10' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: /Remove mark at 0:10/ })[0]);
    expect(screen.getAllByRole('button', { name: '0:10' })).toHaveLength(1);
  });
});

describe('resource hygiene', () => {
  it('CLOSES the AudioContext on unmount — browsers cap them at about six', () => {
    // Without this, auditioning a handful of masters exhausts the budget and
    // the meter and equaliser stop working with no visible cause.
    const closed: string[] = [];
    class Tracking {
      state = 'running';
      destination = {};
      createMediaElementSource() {
        return { connect: () => {} };
      }
      createBiquadFilter() {
        return { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect: () => {} };
      }
      createAnalyser() {
        return { fftSize: 2048, connect: () => {}, getFloatTimeDomainData: (b: Float32Array) => b.fill(0) };
      }
      resume() {}
      close() {
        closed.push('closed');
        this.state = 'closed';
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = Tracking;
    const { unmount } = setup();
    // The graph is built lazily on first play.
    fireEvent.play(document.querySelector('audio') as HTMLAudioElement);
    unmount();
    expect(closed).toHaveLength(1);
  });

  it('resets the held peak on play, so a previous loud passage does not linger', () => {
    setup();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    fireEvent.play(audio);
    // Both rows sit at the floor rather than carrying a stale peak.
    expect(screen.getAllByText(/−∞ dB/)).toHaveLength(2);
  });
});
