'use client';

/**
 * Audio control for a content detail page. Instead of rendering its own
 * <audio> element (which would play independently of the site-wide bottom-bar
 * player and could double up), this drives the global MusicPlayerProvider — so
 * there is exactly one audio element and playback persists across navigation.
 */

import { Play, Pause } from 'lucide-react';
import { useMusicPlayer, formatTime, type Track } from './MusicPlayerProvider';

export function DetailAudioPlayer({ track }: { track: Track }) {
  const player = useMusicPlayer();
  const isCurrent = player.current?.id === track.id;
  const playing = isCurrent && player.isPlaying;
  const loading = isCurrent && player.loading;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <button
        type="button"
        onClick={() => (isCurrent ? player.toggle() : player.playQueue([track], 0))}
        aria-label={playing ? 'இடைநிறுத்து' : 'இயக்கு'}
        aria-busy={loading}
        className="inline-flex items-center gap-2 rounded-full bg-orange-600 px-6 py-3 font-medium text-white shadow transition-colors hover:bg-orange-700"
      >
        {loading ? (
          <span
            aria-hidden
            className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        ) : playing ? (
          <Pause className="h-5 w-5" />
        ) : (
          <Play className="ml-0.5 h-5 w-5" />
        )}
        <span className="font-tamil">{playing ? 'இடைநிறுத்து' : 'இயக்கு'}</span>
      </button>

      {track.duration ? (
        <span className="font-tamil text-sm text-gray-600">காலம்: {formatTime(track.duration)}</span>
      ) : null}

      {isCurrent && player.error && (
        <p role="alert" className="w-full font-tamil text-sm text-red-600">
          {player.error}
        </p>
      )}
    </div>
  );
}
