'use client';

/**
 * Auditioning player for a saved master.
 *
 * Owns the Web Audio graph, because `createMediaElementSource` may be called
 * only ONCE per media element — so a single component builds it and everything
 * else (equaliser, meter) hangs off that one chain:
 *
 *     <audio> → EQ bands → analyser → destination
 *
 * Four capabilities, each answering a question the library could not:
 *   METER    — is this master actually behaving like its numbers claim?
 *   A/B      — is the master better than the take it came from?
 *   WAVEFORM — where is that line, and can I hear it again without dragging?
 *   KEYS     — space/arrows, so auditioning does not need the mouse.
 *
 * ⚠️ NOTHING HERE WRITES. The EQ shapes playback only; the meter observes; A/B
 * swaps which file is playing. The mastering module's promise is "loudness
 * only, never tone", and this must never look like it participates in that.
 *
 * ⚠️ CORS: Web Audio refuses a tainted source and outputs SILENCE rather than
 * erroring. The element sets crossOrigin="anonymous" and tamil-web-media allows
 * the site origin; a failure is reported in words rather than played as nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Repeat, X, Flag, Copy, Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { MasteringEqualizer } from '@/components/admin/MasteringEqualizer';
import { MasteringWaveform } from '@/components/admin/MasteringWaveform';
import { EQ_BANDS, flatGains, clampGain, isFlat, type EqGains } from '@/lib/audio-eq';
import { measureBlock, barFraction, decayPeak, METER_FLOOR_DB, TRUE_PEAK_CEILING_DB } from '@/lib/audio-meter';
import {
  binPeaks,
  normaliseLoop,
  shouldLoopBack,
  formatTime,
  shouldRenderWaveform,
  type LoopRegion,
} from '@/lib/waveform';
import { PLAYBACK_RATES, DEFAULT_RATE, clampRate, formatRate, isDetailRate, RATE_WARNING } from '@/lib/playback-rate';
import {
  addMark, removeMark, marksToText, dominantReasons, reasonLabel, formatMarkTime,
  type AuditionMark, type MarkReason,
} from '@/lib/audition-marks';
import { FAILURE_REASONS } from '@/types/generation';

interface Props {
  /** Presigned URL of the mastered WAV. */
  masterUrl: string;
  /** Presigned URL of the unmastered source, when available. */
  sourceUrl?: string | null;
  title: string;
  /** The job's measured true peak — the authoritative figure. */
  afterTp?: number | null;
  onExpired?: () => void;
}

/** Peak resolution captured at decode time; the canvas resamples down to fit. */
const WAVEFORM_BINS = 1200;

export function MasteringPlayer({ masterUrl, sourceUrl, title, afterTp, onExpired }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const filtersRef = useRef<Map<string, BiquadFilterNode>>(new Map());
  const wired = useRef(false);
  const raf = useRef<number | null>(null);
  const heldPeak = useRef<number>(METER_FLOOR_DB);

  const [gains, setGains] = useState<EqGains>(flatGains);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [level, setLevel] = useState({ peakDb: METER_FLOOR_DB, rmsDb: METER_FLOOR_DB, over: false });
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [waveformNote, setWaveformNote] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [loop, setLoop] = useState<LoopRegion | null>(null);
  const [comparing, setComparing] = useState(false);
  const [rate, setRate] = useState<number>(DEFAULT_RATE);
  // Volume lives here, not in the native control bar — see the transport below.
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [pitchShifts, setPitchShifts] = useState(false);
  const [marks, setMarks] = useState<AuditionMark[]>([]);
  const [markReason, setMarkReason] = useState<MarkReason>('pronunciation');
  const [copied, setCopied] = useState(false);

  // ---- graph -------------------------------------------------------------
  const ensureGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || wired.current) return;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        setGraphError('This browser has no Web Audio support — the meter and equaliser are unavailable.');
        return;
      }
      const ctx = new Ctor();
      const src = ctx.createMediaElementSource(audio);
      let node: AudioNode = src;
      const filters = new Map<string, BiquadFilterNode>();
      for (const band of EQ_BANDS) {
        const f = ctx.createBiquadFilter();
        f.type = 'peaking';
        f.frequency.value = band.frequency;
        f.Q.value = band.q;
        f.gain.value = clampGain(gains[band.id] ?? 0);
        node.connect(f);
        node = f;
        filters.set(band.id, f);
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      node.connect(analyser);
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      filtersRef.current = filters;
      wired.current = true;
      setGraphError(null);
    } catch (err) {
      setGraphError(
        err instanceof Error && /cross-origin|CORS/i.test(err.message)
          ? 'The audio source did not allow cross-origin playback — meter and equaliser unavailable.'
          : 'Could not attach the meter and equaliser to this player.'
      );
    }
  }, [gains]);

  useEffect(() => {
    for (const band of EQ_BANDS) {
      const f = filtersRef.current.get(band.id);
      if (f) f.gain.value = clampGain(gains[band.id] ?? 0);
    }
  }, [gains]);

  // Browsers cap concurrent AudioContexts at around six. This component is
  // keyed on the master URL, so every switch mounts a fresh one — without
  // closing the old context, auditioning a handful of masters exhausts the
  // budget and the meter and equaliser stop working with no obvious cause.
  useEffect(() => {
    return () => {
      const ctx = ctxRef.current;
      ctxRef.current = null;
      analyserRef.current = null;
      filtersRef.current = new Map();
      wired.current = false;
      if (ctx && ctx.state !== 'closed') void ctx.close();
    };
  }, []);

  // ---- meter + loop, driven from one animation frame ----------------------
  useEffect(() => {
    if (!playing) {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
      return;
    }
    const buf = new Float32Array(analyserRef.current?.fftSize ?? 2048);
    // The LOOP CHECK must run every frame — `timeupdate` fires ~4x/second and
    // cannot close a phrase cleanly. The DISPLAY must not: setState twice per
    // frame re-renders this whole tree 60 times a second for changes too small
    // to see. So the frame does the timing work, and state only moves when the
    // rendered value would actually differ.
    let lastShownPos = -1;
    let lastShownPeak = Number.NEGATIVE_INFINITY;
    const tick = () => {
      const a = audioRef.current;
      const an = analyserRef.current;
      if (an) {
        an.getFloatTimeDomainData(buf);
        const r = measureBlock(buf);
        heldPeak.current = decayPeak(heldPeak.current, r.peakDb);
        // 0.5 dB is finer than the bar can show.
        if (Math.abs(heldPeak.current - lastShownPeak) >= 0.5 || r.overCeiling) {
          lastShownPeak = heldPeak.current;
          setLevel({ peakDb: heldPeak.current, rmsDb: r.rmsDb, over: r.overCeiling });
        }
      }
      if (a) {
        // The clock shows seconds; 100 ms is already invisible.
        if (Math.abs(a.currentTime - lastShownPos) >= 0.1) {
          lastShownPos = a.currentTime;
          setPosition(a.currentTime);
        }
        if (shouldLoopBack(a.currentTime, loop) && loop) a.currentTime = loop.start;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, loop]);

  // ---- waveform ----------------------------------------------------------
  useEffect(() => {
    let alive = true;
    setPeaks(null);
    setWaveformNote(null);
    (async () => {
      try {
        const head = await fetch(masterUrl, { method: 'HEAD' });
        const size = Number(head.headers.get('content-length'));
        if (!shouldRenderWaveform(size)) {
          setWaveformNote(
            size
              ? `Waveform skipped — this file is ${Math.round(size / 1024 / 1024)} MB, large enough to stall the tab.`
              : 'Waveform unavailable for this file.'
          );
          return;
        }
        const buf = await (await fetch(masterUrl)).arrayBuffer();
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();
        const decoded = await ctx.decodeAudioData(buf);
        if (!alive) return;
        setPeaks(binPeaks(decoded.getChannelData(0), WAVEFORM_BINS));
        setDuration(decoded.duration);
        void ctx.close();
      } catch {
        if (alive) setWaveformNote('Waveform could not be drawn for this file.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [masterUrl]);

  // Applying the rate is where pitch preservation is requested. A browser that
  // refuses transposes the audio, and a transposed vocal cannot be judged for
  // pronunciation at all — so we detect the refusal and say so.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = clampRate(rate);
    const el = a as unknown as Record<string, unknown>;
    const supported = 'preservesPitch' in el || 'mozPreservesPitch' in el;
    if ('preservesPitch' in el) el.preservesPitch = true;
    else if ('mozPreservesPitch' in el) el.mozPreservesPitch = true;
    setPitchShifts(!supported);
  }, [rate]);

  /** Drop a mark at the current position. */
  const markSeq = useRef(0);
  const dropMark = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    setMarks((m) =>
      addMark(m, {
        // A monotonic counter, NOT list length: marking t, removing an earlier
        // mark, then marking t again reproduced the same id, which collided as
        // a React key and made one removal delete both.
        id: `mark-${markSeq.current++}`,
        time: a.currentTime,
        reason: markReason,
        note: '',
      })
    );
  }, [markReason]);

  // ---- keyboard ----------------------------------------------------------
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const a = audioRef.current;
    if (!a) return;
    // Never hijack typing in a field.
    const t = e.target as HTMLElement;
    // SELECT matters as much as INPUT here: the mark-reason dropdown lives
    // inside this region, and typing "m" in it should pick "melody"/"mixing",
    // not drop a mark.
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
    if (e.key === ' ') {
      e.preventDefault();
      if (a.paused) void a.play();
      else a.pause();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      a.currentTime = Math.min(a.duration || 0, a.currentTime + 5);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      a.currentTime = Math.max(0, a.currentTime - 5);
    } else if (/^[0-9]$/.test(e.key) && a.duration) {
      e.preventDefault();
      a.currentTime = (Number(e.key) / 10) * a.duration;
    } else if (e.key.toLowerCase() === 'l') {
      e.preventDefault();
      setLoop(null);
    } else if (e.key.toLowerCase() === 'm') {
      // Mark where the thought happens — both hands are already on the player.
      e.preventDefault();
      dropMark();
    }
  }, [dropMark]);

  // ---- A/B ---------------------------------------------------------------
  const toggleCompare = useCallback(() => {
    const a = audioRef.current;
    if (!a || !sourceUrl) return;
    // Preserve the playhead so the comparison is of the SAME moment — an A/B
    // that restarts from zero compares nothing.
    const at = a.currentTime;
    const wasPlaying = !a.paused;
    const wasRate = a.playbackRate;
    setComparing((c) => !c);
    a.src = comparing ? masterUrl : sourceUrl;
    a.currentTime = at;
    // Setting `src` resets playbackRate to the element default. Without this
    // an A/B started at 0.75x would play the SOURCE at 1x — you would hear a
    // difference that is only speed, which invalidates the one comparison this
    // control exists to make.
    a.playbackRate = wasRate;
    const el = a as unknown as Record<string, unknown>;
    if ('preservesPitch' in el) el.preservesPitch = true;
    else if ('mozPreservesPitch' in el) el.mozPreservesPitch = true;
    if (wasPlaying) void a.play();
  }, [comparing, masterUrl, sourceUrl]);

  const flat = isFlat(gains);

  return (
    <div
      className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/40"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`Player for ${title}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-gray-800 dark:text-gray-100">{title}</span>
        {comparing && (
          <span className="rounded border border-indigo-300 bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-900 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
            Playing the UNMASTERED take
          </span>
        )}
        {sourceUrl && (
          <button
            type="button"
            onClick={toggleCompare}
            className="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-white dark:border-gray-700 dark:text-gray-200"
          >
            {comparing ? 'Back to master' : 'A/B vs source'}
          </button>
        )}
        {loop && (
          <button
            type="button"
            onClick={() => setLoop(null)}
            className="flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
          >
            <Repeat className="h-3 w-3" aria-hidden="true" />
            Looping {formatTime(loop.start)}–{formatTime(loop.end)}
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
        <span className="flex items-center gap-1">
          {PLAYBACK_RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRate(r)}
              aria-pressed={rate === r}
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                rate === r ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'
              }`}
            >
              {formatRate(r)}
            </button>
          ))}
        </span>
      </div>

      {/* Waveform: click to seek, drag to loop. Canvas, not SVG — the SVG
          version re-rendered 240 <rect> nodes on every playhead tick. */}
      {peaks ? (
        <MasteringWaveform
          peaks={peaks}
          duration={duration}
          position={position}
          loop={loop}
          onSeek={(t) => {
            if (audioRef.current) audioRef.current.currentTime = t;
            setPosition(t);
          }}
          onLoopDrag={(from, to) => {
            const region = normaliseLoop(from, to, duration);
            if (region) setLoop(region);
          }}
        />
      ) : (
        waveformNote && <p className="text-xs text-gray-500 dark:text-gray-400">{waveformNote}</p>
      )}

      {/* TRANSPORT — replaces `<audio controls>`.
          The native bar drew a second, plainer progress line directly beneath
          the waveform, so the page showed the same information twice and the
          uglier one was the interactive-looking control. The waveform is the
          seek surface; this row is only play/pause, time and volume.

          The play button is 44px — the platform minimum for a touch target,
          and this is the control that matters most. */}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            const a = audioRef.current;
            if (!a) return;
            if (a.paused) void a.play();
            else a.pause();
          }}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white transition-colors hover:bg-purple-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
        >
          {playing ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5 translate-x-[1px]" aria-hidden="true" />}
        </button>

        <span className="tabular-nums text-sm text-gray-600 dark:text-gray-300">
          {formatTime(position)} <span className="text-gray-400 dark:text-gray-500">/ {formatTime(duration)}</span>
        </span>

        {/* Volume reveals on demand rather than permanently occupying the row. */}
        <div
          className="relative ml-auto flex items-center"
          onMouseEnter={() => setVolumeOpen(true)}
          onMouseLeave={() => setVolumeOpen(false)}
        >
          <button
            type="button"
            onClick={() => {
              const next = !muted;
              setMuted(next);
              if (audioRef.current) audioRef.current.muted = next;
              setVolumeOpen(true); // a tap on touch reveals the slider too
            }}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {muted || volume === 0 ? <VolumeX className="h-5 w-5" aria-hidden="true" /> : <Volume2 className="h-5 w-5" aria-hidden="true" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              setMuted(v === 0);
              if (audioRef.current) { audioRef.current.volume = v; audioRef.current.muted = v === 0; }
            }}
            className={`w-24 accent-purple-600 transition-opacity ${volumeOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          />
        </div>
      </div>

      <audio
        ref={audioRef}
        src={masterUrl}
        crossOrigin="anonymous"
        className="sr-only"
        onPlay={() => {
          // Reset the held peak, or a loud passage from the previous listen
          // keeps the bar high over a quiet one until it decays.
          heldPeak.current = METER_FLOOR_DB;
          ensureGraph();
          void ctxRef.current?.resume();
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onError={() => onExpired?.()}
      />

      {/* Level meter. Sample-peak, not true-peak — see lib/audio-meter. */}
      <div className="mt-2 space-y-1" aria-live="off">
        {(['peak', 'rms'] as const).map((kind) => {
          const db = kind === 'peak' ? level.peakDb : level.rmsDb;
          const hot = kind === 'peak' && level.over;
          return (
            <div key={kind} className="flex items-center gap-2 text-[11px]">
              <span className="w-9 shrink-0 uppercase text-gray-500 dark:text-gray-400">{kind}</span>
              <div className="h-2 grow overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
                <div
                  className={`h-full ${hot ? 'bg-rose-500' : 'bg-emerald-500'}`}
                  style={{ width: `${barFraction(db) * 100}%` }}
                />
              </div>
              <span className={`w-16 shrink-0 tabular-nums ${hot ? 'text-rose-600' : 'text-gray-500'}`}>
                {db <= METER_FLOOR_DB ? '−∞' : db.toFixed(1)} dB
              </span>
            </div>
          );
        })}
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Sample-peak while playing{!flat && ' — through the equaliser, not the file'}. The job&rsquo;s
          measured true peak is {typeof afterTp === 'number' ? `${afterTp.toFixed(1)} dBTP` : 'on the report'}
          {level.over && ` · above the ${TRUE_PEAK_CEILING_DB} dBTP ceiling right now`}.
        </p>
      </div>

      <MasteringEqualizer gains={gains} onChange={setGains} unavailable={graphError} />

      {isDetailRate(rate) && (
        <p className="mt-2 rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          Slowed for detail — consonants and vowel length are audible here.
          {pitchShifts && <span className="text-amber-700 dark:text-amber-300"> {RATE_WARNING}</span>}
        </p>
      )}

      <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900/40">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={dropMark}
            className="flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-xs font-medium text-white"
          >
            <Flag className="h-3 w-3" aria-hidden="true" />
            Mark here
          </button>
          <label className="text-xs">
            <span className="sr-only">Mark reason</span>
            <select
              value={markReason}
              onChange={(e) => setMarkReason(e.target.value as MarkReason)}
              className="rounded border border-gray-300 px-1.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
            >
              {FAILURE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {reasonLabel(r)}
                </option>
              ))}
            </select>
          </label>
          {marks.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(marksToText(marks, title));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard blocked — the list is selectable */
                }
              }}
              className="ml-auto flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700"
            >
              <Copy className="h-3 w-3" aria-hidden="true" />
              {copied ? 'Copied' : 'Copy notes'}
            </button>
          )}
        </div>

        {marks.length === 0 ? (
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            Press <kbd>M</kbd> while listening to mark a moment. Reasons match the Music Lab
            vocabulary, so the list pastes straight into a take&rsquo;s notes.
          </p>
        ) : (
          <>
            <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
              {marks.map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      if (audioRef.current) audioRef.current.currentTime = m.time;
                    }}
                    className="tabular-nums font-medium text-purple-700 hover:underline dark:text-purple-300"
                  >
                    {formatMarkTime(m.time)}
                  </button>
                  <span className="text-gray-700 dark:text-gray-200">{reasonLabel(m.reason)}</span>
                  <button
                    type="button"
                    onClick={() => setMarks((x) => removeMark(x, m.id))}
                    aria-label={`Remove mark at ${formatMarkTime(m.time)}`}
                    className="ml-auto text-gray-400 hover:text-rose-600"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
              Mostly{' '}
              <strong>{reasonLabel(dominantReasons(marks)[0].reason)}</strong> ({dominantReasons(marks)[0].count} of{' '}
              {marks.length}) — that is the take&rsquo;s failureReason.
            </p>
          </>
        )}
      </div>

      <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
        Space play/pause · ← → seek 5s · 0–9 jump · M mark · L clear loop · drag the waveform to loop
      </p>
    </div>
  );
}
