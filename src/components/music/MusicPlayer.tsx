'use client';

/**
 * Spotify-style music player for the songs page.
 *
 * Renders a clickable track list plus a persistent bottom player bar
 * (play/pause, prev/next, seek, time, volume, autoplay-next). Plays each
 * song's audioUrl (S3). Tracks without audio are shown but not playable and
 * link to their lyrics page.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Music } from 'lucide-react';

export interface Track {
  id: string;
  title: string;
  artist: string;
  src: string; // audioUrl ('' when the song has no audio yet)
  cover?: string; // featuredImage
  duration?: number; // seconds
}

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

  const current = index != null ? tracks[index] : null;

  const findPlayable = useCallback(
    (from: number, dir: number) => {
      const n = tracks.length;
      for (let k = 1; k <= n; k++) {
        const i = (((from + dir * k) % n) + n) % n;
        if (tracks[i].src) return i;
      }
      return from;
    },
    [tracks]
  );

  const next = useCallback(() => {
    if (index != null) setIndex(findPlayable(index, 1));
  }, [index, findPlayable]);
  const prev = useCallback(() => {
    if (index != null) setIndex(findPlayable(index, -1));
  }, [index, findPlayable]);

  // Autoplay whenever the selected track changes.
  useEffect(() => {
    if (current) {
      setTime(0);
      safePlay(audioRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = muted;
    }
  }, [volume, muted]);

  const togglePlay = () => {
    if (current == null) {
      const first = tracks.findIndex((t) => t.src);
      if (first >= 0) setIndex(first);
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) safePlay(a);
    else a.pause();
  };

  const onRow = (i: number) => {
    if (!tracks[i].src) return;
    if (i === index) togglePlay();
    else setIndex(i);
  };

  return (
    <div className="pb-36">
      <ol className="max-w-3xl mx-auto divide-y divide-white/5">
        {tracks.map((t, i) => {
          const active = i === index;
          const playable = !!t.src;
          return (
            <li key={t.id}>
              <div
                onClick={() => onRow(i)}
                role={playable ? 'button' : undefined}
                tabIndex={playable ? 0 : undefined}
                onKeyDown={(e) => {
                  if (playable && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onRow(i);
                  }
                }}
                className={`group flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-2.5 rounded-md transition-colors ${
                  playable ? 'cursor-pointer hover:bg-white/5' : 'opacity-60'
                } ${active ? 'bg-white/10' : ''}`}
              >
                <div className="w-6 shrink-0 text-center text-sm text-gray-400">
                  {playable ? (
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
                  {playable && t.duration ? formatTime(t.duration) : ''}
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
        onEnded={next}
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
