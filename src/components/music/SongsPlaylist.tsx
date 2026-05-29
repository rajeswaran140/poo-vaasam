'use client';

/**
 * The /songs experience: a Spotify-style action hero (artwork, title, metadata
 * chips and the primary Play-all / Shuffle / Repeat controls) above a
 * searchable, sortable track list. Owns the search + sort state; the controls
 * and the list both operate on the currently displayed (filtered + sorted)
 * rows, so "play all" plays exactly what the visitor sees.
 */

import { useMemo, useState } from 'react';
import { Play, Pause, Shuffle, Repeat, Search, X, Music } from 'lucide-react';
import { useMusicPlayer } from './MusicPlayerProvider';
import { SongList, type SongRow } from './SongList';

export type { SongRow } from './SongList';

type SortMode = 'newest' | 'title' | 'duration';

const PAGE_TITLE = 'பாடல்கள்';
const TAGLINE = 'தமிழ் பாடல்கள் தொகுப்பு';

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

export function SongsPlaylist({ tracks }: { tracks: SongRow[] }) {
  const player = useMusicPlayer();
  const currentId = player.current?.id;

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');

  const sorted = useMemo(() => sortRows(tracks, sort), [tracks, sort]);
  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? sorted.filter((t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
      : sorted;
  }, [sorted, query]);

  // Hero metadata reflects the whole playlist (stable identity), not the filter.
  const playableCount = tracks.filter((t) => t.src).length;
  const totalMin = Math.round(tracks.reduce((sum, t) => sum + (t.duration || 0), 0) / 60);

  const firstPlayable = displayed.findIndex((t) => t.src);
  const queueIsCurrent = !!currentId && displayed.some((t) => t.id === currentId);
  const anyPlaying = queueIsCurrent && player.isPlaying;
  const showToolbar = tracks.length >= TOOLBAR_MIN;
  const hasSongs = tracks.length > 0;

  const playAll = () => {
    if (queueIsCurrent) player.toggle();
    else if (firstPlayable >= 0) player.playQueue(displayed, firstPlayable);
  };

  return (
    <>
      {/* Full-width Spotify-style action hero (fades into the dark page) */}
      <section className="relative w-full overflow-hidden bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white">
        {/* layered glows */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_12%_-15%,rgba(255,255,255,0.38),transparent_55%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_90%_at_100%_115%,rgba(255,170,70,0.45),transparent_60%)]"
        />
        {/* fade into the dark page below */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-gray-900"
        />

        <div className="relative w-full px-6 pb-14 pt-24 sm:px-10 lg:px-16">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
            {/* Vinyl artwork — spins slowly while a track is playing. */}
            <div className="group relative h-40 w-40 shrink-0 animate-fade-in sm:h-52 sm:w-52">
              <div
                className={`absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,#262626_0%,#0a0a0a_62%)] shadow-2xl ring-1 ring-white/20 transition-transform duration-500 ease-out group-hover:scale-[1.03] ${anyPlaying ? 'animate-vinyl' : ''}`}
              >
                {/* grooves */}
                <div
                  aria-hidden
                  className="absolute inset-3 rounded-full"
                  style={{
                    background:
                      'repeating-radial-gradient(circle at center, rgba(255,255,255,0.07) 0 1px, transparent 1px 6px)',
                  }}
                />
                {/* centre label + spindle hole */}
                <div className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-700 ring-2 ring-black/40 sm:h-20 sm:w-20">
                  <Music className="h-7 w-7 text-white/95 sm:h-9 sm:w-9" aria-hidden />
                  <span className="absolute h-2.5 w-2.5 rounded-full bg-gray-950 ring-1 ring-white/20" />
                </div>
              </div>
              {/* static diagonal sheen (does not spin) */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(115deg,transparent_42%,rgba(255,255,255,0.16)_50%,transparent_58%)]"
              />
            </div>

            <div className="min-w-0 animate-fade-in-up">
              <span className="mb-3 inline-flex items-center rounded-full bg-white/15 px-3 py-1 font-tamil text-xs font-semibold uppercase tracking-wide text-white ring-1 ring-white/25 backdrop-blur-sm">
                தொகுப்பு
              </span>
              <h1 className="mb-4 font-kavivanar text-5xl font-extrabold leading-tight drop-shadow-md sm:text-6xl lg:text-7xl">
                {PAGE_TITLE}
              </h1>
              <p className="mb-3 font-tamil text-white/90">{TAGLINE}</p>
              <div className="flex flex-wrap items-center gap-2 font-tamil text-sm">
                {playableCount > 0 && (
                  <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-white/90 ring-1 ring-white/20 backdrop-blur-sm">
                    {playableCount} பாடல்கள்
                  </span>
                )}
                {totalMin > 0 && (
                  <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-white/90 ring-1 ring-white/20 backdrop-blur-sm">
                    {totalMin} நிமிடம்
                  </span>
                )}
                <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-white/90 ring-1 ring-white/20 backdrop-blur-sm">
                  என்றும் இலவசம்
                </span>
              </div>
            </div>
          </div>

          {/* Primary controls */}
          {playableCount > 0 && (
            <div className="mt-8 flex items-center gap-4">
              <button
                onClick={playAll}
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-tamil text-base font-bold text-orange-700 shadow-xl shadow-black/20 transition-all duration-200 hover:scale-105 hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 active:scale-95"
              >
                {anyPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                <span>{anyPlaying ? 'இடைநிறுத்து' : 'அனைத்தையும் இயக்கு'}</span>
              </button>
              <button
                onClick={player.toggleShuffle}
                aria-label="Shuffle"
                aria-pressed={player.shuffle}
                title="Shuffle"
                className={`transition-all duration-200 hover:scale-110 focus-visible:outline-none active:scale-95 ${player.shuffle ? 'text-white' : 'text-white/60 hover:text-white'}`}
              >
                <Shuffle className="h-6 w-6" />
              </button>
              <button
                onClick={player.cycleRepeat}
                aria-label={REPEAT_LABEL[player.repeat]}
                title={REPEAT_LABEL[player.repeat]}
                className={`relative transition-all duration-200 hover:scale-110 focus-visible:outline-none active:scale-95 ${player.repeat !== 'off' ? 'text-white' : 'text-white/60 hover:text-white'}`}
              >
                <Repeat className="h-6 w-6" />
                {player.repeat === 'one' && <span className="absolute -right-2 -top-1.5 text-[10px] font-bold">1</span>}
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="container mx-auto px-4 py-8">
        {!hasSongs ? (
          <div className="py-20 text-center">
            <div className="mb-4 text-6xl">🎵</div>
            <h2 className="mb-2 font-tamil text-2xl font-bold text-white">இன்னும் பாடல்கள் இல்லை</h2>
            <p className="font-tamil text-gray-400">புதிய உள்ளடக்கத்திற்காகப் பின்னர் சரிபார்க்கவும்</p>
          </div>
        ) : (
          <>
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
              <SongList rows={displayed} />
            )}
          </>
        )}
      </div>
    </>
  );
}
