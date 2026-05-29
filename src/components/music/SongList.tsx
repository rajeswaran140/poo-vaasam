'use client';

/**
 * Presentational track list. Renders the rows it is given (already filtered +
 * sorted by SongsPlaylist) and drives the global MusicPlayerProvider — clicking
 * a row sets the player queue to exactly these rows, so the persistent bottom
 * bar continues playback as the visitor navigates away.
 */

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Play, Pause, Music, ChevronRight } from 'lucide-react';
import { useMusicPlayer, Cover, formatTime, type Track } from './MusicPlayerProvider';

/** A track plus the metadata the listing needs for sorting. */
export interface SongRow extends Track {
  /** createdAt as epoch ms, for "newest" sort. */
  addedAt?: number;
}

export function SongList({ rows }: { rows: SongRow[] }) {
  const player = useMusicPlayer();
  const currentId = player.current?.id;

  const onRow = (i: number) => {
    if (!rows[i].src) return;
    if (rows[i].id === currentId) player.toggle();
    else player.playQueue(rows, i);
  };

  // Keep the playing row visible as next/prev advances through the queue.
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentId]);

  return (
    <ol className="max-w-3xl mx-auto divide-y divide-white/5">
      {rows.map((t, i) => {
        const active = t.id === currentId;
        const isPlayable = !!t.src;

        const lead = (
          <>
            <span className="w-6 shrink-0 text-center text-sm text-gray-400">
              {isPlayable ? (
                active && player.isPlaying ? (
                  <>
                    <span className="eq text-orange-400 group-hover:hidden" aria-hidden>
                      <span /><span /><span /><span />
                    </span>
                    <Pause className="mx-auto hidden h-4 w-4 text-orange-400 group-hover:block" aria-hidden />
                  </>
                ) : active ? (
                  <Play className="mx-auto h-4 w-4 text-orange-400" aria-hidden />
                ) : (
                  <>
                    <span className="group-hover:hidden">{i + 1}</span>
                    <Play className="mx-auto hidden h-4 w-4 text-white group-hover:block" aria-hidden />
                  </>
                )
              ) : (
                <Music className="mx-auto h-4 w-4 text-gray-600" aria-hidden />
              )}
            </span>
            <Cover
              src={t.cover}
              alt={t.title}
              className="h-11 w-11 shrink-0 rounded shadow-sm transition duration-200 group-hover:scale-105 group-hover:shadow-md"
            />
            <span className="min-w-0 flex-1">
              <span className={`block truncate font-tamil transition-colors ${active ? 'text-orange-400' : 'text-white'}`}>{t.title}</span>
              <span className="block truncate text-sm text-gray-400 font-tamil">{t.artist}</span>
            </span>
          </>
        );

        return (
          <li key={t.id} ref={active ? activeRef : undefined}>
            <div
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200 sm:gap-4 sm:px-4 ${
                isPlayable
                  ? 'hover:bg-gradient-to-r hover:from-white/10 hover:to-transparent'
                  : 'opacity-60'
              } ${active ? 'bg-white/10 shadow-sm shadow-black/20 ring-1 ring-white/10' : ''}`}
            >
              {isPlayable ? (
                <button
                  type="button"
                  onClick={() => onRow(i)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-400/60 sm:gap-4"
                >
                  {lead}
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">{lead}</div>
              )}

              <Link
                href={`/content/${t.id}`}
                aria-label={`${t.title} — பாடல் வரிகள்`}
                className="shrink-0 px-2 font-tamil text-gray-400 hover:text-orange-400 focus-visible:text-orange-400 focus-visible:outline-none"
              >
                <span className="hidden text-xs sm:inline">பாடல் வரிகள்</span>
                <ChevronRight className="h-4 w-4 sm:hidden" aria-hidden />
              </Link>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-500">
                {isPlayable && t.duration ? formatTime(t.duration) : ''}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
