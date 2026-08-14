/**
 * Shared Web Audio engine for every interactive music tool: keyboard notes,
 * metronome clicks, scale and melody playback, ear-training exercises.
 *
 * ONE engine, for the reasons the spec gives:
 *  - **One AudioContext.** Browsers cap how many a page may create, and each
 *    carries real cost. Every feature building its own is how a page ends up
 *    unable to play anything after a few navigations.
 *  - **One place that stops sound.** Switching from the metronome to an
 *    exercise must silence the metronome. With per-feature implementations,
 *    "stop" means "stop mine", and the user gets two things playing at once.
 *
 * ⚠️ AUTOPLAY: an AudioContext starts `suspended` until a user gesture. Every
 * entry point calls `resume()` first, so the first click both unlocks audio and
 * plays. Nothing here runs at import time — constructing an AudioContext during
 * module evaluation would break SSR and trip the autoplay policy anyway.
 *
 * ⚠️ SCHEDULING: the metronome does NOT use setInterval for the clicks. Timer
 * drift is audible within seconds — a metronome that wanders is worse than
 * none. It uses the standard look-ahead pattern: a coarse timer wakes up
 * periodically and schedules the next few clicks at exact `AudioContext`
 * sample-clock times, which is the only accurate way in a browser.
 */

import { midiToFrequency } from '@/lib/music/pitch';
import { type Accent, type MeterDefinition, pulseSeconds, accentPattern, pulsesPerBar } from '@/lib/music/meter';

/** How far ahead we schedule, and how often we top up. Both in seconds. */
const LOOKAHEAD_S = 0.25;
const TIMER_MS = 50;

/** Click tone per accent — pitch and length, so the bar's shape is audible. */
const CLICK: Record<Accent, { hz: number; gain: number; ms: number }> = {
  strong: { hz: 1600, gain: 0.5, ms: 40 },
  medium: { hz: 1200, gain: 0.34, ms: 32 },
  weak: { hz: 800, gain: 0.2, ms: 25 },
};

export interface NoteOptions {
  /** Seconds. Defaults to a short plucked length. */
  duration?: number;
  /** 0-1. */
  gain?: number;
  /** When to start, in AudioContext time. Defaults to now. */
  at?: number;
}

type MetronomeListener = (pulseIndex: number) => void;

class MusicAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  // Metronome state
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextPulseTime = 0;
  private pulseIndex = 0;
  private metronome: { bpm: number; meter: MeterDefinition } | null = null;
  private listeners = new Set<MetronomeListener>();
  /** Every source currently sounding, so `stopAll` can silence them. */
  private active = new Set<AudioScheduledSourceNode>();

  /** Lazily create the context. Returns null outside the browser (SSR). */
  private context(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** Unlock audio after a user gesture. Safe to call repeatedly. */
  async resume(): Promise<void> {
    const ctx = this.context();
    if (ctx && ctx.state === 'suspended') await ctx.resume();
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  /** Master volume, 0-1. */
  setVolume(v: number): void {
    const ctx = this.context();
    if (ctx && this.master) this.master.gain.setTargetAtTime(Math.min(1, Math.max(0, v)), ctx.currentTime, 0.01);
  }

  /**
   * Play one pitch. A triangle wave with a short percussive envelope — enough
   * to hear the interval clearly without pretending to be a sampled piano.
   */
  playNote(midi: number, opts: NoteOptions = {}): void {
    const ctx = this.context();
    if (!ctx || !this.master) return;
    const { duration = 0.6, gain = 0.28, at = ctx.currentTime } = opts;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midiToFrequency(midi);

    // Fast attack, exponential decay. Never ramp to exactly 0 — exponential
    // ramps to zero are undefined and silently do nothing in some browsers.
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    osc.connect(env).connect(this.master);
    osc.start(at);
    osc.stop(at + duration + 0.05);
    this.track(osc);
  }

  /** Play a sequence of MIDI notes, `noteSeconds` apart. Returns total length. */
  playSequence(notes: readonly number[], noteSeconds = 0.4, opts: NoteOptions = {}): number {
    const ctx = this.context();
    if (!ctx) return 0;
    const start = ctx.currentTime + 0.05;
    notes.forEach((midi, i) => {
      this.playNote(midi, { ...opts, at: start + i * noteSeconds, duration: opts.duration ?? noteSeconds * 0.9 });
    });
    return notes.length * noteSeconds;
  }

  private click(accent: Accent, at: number): void {
    const ctx = this.context();
    if (!ctx || !this.master) return;
    const { hz, gain, ms } = CLICK[accent];
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = hz;
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
    osc.connect(env).connect(this.master);
    osc.start(at);
    osc.stop(at + ms / 1000 + 0.02);
    this.track(osc);
  }

  private track(node: AudioScheduledSourceNode): void {
    this.active.add(node);
    node.addEventListener('ended', () => this.active.delete(node));
  }

  /** Subscribe to pulse ticks (for the visual highlight). Returns an unsubscribe. */
  onPulse(fn: MetronomeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Start (or retune) the metronome. Changing BPM or meter while running takes
   * effect from the next scheduled pulse rather than restarting the bar, so a
   * tempo nudge does not lurch.
   */
  async startMetronome(bpm: number, meter: MeterDefinition): Promise<void> {
    await this.resume();
    const ctx = this.context();
    if (!ctx) return;

    const restarting = !this.metronome || this.metronome.meter.id !== meter.id;
    this.metronome = { bpm, meter };
    if (this.timer) {
      if (restarting) this.pulseIndex = 0;
      return; // already running; the scheduler picks up the new tempo
    }

    this.pulseIndex = 0;
    this.nextPulseTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), TIMER_MS);
    this.schedule();
  }

  /** Look-ahead scheduler — the reason the clicks do not drift. */
  private schedule(): void {
    const ctx = this.context();
    if (!ctx || !this.metronome) return;
    const { bpm, meter } = this.metronome;
    const dt = pulseSeconds(bpm, meter);
    const accents = accentPattern(meter);
    const perBar = pulsesPerBar(meter);

    while (this.nextPulseTime < ctx.currentTime + LOOKAHEAD_S) {
      const idx = this.pulseIndex % perBar;
      this.click(accents[idx], this.nextPulseTime);

      // Notify the UI at the moment the click actually sounds, not now.
      const delayMs = Math.max(0, (this.nextPulseTime - ctx.currentTime) * 1000);
      setTimeout(() => this.listeners.forEach((fn) => fn(idx)), delayMs);

      this.nextPulseTime += dt;
      this.pulseIndex += 1;
    }
  }

  stopMetronome(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.metronome = null;
    this.pulseIndex = 0;
  }

  /**
   * Silence everything. Call when switching tools — the single stop the spec
   * asks for, so one exercise can never play over another.
   */
  stopAll(): void {
    this.stopMetronome();
    for (const node of this.active) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    this.active.clear();
  }
}

/**
 * The process-wide engine. A module singleton rather than React context: the
 * point is that there is exactly ONE, including across route changes, and a
 * provider remounting would defeat that.
 */
export const audioEngine = new MusicAudioEngine();
