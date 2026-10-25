/** @jest-environment jsdom */
/**
 * MasteringComparePlayer blind mode (Composition Studio Phase 0).
 *
 * The listening test reuses this player to compare a sample render against a
 * Suno stem. Its normal labels ("Before (source)", "After (master)") and the
 * true-levels note would give away which side is which, so an optional
 * `labels` prop replaces them. Sound Engineering never passes it, so its
 * player must stay exactly as it was.
 */
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MasteringComparePlayer } from '@/components/admin/MasteringComparePlayer';
import { matchGains } from '@/lib/loudness-match';

jest.mock('@/lib/client-auth', () => ({
  adminFetch: jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, url: 'https://example.test/a.wav' }),
  }),
}));

/** Every GainNode the player builds, in creation order: source, master, output. */
let gains: Array<{ gain: { value: number } }> = [];

beforeEach(() => {
  gains = [];
  class FakeContext {
    destination = {};
    createGain() {
      const g = { gain: { value: 1 }, connect: (n: unknown) => n };
      gains.push(g);
      return g;
    }
    createMediaElementSource() {
      return { connect: (n: unknown) => n };
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
  HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = jest.fn();
});

const base = { sourceKey: 'audio/mastering/x.wav', masterKey: 'audio/mastering/y.wav', beforeLufs: -20, afterLufs: -14 };

it("renders today's labels when labels is unset", () => {
  render(<MasteringComparePlayer {...base} />);
  expect(screen.getByRole('radio', { name: 'A · Before (source)' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'B · After (master)' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /match loudness/i })).toBeInTheDocument();
});

it('blind labels replace the source/master wording', () => {
  const { container } = render(<MasteringComparePlayer {...base} labels={{ a: 'A', b: 'B' }} />);
  expect(screen.getByRole('radio', { name: 'A' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'B' })).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/source|master|louder|before|after/i);
  expect(screen.queryByRole('checkbox', { name: /match loudness/i })).toBeNull();
});

it('blind mode keeps loudness matching on', async () => {
  render(<MasteringComparePlayer {...base} labels={{ a: 'A', b: 'B' }} />);
  const audio = document.querySelectorAll('audio');
  audio.forEach((el) => fireEvent.loadedMetadata(el));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  });
  const expected = matchGains(-20, -14)!;
  // B (the second leg) is selected by default, so it carries the matched gain.
  within(document.body).getByRole('radio', { name: 'B', checked: true });
  expect(gains[1].gain.value).toBeCloseTo(expected.master, 5);
  expect(gains[0].gain.value).toBe(0);
});
