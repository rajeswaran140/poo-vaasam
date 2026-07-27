'use client';

/**
 * A/B compare the source WAV against its master. Both play in lock-step through
 * a Web Audio gain graph; toggling A/B just swaps which one is audible, so the
 * switch is instantaneous and sample-aligned — you hear the same instant of the
 * song either way, which is the only way to judge a difference honestly.
 *
 * "Match loudness" is on by default and is the whole point: mastering changes
 * level on purpose, and the louder of two clips always seems better, so without
 * matching this would just prove the master is louder. Matched, both are pulled
 * to the quieter one's level (see loudness-match) and the ear compares the sound
 * itself. "True levels" is there when you *want* to hear the loudness change.
 *
 * Playback URLs are minted per key via /api/admin/mastering/download?mode=play
 * (presigned, no attachment). Nothing is proxied through the app.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Loader2, AlertTriangle, Volume2, VolumeX } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { matchGains, formatClock } from '@/lib/loudness-match';

type Which = 'source' | 'master';

interface Props {
  sourceKey: string;
  masterKey: string;
  beforeLufs: number | null;
  afterLufs: number | null;
}

async function playUrl(key: string): Promise<string> {
  const res = await adminFetch(`/api/admin/mastering/download?mode=play&key=${encodeURIComponent(key)}`);
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(body.error || 'Could not load audio for playback.');
  return body.url as string;
}

/**
 * Slider position (0..1) -> linear gain.
 *
 * Squared rather than linear: loudness perception is roughly logarithmic, so a
 * linear slider spends most of its travel in a range that barely changes and
 * then drops off a cliff near zero. Squaring gives even-feeling steps. 0 is
 * silence, 1 is unity — the slider only ever ATTENUATES, so it can never push
 * the comparison into clipping.
 */
export function outputGain(position: number): number {
  const p = Math.min(1, Math.max(0, position));
  return p * p;
}

export function MasteringComparePlayer({ sourceKey, masterKey, beforeLufs, afterLufs }: Props) {
  const srcEl = useRef<HTMLAudioElement | null>(null);
  const masEl = useRef<HTMLAudioElement | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const srcGain = useRef<GainNode | null>(null);
  const masGain = useRef<GainNode | null>(null);
  // Shared OUTPUT stage, after the per-side gains. Volume must never be applied
  // to one side only — that is exactly what loudness-matching exists to prevent,
  // and an A/B where one leg is quieter is a broken comparison.
  const outGain = useRef<GainNode | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [which, setWhich] = useState<Which>('master');
  const [matched, setMatched] = useState(true);
  /** Slider position 0..1. Perceptual curve applied on the way to the node. */
  const [volume, setVolume] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const gains = matchGains(beforeLufs, afterLufs);
  const canMatch = gains !== null;

  // Load both presigned URLs and wait for both to be seekable.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [su, mu] = await Promise.all([playUrl(sourceKey), playUrl(masterKey)]);
        if (cancelled) return;
        if (srcEl.current) srcEl.current.src = su;
        if (masEl.current) masEl.current.src = mu;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceKey, masterKey]);

  // Apply the audible gains for the current A/B + match state. Gains live on the
  // Web Audio nodes; the media elements themselves always run at volume 1 so
  // their clocks stay honest.
  const applyGains = useCallback(() => {
    const active = matched && gains ? gains : { source: 1, master: 1 };
    if (srcGain.current) srcGain.current.gain.value = which === 'source' ? active.source : 0;
    if (masGain.current) masGain.current.gain.value = which === 'master' ? active.master : 0;
  }, [which, matched, gains]);

  useEffect(() => {
    applyGains();
  }, [applyGains]);

  // Lazily build the Web Audio graph on first play (an AudioContext must be
  // created from a user gesture or it starts suspended).
  const ensureGraph = useCallback(() => {
    if (ctx.current || !srcEl.current || !masEl.current) return;
    const AC: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = new AC();
    const sg = c.createGain();
    const mg = c.createGain();
    const og = c.createGain();
    og.gain.value = outputGain(volume);
    c.createMediaElementSource(srcEl.current).connect(sg).connect(og);
    c.createMediaElementSource(masEl.current).connect(mg).connect(og);
    og.connect(c.destination);
    ctx.current = c;
    srcGain.current = sg;
    masGain.current = mg;
    outGain.current = og;
    applyGains();
  }, [applyGains, volume]);

  // Volume rides the shared output stage, so it scales A and B identically and
  // cannot skew the comparison.
  useEffect(() => {
    if (outGain.current) outGain.current.gain.value = outputGain(volume);
  }, [volume]);

  // readyState >= 1 (HAVE_METADATA) is enough to enable the transport: duration
  // is known and the clip is seekable. We deliberately do NOT wait for >= 2
  // (HAVE_CURRENT_DATA) because preload="metadata" never fetches sample data
  // until play() is called — waiting for it would leave the button spinning
  // forever. The bytes stream in on first play.
  const bothReady = () =>
    !!srcEl.current && !!masEl.current && srcEl.current.readyState >= 1 && masEl.current.readyState >= 1;

  const onLoaded = useCallback(() => {
    if (bothReady()) {
      setReady(true);
      setDuration(masEl.current?.duration || srcEl.current?.duration || 0);
    }
  }, []);

  const toggle = useCallback(async () => {
    setError(null);
    if (!srcEl.current || !masEl.current) return;
    if (playing) {
      srcEl.current.pause();
      masEl.current.pause();
      setPlaying(false);
      return;
    }
    ensureGraph();
    await ctx.current?.resume();
    // Re-sync the pair to the master's clock before playing so any drift from a
    // previous pause is corrected — they must start from the same instant.
    const t = masEl.current.currentTime;
    srcEl.current.currentTime = t;
    applyGains();
    try {
      await Promise.all([srcEl.current.play(), masEl.current.play()]);
      setPlaying(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Playback was blocked.');
    }
  }, [playing, ensureGraph, applyGains]);

  // Keep the pair aligned: master drives the clock, the source is nudged if it
  // drifts more than 50 ms (network jitter on two independent streams).
  const onMasterTime = useCallback(() => {
    const m = masEl.current;
    const s = srcEl.current;
    if (!m || !s) return;
    setTime(m.currentTime);
    if (playing && Math.abs(s.currentTime - m.currentTime) > 0.05) s.currentTime = m.currentTime;
  }, [playing]);

  const seek = useCallback((to: number) => {
    if (masEl.current) masEl.current.currentTime = to;
    if (srcEl.current) srcEl.current.currentTime = to;
    setTime(to);
  }, []);

  const onEnded = useCallback(() => {
    setPlaying(false);
    seek(0);
  }, [seek]);

  useEffect(() => {
    // Snapshot the nodes now; refs may point elsewhere by cleanup time.
    const s = srcEl.current;
    const m = masEl.current;
    return () => {
      s?.pause();
      m?.pause();
      void ctx.current?.close();
    };
  }, []);

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-800 dark:bg-gray-800/30">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Compare before &amp; after</h3>
        {canMatch && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={matched}
              onChange={(e) => setMatched(e.target.checked)}
              className="h-3.5 w-3.5 accent-orange-600"
            />
            Match loudness
          </label>
        )}
      </div>

      {/* Hidden media elements — the UI drives them; audio routes via Web Audio.
          preload="metadata" not "auto": the source and master are multi-hundred-MB
          WAVs, and buffering BOTH in full the instant a finished job renders would
          burn ~140 MB before the admin has even chosen to listen. Metadata gives us
          duration + seekability up front; the bytes stream on first play. */}
      <audio
        ref={srcEl}
        preload="metadata"
        crossOrigin="anonymous"
        onLoadedData={onLoaded}
        onLoadedMetadata={onLoaded}
        onEnded={onEnded}
      />
      <audio
        ref={masEl}
        preload="metadata"
        crossOrigin="anonymous"
        onLoadedData={onLoaded}
        onLoadedMetadata={onLoaded}
        onTimeUpdate={onMasterTime}
        onEnded={onEnded}
      />

      {error && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={!ready && !error}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white transition hover:bg-orange-700 disabled:opacity-50"
        >
          {!ready && !error
            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            : playing
              ? <Pause className="h-5 w-5" aria-hidden="true" />
              : <Play className="ml-0.5 h-5 w-5" aria-hidden="true" />}
        </button>

        <span className="w-20 shrink-0 tabular-nums text-xs text-gray-500 dark:text-gray-400">
          {formatClock(time)} / {formatClock(duration)}
        </span>

        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
          className="h-1.5 grow cursor-pointer accent-orange-600"
        />

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setVolume((v) => (v === 0 ? 1 : 0))}
            aria-label={volume === 0 ? 'Unmute' : 'Mute'}
            className="rounded p-1 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
          >
            {volume === 0
              ? <VolumeX className="h-4 w-4" aria-hidden="true" />
              : <Volume2 className="h-4 w-4" aria-hidden="true" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume"
            title="Applies to both A and B — comparison stays loudness-matched"
            className="h-1.5 w-24 cursor-pointer accent-orange-600"
          />
        </div>
      </div>

      {/* A/B switch — a radio group so it's clear only one is audible at a time. */}
      <div role="radiogroup" aria-label="Listen to" className="mt-3 flex gap-2">
        {(['source', 'master'] as const).map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={which === w}
            onClick={() => setWhich(w)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              which === w
                ? 'border-orange-500 bg-orange-50 text-orange-800 dark:border-orange-500 dark:bg-orange-500/10 dark:text-orange-300'
                : 'border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            {w === 'source' ? 'A · Before (source)' : 'B · After (master)'}
          </button>
        ))}
      </div>

      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {matched && canMatch
          ? 'Levels matched — you are hearing the sound, not the loudness. Switch A/B while it plays.'
          : canMatch
            ? 'True levels — the master is at its mastered loudness, so it will sound louder. Switch A/B while it plays.'
            : 'Loudness could not be matched for this master, so B may simply sound louder.'}
      </p>
    </div>
  );
}
