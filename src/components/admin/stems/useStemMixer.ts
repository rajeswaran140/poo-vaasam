'use client';

/**
 * A Web Audio transport for a stem set's listening copies: fetch + decode
 * once per stem, one GainNode per stem into `destination`, and a
 * play/pause/seek surface that drives them all in lockstep.
 *
 * Deliberately NOT responsible for what level each stem plays at — that's
 * `gains`/`solo`, owned by the caller (StemMixer), because solo is a
 * listening aid that must never be saved, and gains come from the saved mix
 * plus whatever the operator is mid-edit on. This hook just applies them.
 *
 * jsdom (and some real browsers) have no `AudioContext` at all. `supported`
 * is false in that case and every method is a no-op — StemMixer uses it to
 * swap the transport for a plain message instead of crashing.
 *
 * ⚠️ LOADING IS ADDITIVE, NOT A RESET-AND-RELOAD. `stems` grows one id at a
 * time in production (StemMixer resolves each stem's presigned URL in its
 * own round-trip), so re-fetching everything on every change would
 * re-download/re-decode N stems up to N times, and would swap out the
 * GainNode a currently-playing source is connected to — silently detaching
 * fader/mute/solo from whatever's already playing. See the loading effect
 * below for the fix and what happens to a stem that finishes loading
 * mid-playback.
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

  // Which ids we're currently fetching (so a stemsKey change mid-fetch never
  // starts a second, duplicate fetch for the same id), which ids failed to
  // decode (so readiness doesn't wait on them forever), and which ids the
  // MOST RECENT effect run actually wants — read inside a fetch's `.then`,
  // which may complete after a later effect run has already dropped that id.
  const loadingRef = useRef<Set<string>>(new Set());
  const failedRef = useRef<Set<string>>(new Set());
  const wantedRef = useRef<Set<string>>(new Set());

  // Fetch + decode each stem's listening copy EXACTLY ONCE, ADDITIVELY.
  //
  // StemMixer resolves each stem's presigned URL independently (one
  // `setPlayUrls` per stem, as each adminFetch round-trip lands), so
  // `stems`/`stemsKey` grows one id at a time in production. Clearing and
  // re-fetching everything on every change would re-download/re-decode
  // already-loaded stems 1+2+…+N times, and — worse — would swap out the
  // GainNode a currently-playing AudioBufferSourceNode is connected to,
  // silently detaching fader/mute/solo from whatever's already playing
  // until the next pause/play. So: skip any id already in `buffersRef`
  // (loaded), `loadingRef` (in flight) or `failedRef` (failed — retried
  // only after it leaves and rejoins `stems`); only load ids this hook has
  // never seen. A stem that finishes loading mid-playback does NOT join the
  // sources already running — it has no source yet, only a buffer and a
  // gain node (so mute/solo/fader already reach it) — it starts playing the
  // next time `play()` runs, same as any other stopped stem.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!supported || !ctx) return;

    const wanted = new Set(stems.map((s) => s.id));
    wantedRef.current = wanted;

    // Drop resources for ids no longer requested — stop any source still
    // attached (a removed stem must not keep sounding), disconnect its gain
    // node, and forget its buffer/failure so a future re-add starts clean.
    for (const id of Array.from(gainNodesRef.current.keys())) {
      if (wanted.has(id)) continue;
      const src = sourcesRef.current.get(id);
      if (src) {
        src.onended = null;
        try {
          src.stop();
        } catch {
          // Already stopped.
        }
        sourcesRef.current.delete(id);
      }
      const node = gainNodesRef.current.get(id);
      try {
        node?.disconnect();
      } catch {
        // Best effort — some environments' GainNode has no disconnect().
      }
      gainNodesRef.current.delete(id);
      buffersRef.current.delete(id);
    }
    for (const id of Array.from(failedRef.current)) {
      if (!wanted.has(id)) failedRef.current.delete(id);
    }

    const recomputeReadiness = () => {
      if (!mountedRef.current) return;
      const longest = Math.max(0, ...Array.from(buffersRef.current.values()).map((b) => b.duration));
      durationRef.current = longest;
      setDuration(longest);
      setReady(
        Array.from(wantedRef.current).every((id) => buffersRef.current.has(id) || failedRef.current.has(id))
      );
    };

    for (const track of stems) {
      // A stem that already failed stays failed until it leaves `stems`
      // (the cleanup above forgets it then) — never re-fetched just because
      // some other stem joined and changed `stemsKey`.
      if (buffersRef.current.has(track.id) || loadingRef.current.has(track.id) || failedRef.current.has(track.id)) continue;
      loadingRef.current.add(track.id);
      void (async () => {
        try {
          const res = await fetch(track.url);
          const bytes = await res.arrayBuffer();
          const buffer = (await ctx.decodeAudioData(bytes)) as AudioBuffer;
          if (!mountedRef.current || !wantedRef.current.has(track.id)) return;
          buffersRef.current.set(track.id, buffer);
          const node = ctx.createGain();
          node.connect(ctx.destination);
          gainNodesRef.current.set(track.id, node);
        } catch {
          failedRef.current.add(track.id);
        } finally {
          loadingRef.current.delete(track.id);
          recomputeReadiness();
        }
      })();
    }

    recomputeReadiness();
    // `stems` is represented by `stemsKey` — re-running on the array's own
    // identity would re-scan on every render even when nothing changed.
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

  /**
   * Start every loaded stem from the current position. No `ready` check —
   * `play` (below) adds that; `seek` calls this directly, so a seek while a
   * newly added stem is still loading keeps playing what is already loaded
   * instead of silently stopping.
   */
  const startPlayback = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || playingRef.current) return;
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
      // Play after the end (where a finished playback leaves the transport)
      // starts again from the top, rather than starting nothing at all.
      let offset = positionRef.current;
      if (durationRef.current > 0 && offset >= durationRef.current) {
        offset = 0;
        positionRef.current = 0;
        setPosition(0);
      }
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
  }, [stopSources, tick]);

  const play = useCallback(() => {
    if (!ready) return;
    startPlayback();
  }, [ready, startPlayback]);

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
      if (wasPlaying) startPlayback();
    },
    [pause, startPlayback]
  );

  return { supported, ready, playing, position, duration, play, pause, seek };
}
