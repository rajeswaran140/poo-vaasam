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
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');

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

  // Autoplay whenever the playing track changes.
  useEffect(() => {
    if (current) {
      setTime(0);
      safePlay(audioRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.src]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = muted;
    }
  }, [volume, muted]);

  const value = useMemo<PlayerContextValue>(
    () => ({ current, isPlaying, shuffle, repeat, playQueue, toggle, next, prev, toggleShuffle, cycleRepeat }),
    [current, isPlaying, shuffle, repeat, playQueue, toggle, next, prev, toggleShuffle, cycleRepeat]
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {current && <div aria-hidden className="h-24" />}

      <audio
        ref={audioRef}
        src={current?.src || undefined}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />

      {current && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-800 bg-gray-900/95 backdrop-blur">
          <div className="container mx-auto flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
            <div className="flex w-2/5 min-w-0 items-center gap-3 sm:w-1/4">
              <Cover src={current.cover} alt={current.title} className="h-12 w-12 rounded shrink-0" />
              <div className="min-w-0">
                <div className="truncate text-sm text-white font-tamil">{current.title}</div>
                <div className="truncate text-xs text-gray-400 font-tamil">{current.artist}</div>
              </div>
            </div>

            <div className="mx-auto flex max-w-xl flex-1 flex-col items-center gap-1.5">
              <div className="flex items-center gap-5">
                <button onClick={prev} aria-label="Previous" className="text-gray-300 hover:text-white">
                  <SkipBack className="h-5 w-5" />
                </button>
                <button
                  onClick={toggle}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-600 text-white shadow hover:bg-orange-500"
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                </button>
                <button onClick={next} aria-label="Next" className="text-gray-300 hover:text-white">
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
                  className="h-1 flex-1 cursor-pointer accent-orange-500"
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
        </div>
      )}
    </PlayerContext.Provider>
  );
}
