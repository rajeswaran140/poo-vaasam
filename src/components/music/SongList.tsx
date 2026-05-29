'use client';

/**
 * Songs track list. Drives the global MusicPlayerProvider — clicking a row (or
 * Play-all) sets the player queue; the persistent bottom bar is rendered by the
 * provider, so playback continues as the visitor navigates away.
 *
 * Search + sort run client-side over the in-memory track list; play-all and the
 * queue always operate on the *currently displayed* (filtered + sorted) rows so
 * "play all" plays exactly what the visitor sees.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Play, Pause, Music, Shuffle, Repeat, ChevronRight, Search, X } from 'lucide-react';
import { useMusicPlayer, Cover, formatTime, type Track } from './MusicPlayerProvider';

/** A track plus the metadata the listing needs for sorting. */
export interface SongRow extends Track {
  /** createdAt as epoch ms, for "newest" sort. */
  addedAt?: number;
}

type SortMode = 'newest' | 'title' | 'duration';

/** Show the search + sort toolbar only once the catalogue is big enough to need it. */
const TOOLBAR_MIN = 6;

const SORT_LABELS: Record<SortMode, string> = {
  newest: 'புதியவை முதலில்',
  title: 'அகர வரிசை',
  duration: 'கால அளவு',
};

/** Repeat is tri-state, so its accessible name carries the current mode. */
const REPEAT_LABEL: Record<'off' | 'all' | 'one', string> = {
  off: 'Repeat',
  all: 'Repeat all',
  one: 'Repeat one',
};

function sortRows(rows: SongRow[], mode: SortMode): SongRow[] {
  const copy = [...rows];
  if (mode === 'title') {
    copy.sort((a, b) => a.title.localeCompare(b.title, 'ta'));
  } else if (mode === 'duration') {
    // Longest first; tracks without a known duration sink to the bottom.
    copy.sort((a, b) => (b.duration ?? -1) - (a.duration ?? -1));
  } else {
    // Newest first; tracks without a known date sink to the bottom.
    copy.sort((a, b) => (b.addedAt ?? -1) - (a.addedAt ?? -1));
  }
  return copy;
}

export function SongList({ tracks }: { tracks: SongRow[] }) {
  const player = useMusicPlayer();
  const currentId = player.current?.id;

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');

  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? tracks.filter(
          (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
        )
      : tracks;
    return sortRows(filtered, sort);
  }, [tracks, query, sort]);

  const firstPlayable = displayed.findIndex((t) => t.src);
  const playableCount = displayed.filter((t) => t.src).length;
  const queueIsCurrent = !!currentId && displayed.some((t) => t.id === currentId);
  const anyPlaying = queueIsCurrent && player.isPlaying;
  const showToolbar = tracks.length >= TOOLBAR_MIN;

  const onRow = (i: number) => {
    if (!displayed[i].src) return;
    if (displayed[i].id === currentId) player.toggle();
    else player.playQueue(displayed, i);
  };

  const playAll = () => {
    if (queueIsCurrent) player.toggle();
    else if (firstPlayable >= 0) player.playQueue(displayed, firstPlayable);
  };

  // Keep the playing row visible as next/prev advances through the queue.
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentId]);

  return (
    <div className="pb-6">
      {playableCount > 0 && (
        <div className="mx-auto mb-6 flex max-w-3xl items-center gap-5 px-3 sm:px-4">
          <button
            onClick={playAll}
            aria-label="Play all"
            title="Play all"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white shadow-xl shadow-orange-900/30 ring-2 ring-orange-400/0 transition-all duration-200 hover:scale-105 hover:bg-orange-500 hover:ring-orange-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 active:scale-95"
          >
            {anyPlaying ? <Pause className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7" />}
          </button>
          <button
            onClick={player.toggleShuffle}
            aria-label="Shuffle"
            aria-pressed={player.shuffle}
            className={`transition-all duration-200 hover:scale-110 hover:text-white focus-visible:outline-none focus-visible:text-white active:scale-95 ${player.shuffle ? 'text-orange-400' : 'text-gray-400'}`}
          >
            <Shuffle className="h-5 w-5" />
          </button>
          <button
            onClick={player.cycleRepeat}
            aria-label={REPEAT_LABEL[player.repeat]}
            className={`relative transition-all duration-200 hover:scale-110 hover:text-white focus-visible:outline-none focus-visible:text-white active:scale-95 ${player.repeat !== 'off' ? 'text-orange-400' : 'text-gray-400'}`}
          >
            <Repeat className="h-5 w-5" />
            {player.repeat === 'one' && <span className="absolute -right-2 -top-1.5 text-[10px] font-bold">1</span>}
          </button>
        </div>
      )}

      {showToolbar && (
        <div className="mx-auto mb-4 flex max-w-3xl flex-col gap-3 px-3 sm:flex-row sm:items-center sm:px-4">
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="பாடல் / பாடகரைத் தேடுங்கள்…"
              aria-label="பாடல்களைத் தேடு"
              className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-9 font-tamil text-sm text-white placeholder:text-gray-500 focus:border-orange-400/60 focus:outline-none focus:ring-1 focus:ring-orange-400/40"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="தேடலை அழி"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <label className="flex shrink-0 items-center gap-2 font-tamil text-sm text-gray-400">
            <span className="hidden sm:inline">வரிசைப்படுத்து:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              aria-label="வரிசைப்படுத்து"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 font-tamil text-sm text-white focus:border-orange-400/60 focus:outline-none focus:ring-1 focus:ring-orange-400/40"
            >
              {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
                <option key={m} value={m} className="bg-gray-900 text-white">
                  {SORT_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {displayed.length === 0 ? (
        <div className="mx-auto max-w-3xl px-3 py-12 text-center sm:px-4">
          <p className="font-tamil text-gray-400">
            “{query}” என்பதற்குப் பாடல்கள் எதுவும் கிடைக்கவில்லை.
          </p>
        </div>
      ) : (
        <ol className="max-w-3xl mx-auto divide-y divide-white/5">
          {displayed.map((t, i) => {
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
      )}
    </div>
  );
}
