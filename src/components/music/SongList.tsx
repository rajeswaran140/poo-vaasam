'use client';

/**
 * Songs track list. Drives the global MusicPlayerProvider — clicking a row (or
 * Play-all) sets the player queue; the persistent bottom bar is rendered by the
 * provider, so playback continues as the visitor navigates away.
 */

import Link from 'next/link';
import { Play, Pause, Music, Shuffle, Repeat, ChevronRight } from 'lucide-react';
import { useMusicPlayer, Cover, formatTime, type Track } from './MusicPlayerProvider';

export function SongList({ tracks }: { tracks: Track[] }) {
  const player = useMusicPlayer();
  const currentId = player.current?.id;
  const firstPlayable = tracks.findIndex((t) => t.src);
  const playableCount = tracks.filter((t) => t.src).length;
  const queueIsCurrent = !!currentId && tracks.some((t) => t.id === currentId);
  const anyPlaying = queueIsCurrent && player.isPlaying;

  const onRow = (i: number) => {
    if (!tracks[i].src) return;
    if (tracks[i].id === currentId) player.toggle();
    else player.playQueue(tracks, i);
  };

  const playAll = () => {
    if (queueIsCurrent) player.toggle();
    else if (firstPlayable >= 0) player.playQueue(tracks, firstPlayable);
  };

  return (
    <div className="pb-6">
      {playableCount > 0 && (
        <div className="mx-auto mb-6 flex max-w-3xl items-center gap-5 px-3 sm:px-4">
          <button
            onClick={playAll}
            aria-label="Play all"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-600 text-white shadow-lg transition hover:scale-105 hover:bg-orange-500"
          >
            {anyPlaying ? <Pause className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7" />}
          </button>
          <button
            onClick={player.toggleShuffle}
            aria-label="Shuffle"
            aria-pressed={player.shuffle}
            className={`transition hover:text-white ${player.shuffle ? 'text-orange-400' : 'text-gray-400'}`}
          >
            <Shuffle className="h-5 w-5" />
          </button>
          <button
            onClick={player.cycleRepeat}
            aria-label="Repeat"
            className={`relative transition hover:text-white ${player.repeat !== 'off' ? 'text-orange-400' : 'text-gray-400'}`}
          >
            <Repeat className="h-5 w-5" />
            {player.repeat === 'one' && <span className="absolute -right-2 -top-1.5 text-[10px] font-bold">1</span>}
          </button>
        </div>
      )}

      <ol className="max-w-3xl mx-auto divide-y divide-white/5">
        {tracks.map((t, i) => {
          const active = t.id === currentId;
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
                    active && player.isPlaying ? (
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
                  aria-label={`${t.title} — பாடல் வரிகள்`}
                  className="text-gray-400 hover:text-orange-400 font-tamil px-2 shrink-0"
                >
                  <span className="hidden text-xs sm:inline">பாடல் வரிகள்</span>
                  <ChevronRight className="h-4 w-4 sm:hidden" aria-hidden />
                </Link>
                <span className="text-xs text-gray-500 w-10 text-right shrink-0 tabular-nums">
                  {isPlayable && t.duration ? formatTime(t.duration) : ''}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
