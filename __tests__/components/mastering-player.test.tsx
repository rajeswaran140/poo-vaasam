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
