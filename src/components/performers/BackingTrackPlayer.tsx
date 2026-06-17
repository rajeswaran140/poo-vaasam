'use client';

/**
 * BackingTrackPlayer — minimal karaoke backing-track player for the performers
 * portal. Uses the native <audio controls> element (robust seeking/buffering)
 * around a presigned URL. The URL is short-lived; if it has expired by the time
 * the performer hits play, `onExpired` lets the parent re-mint it.
 */

import Image from 'next/image';

interface BackingTrackPlayerProps {
  src: string;
  title: string;
  coverUrl?: string;
  onExpired?: () => void;
}

export function BackingTrackPlayer({ src, title, coverUrl, onExpired }: BackingTrackPlayerProps) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-orange-100 bg-orange-50/50 p-4">
      {coverUrl ? (
        <Image
          src={coverUrl}
          alt={title}
          width={64}
          height={64}
          className="h-16 w-16 flex-shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-orange-200 text-2xl">🎤</div>
      )}
      <div className="min-w-0 flex-1">
        <p className="mb-2 truncate font-tamil text-sm font-semibold text-gray-800" title={title}>
          {title} <span className="font-normal text-gray-500">· பாடல் இசை</span>
        </p>
        <audio
          controls
          preload="none"
          src={src}
          onError={() => onExpired?.()}
          className="w-full"
        >
          Your browser does not support the audio element.
        </audio>
      </div>
    </div>
  );
}
