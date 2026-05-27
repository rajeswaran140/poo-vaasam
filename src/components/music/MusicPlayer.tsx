'use client';

/**
 * Spotify-style music player for the songs page.
 *
 * Renders Play-all / shuffle / repeat controls, a clickable track list, and a
 * persistent bottom player bar (play/pause, prev/next, seek, time, volume).
 * Plays each song's audioUrl (S3). Tracks without audio are shown but not
 * playable and link to their lyrics page.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Music, Shuffle, Repeat } from 'lucide-react';

export interface Track {
  id: string;
  title: string;
  artist: string;
  src: string; // audioUrl ('' when the song has no audio yet)
  cover?: string; // featuredImage
  duration?: number; // seconds
}

type RepeatMode = 'off' | 'all' | 'one';

/** Format seconds as m:ss (exported for testing). */
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

function Cover({ src, alt, className }: { src?: string; alt: string; className: string }) {
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

export function MusicPlayer({ tracks }: { tracks: Track[] }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');

  const current = index != null ? tracks[index] : null;
  const anyPlaying = !!current && isPlaying;

  // Indices of tracks that actually have audio.
  const playable = useMemo(
    () => tracks.reduce<number[]>((acc, t, i) => (t.src ? (acc.push(i), acc) : acc), []),
    [tracks]
  );

  const randomOther = useCallback(() => {
    if (playable.length <= 1) return index ?? playable[0] ?? null;
    let r = index;
    while (r === index) r = playable[Math.floor(Math.random() * playable.length)];
    return r;
  }, [playable, index]);

  // Next track. `auto` = triggered by song ending (respects repeat/stop).
  const pickNext = useCallback(
    (auto: boolean): number | null => {
      if (playable.length === 0) return null;
      if (index == null) return playable[0];
      if (auto && repeat === 'one') return index;
      if (shuffle) return randomOther();
      const pos = playable.indexOf(index);
      if (pos < playable.length - 1) return playable[pos + 1];
      // reached the end
      if (!auto || repeat === 'all') return playable[0]; // wrap
      return null; // auto + repeat off -> stop
    },
    [playable, index, repeat, shuffle, randomOther]
  );

  const pickPrev = useCallback((): number | null => {
    if (playable.length === 0 || index == null) return null;
    if (shuffle) return randomOther();
    const pos = playable.indexOf(index);
    return pos > 0 ? playable[pos - 1] : playable[playable.length - 1];
  }, [playable, index, shuffle, randomOther]);

  const next = () => {
    const i = pickNext(true);
    if (i != null) setIndex(i);
  };
  const prev = () => {
    const i = pickPrev();
    if (i != null) setIndex(i);
  };

  const handleEnded = () => {
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
  };

  // Autoplay whenever the selected track changes.
  useEffect(() => {
    if (current) { setTime(0); safePlay(audioRef.current); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    if (audioRef.current) { audioRef.current.volume = volume; audioRef.current.muted = muted; }
  }, [volume, muted]);

  const togglePlay = () => {
    if (current == null) { if (playable.length) setIndex(playable[0]); return; }
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) safePlay(a); else a.pause();
  };

  const playAll = () => {
    const a = audioRef.current;
    if (current && a) { if (a.paused) safePlay(a); else a.pause(); return; }
    if (playable.length) setIndex(shuffle ? playable[Math.floor(Math.random() * playable.length)] : playable[0]);
  };

  const cycleRepeat = () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));

  const onRow = (i: number) => {
    if (!tracks[i].src) return;
    if (i === index) togglePlay();
    else setIndex(i);
  };

  return (
    <div className="pb-36">
      {/* Play-all / shuffle / repeat */}
      {playable.length > 0 && (
        <div className="mx-auto mb-6 flex max-w-3xl items-center gap-5 px-3 sm:px-4">
          <button
            onClick={playAll}
            aria-label="Play all"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-600 text-white shadow-lg transition hover:scale-105 hover:bg-orange-500"
          >
            {anyPlaying ? <Pause className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7" />}
          </button>
          <button
            onClick={() => setShuffle((s) => !s)}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            title="குலுக்கு"
            className={`transition hover:text-white ${shuffle ? 'text-orange-400' : 'text-gray-400'}`}
          >
            <Shuffle className="h-5 w-5" />
          </button>
          <button
            onClick={cycleRepeat}
            aria-label="Repeat"
            title="மீண்டும்"
            className={`relative transition hover:text-white ${repeat !== 'off' ? 'text-orange-400' : 'text-gray-400'}`}
          >
            <Repeat className="h-5 w-5" />
            {repeat === 'one' && <span className="absolute -right-2 -top-1.5 text-[10px] font-bold">1</span>}
          </button>
        </div>
      )}

      <ol className="max-w-3xl mx-auto divide-y divide-white/5">
        {tracks.map((t, i) => {
          const active = i === index;
          const isPlayable = !!t.src;
          return (
            <li key={t.id}>
              <div
                onClick={() => onRow(i)}
                role={isPlayable ? 'button' : undefined}
                tabIndex={isPlayable ? 0 : undefined}
                onKeyDown={(e) => {
                  if (isPlayable && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onRow(i);
                  }
                }}
                className={`group flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-2.5 rounded-md transition-colors ${
                  isPlayable ? 'cursor-pointer hover:bg-white/5' : 'opacity-60'
                } ${active ? 'bg-white/10' : ''}`}
              >
                <div className="w-6 shrink-0 text-center text-sm text-gray-400">
                  {isPlayable ? (
                    active && isPlaying ? (
                      <Pause className="w-4 h-4 text-orange-400 mx-auto" />
                    ) : (
                      <>
                        <span className="group-hover:hidden">{i + 1}</span>
                        <Play className="w-4 h-4 mx-auto hidden group-hover:block text-white" />
                      </>
                    )
                  ) : (
                    <Music className="w-4 h-4 mx-auto text-gray-600" />
                  )}
                </div>
                <Cover src={t.cover} alt={t.title} className="w-11 h-11 rounded shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className={`truncate font-tamil ${active ? 'text-orange-400' : 'text-white'}`}>{t.title}</div>
                  <div className="truncate text-sm text-gray-400 font-tamil">{t.artist}</div>
                </div>
                <Link
                  href={`/content/${t.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="hidden sm:block text-xs text-gray-400 hover:text-orange-400 font-tamil px-2 shrink-0"
                >
                  பாடல் வரிகள்
                </Link>
                <span className="text-xs text-gray-500 w-10 text-right shrink-0 tabular-nums">
                  {isPlayable && t.duration ? formatTime(t.duration) : ''}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

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
                  onClick={togglePlay}
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
    </div>
  );
}
