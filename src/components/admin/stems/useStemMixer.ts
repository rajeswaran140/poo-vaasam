'use client';

/**
 * A Web Audio transport for a stem set's listening copies: fetch + decode
 * once, one GainNode per stem into `destination`, and a play/pause/seek
 * surface that drives them all in lockstep.
 *
 * Deliberately NOT responsible for what level each stem plays at — that's
 * `gains`/`solo`, owned by the caller (StemMixer), because solo is a
 * listening aid that must never be saved, and gains come from the saved mix
 * plus whatever the operator is mid-edit on. This hook just applies them.
 *
 * jsdom (and some real browsers) have no `AudioContext` at all. `supported`
 * is false in that case and every method is a no-op — StemMixer uses it to
 * swap the transport for a plain message instead of crashing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MIN_GAIN_DB } from '@/lib/stems';

export interface MixerTrack {
  id: string;
  url: string;
}

export interface MixerLevel {
  gainDb: number;
  muted: boolean;
}

export interface UseStemMixerArgs {
  stems: MixerTrack[];
  gains: Record<string, MixerLevel>;
  solo: ReadonlySet<string>;
}

export interface UseStemMixerResult {
  /** This browser has a Web Audio API to drive at all. */
  supported: boolean;
  /** Every stem's listening copy is fetched and decoded. */
  ready: boolean;
  playing: boolean;
  position: number;
  duration: number;
  play: () => void;
  pause: () => void;
  seek: (sec: number) => void;
}

/** Scheduling slack so every stem's source starts on the same audio-clock tick. */
const START_LATENCY_SEC = 0.05;
/** gain.setTargetAtTime's time constant — fast enough to feel instant, slow enough not to click. */
const GAIN_RAMP_TIME_CONSTANT = 0.01;

function effectiveGain(level: MixerLevel | undefined, soloActive: boolean, soloed: boolean): number {
  const { gainDb, muted } = level ?? { gainDb: 0, muted: false };
  if (muted) return 0;
  if (soloActive && !soloed) return 0;
  if (gainDb <= MIN_GAIN_DB) return 0;
  return 10 ** (gainDb / 20);
}

export function useStemMixer({ stems, gains, solo }: UseStemMixerArgs): UseStemMixerResult {
  const [supported] = useState(() => typeof AudioContext !== 'undefined');
  const ctxRef = useRef<AudioContext | null>(null);
  const gainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const sourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  // Refs mirroring the state above, read inside callbacks (play/pause/seek,
  // the rAF tick) that must see the latest value without going stale across
  // renders or being recreated on every state change.
  const playingRef = useRef(false);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  // ctx.currentTime, and the `position` it corresponds to, at the moment
  // playback last (re)started — the pair the rAF tick advances from.
  const startedAtCtxTimeRef = useRef(0);
  const startedAtPositionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stopSources = useCallback(() => {
    for (const src of sourcesRef.current.values()) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // Already stopped, or never started — either way, nothing to undo.
      }
    }
    sourcesRef.current.clear();
  }, []);

  // One AudioContext per mount.
  useEffect(() => {
    if (!supported) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    ctxRef.current = ctx;
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      stopSources();
      void ctx.close();
      ctxRef.current = null;
    };
    // `stopSources` has no dependencies of its own; `supported` never
    // changes after the first render (see its useState above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  // One id+url per stem, so a presigned URL refresh with nothing else
  // changed is treated as the same stem — not a reason to re-fetch.
  const stemsKey = stems.map((s) => `${s.id}:${s.url}`).join('|');

  // Fetch + decode every stem's listening copy once the context exists.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!supported || !ctx) return;
    let cancelled = false;
    setReady(false);
    gainNodesRef.current.clear();
    buffersRef.current.clear();

    void (async () => {
      let longest = 0;
      for (const track of stems) {
        try {
          const res = await fetch(track.url);
          const bytes = await res.arrayBuffer();
          const buffer = (await ctx.decodeAudioData(bytes)) as AudioBuffer;
          if (cancelled) return;
          buffersRef.current.set(track.id, buffer);
          const node = ctx.createGain();
          node.connect(ctx.destination);
          gainNodesRef.current.set(track.id, node);
          longest = Math.max(longest, buffer.duration);
        } catch {
          // This one stem just doesn't play; the rest of the mix still works.
        }
      }
      if (cancelled || !mountedRef.current) return;
      durationRef.current = longest;
      setDuration(longest);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
    // `stems` is represented by `stemsKey` below — re-running on the array's
    // own identity would re-fetch every stem on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, stemsKey]);

  // Apply level/mute/solo to every gain node that exists right now. Runs on
  // every gains/solo change AND whenever loading finishes (`ready`), so a
  // fader move is heard immediately and a freshly created node starts at
  // the level already chosen rather than Web Audio's default of 1.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const soloActive = solo.size > 0;
    for (const [id, node] of gainNodesRef.current) {
      const v = effectiveGain(gains[id], soloActive, solo.has(id));
      node.gain.setTargetAtTime(v, ctx.currentTime, GAIN_RAMP_TIME_CONSTANT);
    }
  }, [gains, solo, ready]);

  const tick = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !playingRef.current) return;
    const elapsed = ctx.currentTime - startedAtCtxTimeRef.current;
    const next = Math.min(durationRef.current, startedAtPositionRef.current + Math.max(0, elapsed));
    positionRef.current = next;
    setPosition(next);
    if (durationRef.current > 0 && next >= durationRef.current) {
      stopSources();
      playingRef.current = false;
      setPlaying(false);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [stopSources]);

  const play = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !ready || playingRef.current) return;
    void (async () => {
      if (ctx.state !== 'running') {
        try {
          await ctx.resume();
        } catch {
          // Best effort — playback still starts; it just may stay silent
          // until the browser's autoplay gate opens on its own.
        }
      }
      if (!mountedRef.current) return;
      const when = ctx.currentTime + START_LATENCY_SEC;
      const offset = positionRef.current;
      stopSources();
      for (const [id, buffer] of buffersRef.current) {
        if (buffer.duration <= offset) continue; // Already past this stem's end.
        const node = gainNodesRef.current.get(id);
        if (!node) continue;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(node);
        src.start(when, offset);
        sourcesRef.current.set(id, src);
      }
      startedAtCtxTimeRef.current = when;
      startedAtPositionRef.current = offset;
      playingRef.current = true;
      setPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    })();
  }, [ready, stopSources, tick]);

  const pause = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !playingRef.current) return;
    const elapsed = ctx.currentTime - startedAtCtxTimeRef.current;
    const next = Math.min(durationRef.current, startedAtPositionRef.current + Math.max(0, elapsed));
    stopSources();
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    positionRef.current = next;
    setPosition(next);
    playingRef.current = false;
    setPlaying(false);
  }, [stopSources]);

  const seek = useCallback(
    (sec: number) => {
      const clamped = Math.max(0, Math.min(durationRef.current, sec));
      const wasPlaying = playingRef.current;
      if (wasPlaying) pause();
      positionRef.current = clamped;
      setPosition(clamped);
      if (wasPlaying) play();
    },
    [pause, play]
  );

  return { supported, ready, playing, position, duration, play, pause, seek };
}
