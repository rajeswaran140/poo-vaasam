'use client';

/**
 * Horizontal, swipeable row of YouTube Shorts on /videos. The card itself
 * lives in ShortCard, shared with the full grid on /shorts so the two cannot
 * drift.
 */

import { useState, useRef, useEffect } from 'react';
import { MediaRail } from '@/components/MediaRail';
import { ShortCard } from '@/components/ShortCard';
import type { ChannelVideo } from '@/lib/youtube-feed';

export function ShortsRow({ shorts, now = Date.now() }: { shorts: ChannelVideo[]; now?: number }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const embedRef = useRef<HTMLDivElement>(null);
  const activeTitle = shorts.find((s) => s.id === activeId)?.title ?? '';

  // Move focus to the embed wrapper when a Short swaps in its inline player, so
  // keyboard / screen-reader users keep their place (WCAG 2.4.3).
  useEffect(() => {
    if (activeId) embedRef.current?.focus();
  }, [activeId]);

  if (!shorts.length) return null;

  return (
    <>
      <div aria-live="polite" className="sr-only">{activeTitle ? `Now playing: ${activeTitle}` : ''}</div>
      <MediaRail label="Shorts">
        {shorts.map((short) => (
          <li key={short.id} className="w-44 shrink-0 snap-start sm:w-48">
            <ShortCard
              short={short}
              now={now}
              isActive={activeId === short.id}
              onPlay={() => setActiveId(short.id)}
              embedRef={activeId === short.id ? embedRef : undefined}
              source="videos_shorts"
            />
          </li>
        ))}
      </MediaRail>
    </>
  );
}
