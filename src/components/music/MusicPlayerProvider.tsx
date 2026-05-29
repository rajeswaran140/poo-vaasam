'use client';

/**
 * Global music player.
 *
 * Mounted once in the root layout so playback (and the bottom bar) persist as
 * visitors navigate between pages — Spotify-style. Page UIs (e.g. the songs
 * list) drive it via the useMusicPlayer() context.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Music } from 'lucide-react';

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
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} loading="lazy" className={`${className} object-cover`} />;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.src]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = muted;
    }
  }, [volume, muted]);

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

  // Media Session: lock-screen / notification metadata + hardware controls.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    if (!current) {
      ms.metadata = null;
      return;
    }
    try {
      ms.metadata = new window.MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: 'தமிழகவல்',
        artwork: current.cover ? [{ src: current.cover, sizes: '512x512', type: 'image/png' }] : [],
      });
    } catch {
      /* MediaMetadata unavailable */
    }
    const set = (action: MediaSessionAction, handler: (() => void) | null) => {
      try { ms.setActionHandler(action, handler); } catch { /* unsupported action */ }
    };
    set('play', () => safePlay(audioRef.current));
    set('pause', () => audioRef.current?.pause());
    set('previoustrack', prev);
    set('nexttrack', next);
    set('seekto', null);
  }, [current, prev, next]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch { /* noop */ }
  }, [isPlaying]);

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
            <div className="flex w-2/5 min-w-0 items-center gap-3 sm:w-1/4">
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
            </div>

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
                  onChange={(e) => {
                    const a = audioRef.current;
                    const v = Number(e.target.value);
                    if (a) a.currentTime = v;
                    setTime(v);
                  }}
                  aria-label="Seek"
                  className="h-2.5 flex-1 cursor-pointer accent-orange-500"
                />
                <span className="w-9 text-[11px] tabular-nums text-gray-400">{formatTime(duration)}</span>
              </div>
            </div>

            <div className="hidden w-1/4 items-center justify-end gap-2 md:flex">
              <button onClick={() => setMuted((m) => !m)} aria-label="Mute" className="text-gray-300 hover:text-white">
                {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  setMuted(false);
                }}
                aria-label="Volume"
                className="h-1 w-24 cursor-pointer accent-orange-500"
              />
            </div>
          </div>
        </section>
      )}
    </PlayerContext.Provider>
  );
}
