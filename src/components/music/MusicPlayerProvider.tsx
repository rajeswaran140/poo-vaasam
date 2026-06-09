'use client';

/**
 * Global music player.
 *
 * Mounted once in the root layout so playback (and the bottom bar) persist as
 * visitors navigate between pages — Spotify-style. Page UIs (e.g. the songs
 * list) drive it via the useMusicPlayer() context.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  clearMediaSession,
  setActionHandlers,
  setMetadata,
  setPlaybackState,
  updatePositionState,
} from './media-session';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Music, Shuffle, Repeat, ChevronDown } from 'lucide-react';
import { trackAudioPlay } from '@/lib/analytics-events';

export interface Track {
  id: string;
  title: string;
  artist: string;
  src: string; // audioUrl ('' if the song has no audio yet)
  cover?: string;
  duration?: number;
}

type RepeatMode = 'off' | 'all' | 'one';

const STORAGE_KEY = 'tamilagaval:player:v1';

/** Format seconds as m:ss. */
export function formatTime(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function safePlay(audio: HTMLAudioElement | null) {
  if (!audio) return;
  try {
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    /* jsdom / autoplay-blocked */
  }
}

export function Cover({ src, alt, className }: { src?: string; alt: string; className: string }) {
  if (src) {
    return (
      <Image
        src={src}
        alt={alt}
        width={96}
        height={96}
        loading="lazy"
        sizes="48px"
        className={`${className} object-cover`}
      />
    );
  }
  return (
    <div className={`${className} flex items-center justify-center bg-gradient-to-br from-orange-500 to-orange-700`}>
      <Music className="w-1/2 h-1/2 text-white/90" />
    </div>
  );
}

interface PlayerContextValue {
  current: Track | null;
  isPlaying: boolean;
  /** True while the current track is buffering (waiting for data). */
  loading: boolean;
  /** Set when the current track fails to load/decode; null otherwise. */
  error: string | null;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Replace the queue and start playing from startIndex. */
  playQueue: (tracks: Track[], startIndex: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function useMusicPlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('useMusicPlayer must be used within MusicPlayerProvider');
  return ctx;
}

export function MusicPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  // Full-screen "Now Playing" view (mobile-first, app-style).
  const [expanded, setExpanded] = useState(false);

  // When restoring a session on load we re-hydrate the queue without autoplaying
  // (browsers block autoplay without a gesture) and seek to the saved position.
  const skipNextAutoplay = useRef(false);
  const pendingSeek = useRef(0);

  const current = index != null ? queue[index] ?? null : null;
  const playable = useMemo(
    () => queue.reduce<number[]>((acc, t, i) => (t.src ? (acc.push(i), acc) : acc), []),
    [queue]
  );

  const randomOther = useCallback((): number | null => {
    if (playable.length <= 1) return index;
    let r = index;
    while (r === index) r = playable[Math.floor(Math.random() * playable.length)];
    return r;
  }, [playable, index]);

  const pickNext = useCallback(
    (auto: boolean): number | null => {
      if (playable.length === 0) return null;
      if (index == null) return playable[0];
      if (auto && repeat === 'one') return index;
      if (shuffle) return randomOther();
      const pos = playable.indexOf(index);
      if (pos < playable.length - 1) return playable[pos + 1];
      if (!auto || repeat === 'all') return playable[0];
      return null;
    },
    [playable, index, repeat, shuffle, randomOther]
  );

  const pickPrev = useCallback((): number | null => {
    if (playable.length === 0 || index == null) return null;
    if (shuffle) return randomOther();
    const pos = playable.indexOf(index);
    return pos > 0 ? playable[pos - 1] : playable[playable.length - 1];
  }, [playable, index, shuffle, randomOther]);

  const next = useCallback(() => {
    const i = pickNext(true);
    if (i != null) setIndex(i);
  }, [pickNext]);
  const prev = useCallback(() => {
    const i = pickPrev();
    if (i != null) setIndex(i);
  }, [pickPrev]);

  const handleEnded = useCallback(() => {
    if (repeat === 'one') {
      const a = audioRef.current;
      if (a) { a.currentTime = 0; safePlay(a); }
      return;
    }
    const i = pickNext(true);
    if (i == null) { setIsPlaying(false); return; }
    if (i === index) {
      const a = audioRef.current;
      if (a) { a.currentTime = 0; safePlay(a); }
      return;
    }
    setIndex(i);
  }, [repeat, pickNext, index]);

  const playQueue = useCallback((tracks: Track[], startIndex: number) => {
    setQueue(tracks);
    setIndex(startIndex);
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || current == null) return;
    if (a.paused) safePlay(a);
    else a.pause();
  }, [current]);

  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);
  const cycleRepeat = useCallback(
    () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')),
    []
  );

  // Restore the previous session (queue + position) once, on mount. Paused.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (Array.isArray(s.queue) && s.queue.length && typeof s.index === 'number') {
        skipNextAutoplay.current = true;
        pendingSeek.current = typeof s.time === 'number' ? s.time : 0;
        setQueue(s.queue);
        setIndex(s.index);
        setShuffle(!!s.shuffle);
        setRepeat(s.repeat === 'all' || s.repeat === 'one' ? s.repeat : 'off');
      }
    } catch {
      /* ignore corrupt/blocked storage */
    }
  }, []);

  // Autoplay whenever the playing track changes (but not on a restored session).
  useEffect(() => {
    if (!current) return;
    setTime(0);
    setError(null);
    if (skipNextAutoplay.current) {
      skipNextAutoplay.current = false;
      return;
    }
    safePlay(audioRef.current);
    // Track only when audio is actually about to play (not on session restore).
    // Fires once per track-start, including queue advances — matches how a
    // listener would describe "I played this song."
    if (current.src) trackAudioPlay(current.id, current.title);
    // Key on the track IDENTITY, not its src: two different songs can share an
    // audio URL (placeholder/sample reuse), and keying on src would skip the
    // restart + play event when advancing between them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = muted;
    }
  }, [volume, muted]);

  // Stall watchdog: on a flaky mobile connection `onWaiting`/`onLoadStart` can
  // set loading=true and never get a matching `onPlaying`/`onCanPlay`, leaving
  // the spinner (and the aria-busy play button) stuck forever. If loading hasn't
  // cleared within 15s, drop it so the control is usable again — if playback
  // does eventually start, `onPlay` re-clears any error.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 15000);
    return () => clearTimeout(t);
  }, [loading, current?.id]);

  // Persist what's playing (and roughly where) so a reload can restore it.
  useEffect(() => {
    try {
      if (index == null || queue.length === 0) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ queue, index, shuffle, repeat, time: Math.floor(time) })
      );
    } catch {
      /* ignore */
    }
    // Persist on track/mode change and roughly once per second (Math.floor(time)).
  }, [queue, index, shuffle, repeat, time]);

  // Media Session: lock-screen / notification "now playing" — metadata, the
  // play/pause indicator, the elapsed-time scrubber, and transport + seek
  // controls. The browser-API glue lives in ./media-session (pure + tested);
  // these effects just feed it the current player state.
  useEffect(() => {
    if (!current) {
      clearMediaSession();
      return;
    }
    setMetadata({
      title: current.title,
      artist: current.artist,
      album: 'தமிழகவல்',
      artwork: current.cover,
    });
    setActionHandlers({
      play: () => safePlay(audioRef.current),
      pause: () => audioRef.current?.pause(),
      previoustrack: prev,
      nexttrack: next,
      seekto: (t) => {
        const a = audioRef.current;
        if (a) a.currentTime = t;
      },
      seekbackward: (off) => {
        const a = audioRef.current;
        if (a) a.currentTime = Math.max(0, a.currentTime - off);
      },
      seekforward: (off) => {
        const a = audioRef.current;
        if (a) a.currentTime = Math.min(a.duration || Infinity, a.currentTime + off);
      },
    });
    return () => clearMediaSession();
  }, [current, prev, next]);

  // Reflect play/pause on the OS surface so the lock-screen button is correct.
  useEffect(() => {
    setPlaybackState(current ? (isPlaying ? 'playing' : 'paused') : 'none');
  }, [current, isPlaying]);

  // Keep the lock-screen scrubber in step with playback.
  useEffect(() => {
    if (current) updatePositionState({ duration, position: time });
  }, [current, duration, time]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch { /* noop */ }
  }, [isPlaying]);

  // Lock background scroll + close the full-screen player on Escape while open.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  const onSeek = (v: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = v;
    setTime(v);
  };
  const onVolume = (v: number) => { setVolume(v); setMuted(false); };
  const toggleMute = () => setMuted((m) => !m);

  const value = useMemo<PlayerContextValue>(
    () => ({ current, isPlaying, loading, error, shuffle, repeat, playQueue, toggle, next, prev, toggleShuffle, cycleRepeat }),
    [current, isPlaying, loading, error, shuffle, repeat, playQueue, toggle, next, prev, toggleShuffle, cycleRepeat]
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {current && <div aria-hidden className="h-24" />}

      <audio
        ref={audioRef}
        src={current?.src || undefined}
        preload="metadata"
        onPlay={() => { setIsPlaying(true); setError(null); }}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadStart={() => { setLoading(true); setError(null); }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onCanPlay={() => setLoading(false)}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          if (pendingSeek.current > 0) {
            try { e.currentTarget.currentTime = pendingSeek.current; } catch { /* noop */ }
            setTime(pendingSeek.current);
            pendingSeek.current = 0;
          }
        }}
        onError={() => {
          setLoading(false);
          setIsPlaying(false);
          setError('இந்தப் பாடலை இயக்க முடியவில்லை. பிறகு முயற்சிக்கவும்.');
        }}
      />

      {current && (
        <section
          role="region"
          aria-label="இசை இயக்கி"
          className="animate-player-slide-up fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-gray-900/95 shadow-[0_-8px_30px_rgba(0,0,0,0.45)] backdrop-blur"
        >
          {error && (
            <p role="alert" className="bg-red-600/90 px-4 py-1.5 text-center text-xs font-tamil text-white">
              {error}
            </p>
          )}
          <div className="container mx-auto flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label="இயக்கப்படும் பாடலை விரிவாக்கு"
              className="flex w-2/5 min-w-0 items-center gap-3 rounded-lg text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-400/60 sm:w-1/4"
            >
              <Cover src={current.cover} alt={current.title} className="h-12 w-12 rounded shadow-md shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {isPlaying && !loading && (
                    <span className="eq h-3 shrink-0 text-orange-400" aria-hidden>
                      <span /><span /><span /><span />
                    </span>
                  )}
                  <span className="truncate text-sm text-white font-tamil">{current.title}</span>
                </div>
                <div className="truncate text-xs text-gray-400 font-tamil">{current.artist}</div>
              </div>
            </button>

            <div className="mx-auto flex max-w-xl flex-1 flex-col items-center gap-1.5">
              <div className="flex items-center gap-3 sm:gap-5">
                <button onClick={prev} aria-label="Previous" className="flex h-11 w-11 items-center justify-center text-gray-300 transition-all duration-150 hover:scale-110 hover:text-white active:scale-95">
                  <SkipBack className="h-5 w-5" />
                </button>
                <button
                  onClick={toggle}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  aria-busy={loading}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-600 text-white shadow-lg shadow-orange-900/30 transition-all duration-150 hover:scale-105 hover:bg-orange-500 active:scale-95"
                >
                  {loading ? (
                    <span
                      aria-hidden
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    />
                  ) : isPlaying ? (
                    <Pause className="h-5 w-5" />
                  ) : (
                    <Play className="ml-0.5 h-5 w-5" />
                  )}
                </button>
                <button onClick={next} aria-label="Next" className="flex h-11 w-11 items-center justify-center text-gray-300 transition-all duration-150 hover:scale-110 hover:text-white active:scale-95">
                  <SkipForward className="h-5 w-5" />
                </button>
              </div>
              <div className="flex w-full items-center gap-2">
                <span className="w-9 text-right text-[11px] tabular-nums text-gray-400">{formatTime(time)}</span>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  value={time}
                  step="any"
                  onChange={(e) => onSeek(Number(e.target.value))}
                  aria-label="Seek"
                  className="h-2.5 flex-1 cursor-pointer accent-orange-500"
                />
                <span className="w-9 text-[11px] tabular-nums text-gray-400">{formatTime(duration)}</span>
              </div>
            </div>

            <div className="hidden w-1/4 items-center justify-end gap-2 md:flex">
              <button onClick={toggleMute} aria-label="Mute" className="text-gray-300 hover:text-white">
                {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => onVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1 w-24 cursor-pointer accent-orange-500"
              />
            </div>
          </div>
        </section>
      )}

      {expanded && current && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="இயக்கப்படும் பாடல்"
          className="animate-player-slide-up fixed inset-0 z-[60] flex flex-col bg-gradient-to-b from-gray-900 via-gray-950 to-black px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] text-white"
        >
          {/* Top bar: collapse */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setExpanded(false)}
              aria-label="மூடு"
              className="-ml-2 flex h-11 w-11 items-center justify-center text-gray-300 transition-colors hover:text-white"
            >
              <ChevronDown className="h-7 w-7" />
            </button>
            <span className="font-tamil text-xs uppercase tracking-wide text-gray-400">இயக்கப்படுகிறது</span>
            <span aria-hidden className="h-11 w-11" />
          </div>

          {/* Artwork + title */}
          <div className="flex flex-1 flex-col items-center justify-center gap-8">
            <Cover
              src={current.cover}
              alt={current.title}
              className="aspect-square w-full max-w-[18rem] rounded-2xl shadow-2xl ring-1 ring-white/10"
            />
            <div className="w-full max-w-md text-center">
              <h2 className="truncate font-kavivanar text-2xl font-bold">{current.title}</h2>
              <p className="mt-1 truncate font-tamil text-gray-400">{current.artist}</p>
            </div>
          </div>

          {/* Controls */}
          <div className="mx-auto w-full max-w-md space-y-5">
            {error && (
              <p role="alert" className="rounded-lg bg-red-600/90 px-3 py-2 text-center text-sm font-tamil">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              <span className="w-10 text-right text-xs tabular-nums text-gray-400">{formatTime(time)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={time}
                step="any"
                onChange={(e) => onSeek(Number(e.target.value))}
                aria-label="Seek"
                className="h-2.5 flex-1 cursor-pointer accent-orange-500"
              />
              <span className="w-10 text-xs tabular-nums text-gray-400">{formatTime(duration)}</span>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={toggleShuffle}
                aria-label="Shuffle"
                aria-pressed={shuffle}
                className={`flex h-12 w-12 items-center justify-center transition active:scale-95 ${shuffle ? 'text-orange-400' : 'text-gray-400 hover:text-white'}`}
              >
                <Shuffle className="h-6 w-6" />
              </button>
              <button onClick={prev} aria-label="Previous" className="flex h-14 w-14 items-center justify-center text-gray-200 transition hover:text-white active:scale-95">
                <SkipBack className="h-8 w-8" />
              </button>
              <button
                onClick={toggle}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                aria-busy={loading}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-600 text-white shadow-xl shadow-orange-900/40 transition hover:scale-105 hover:bg-orange-500 active:scale-95"
              >
                {loading ? (
                  <span aria-hidden className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : isPlaying ? (
                  <Pause className="h-7 w-7" />
                ) : (
                  <Play className="ml-1 h-7 w-7" />
                )}
              </button>
              <button onClick={next} aria-label="Next" className="flex h-14 w-14 items-center justify-center text-gray-200 transition hover:text-white active:scale-95">
                <SkipForward className="h-8 w-8" />
              </button>
              <button
                onClick={cycleRepeat}
                aria-label={repeat === 'off' ? 'Repeat' : repeat === 'all' ? 'Repeat all' : 'Repeat one'}
                className={`relative flex h-12 w-12 items-center justify-center transition active:scale-95 ${repeat !== 'off' ? 'text-orange-400' : 'text-gray-400 hover:text-white'}`}
              >
                <Repeat className="h-6 w-6" />
                {repeat === 'one' && <span className="absolute right-1.5 top-1.5 text-[10px] font-bold">1</span>}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={toggleMute} aria-label="Mute" className="-ml-2 flex h-11 w-11 items-center justify-center text-gray-300 transition-colors hover:text-white">
                {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => onVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-2.5 flex-1 cursor-pointer accent-orange-500"
              />
            </div>
          </div>
        </div>
      )}
    </PlayerContext.Provider>
  );
}
